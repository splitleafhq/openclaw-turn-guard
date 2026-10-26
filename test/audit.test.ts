import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { MAX_AGE_MS, ToolLog, findClaim, finalAssistantText } from '../src/audit.ts';
import { hasConversationAccess, resolveConfig } from '../src/config.ts';
import { install, unavailableRuntime } from './fixtures.ts';

const roots: string[] = [];
after(() => Promise.all(roots.map((r) => rm(r, { recursive: true, force: true }))));

async function setup(grant = true) {
  const dir = await mkdtemp(join(tmpdir(), 'turn-guard-log-'));
  roots.push(dir);
  const logFile = join(dir, 'logs', 'turn-guard.jsonl');
  const h = install({ pluginConfig: { briefsDir: join(dir, 'b'), logFile }, grant });
  const lines = async () => (await readFile(logFile, 'utf8').catch(() => '')).split('\n').filter(Boolean).map((l): unknown => JSON.parse(l));
  return { h, logFile, lines };
}

const ctx = { agentId: 'main', sessionKey: 'agent:main:case-1', runId: 'run-1' };
const said = (t: string) => [{ role: 'user', content: 'go' }, { role: 'assistant', content: [{ type: 'text', text: t }] }];
const tool = (h: Awaited<ReturnType<typeof setup>>['h'], toolName: string, error?: string) =>
  h.fire('after_tool_call', { toolName, params: {}, runId: 'run-1', ...(error ? { error } : {}) }, ctx);
const end = (h: Awaited<ReturnType<typeof setup>>['h'], extra: Record<string, unknown> = {}, messages: unknown = said('Done.')) =>
  h.fire('agent_end', { runId: 'run-1', messages, success: true, ...extra }, ctx);

test('"I\'ve sent it" with no tool call is logged, with the phrase, ids and tool list', async () => {
  const { h, lines, logFile } = await setup();
  await end(h, {}, said('Checked the notes. I’ve sent it to Drizzt, so you can read it there.'));
  const [entry] = await lines();
  assert.ok(typeof entry === 'object' && entry !== null);
  assert.deepEqual(
    { ...entry, time: 'x' },
    {
      time: 'x',
      kind: 'unbacked-claim',
      agentId: 'main',
      sessionKey: 'agent:main:case-1',
      runId: 'run-1',
      phrase: 'Checked the notes. I’ve sent it to Drizzt, so you can read it there.',
      tools: [],
    },
  );
  assert.equal((await stat(logFile)).mode & 0o777, 0o600);
});

test('a successful message call backs the claim, so nothing is logged; a failed one does not', async () => {
  const a = await setup();
  await tool(a.h, 'message');
  await end(a.h, {}, said('I sent it.'));
  assert.deepEqual(await a.lines(), []);
  const b = await setup();
  await tool(b.h, 'message', 'channel unavailable');
  await end(b.h, {}, said('I sent it.'));
  const [entry] = await b.lines();
  assert.ok(typeof entry === 'object' && entry !== null && 'tools' in entry);
  assert.deepEqual(entry.tools, [{ name: 'message', ok: false }]);
});

test('a tool that cannot back the verb does not count: "I scheduled it" after only a read', async () => {
  const { h, lines } = await setup();
  await tool(h, 'read');
  await end(h, {}, said('I have scheduled the reminder.'));
  assert.equal((await lines()).length, 1);
});

test('a run error is logged with the error string and agent id', async () => {
  const { h, lines } = await setup();
  await tool(h, 'web_fetch');
  await end(h, { success: false, error: 'provider timed out' });
  const [entry] = await lines();
  assert.ok(typeof entry === 'object' && entry !== null);
  assert.equal('kind' in entry && entry.kind, 'run-error');
  assert.equal('error' in entry && entry.error, 'provider timed out');
  assert.equal('agentId' in entry && entry.agentId, 'main');
  assert.equal('phrase' in entry, false);
});

test('a clean run with no claim writes nothing, not even the log file', async () => {
  const { h, lines, logFile } = await setup();
  await end(h, {}, said('Here is the summary of the Underdark trip.'));
  assert.deepEqual(await lines(), []);
  await assert.rejects(stat(logFile));
});

test('an unwritable log file warns and does not throw', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'turn-guard-log-'));
  roots.push(dir);
  await writeFile(join(dir, 'file'), 'x');
  const h = install({ pluginConfig: { briefsDir: join(dir, 'b'), logFile: join(dir, 'file', 'x.jsonl') } });
  await end(h, { success: false, error: 'boom' });
  assert.match(h.warnings.join('\n'), /could not write/);
});

test('without the conversation-access grant, agent_end is not registered and the log stays off', async () => {
  const { h } = await setup(false);
  assert.equal(h.hasHook('agent_end'), false);
  assert.equal(h.hasHook('after_tool_call'), true);
  assert.equal(h.hasHook('before_tool_call'), false);
  assert.match(h.warnings.join('\n'), /allowConversationAccess/);
});

test('findClaim matches done-action claims and not plans or other people', () => {
  const yes = [
    "I've queued it", 'I have dispatched the job', 'We posted the update', 'I just sent that', 'i already scheduled it', 'I’ve posted it',
    "I've gone ahead and sent it", 'I went ahead and queued the job', "I've also forwarded it",
    'The brief has been sent.', 'It is now queued for tonight', 'Queued.', 'Done. Sent!', 'Message sent.', 'Okay.\nSubmitted.',
  ];
  for (const t of yes) {
    assert.ok(findClaim(t), t);
  }
  for (const no of ["I'll send it", 'I can post that', 'Regis sent it', 'it was sent by Bruenor', 'I will have it scheduled', 'resent', 'I sentence you', 'Sent to whom?']) {
    assert.equal(findClaim(no), undefined, no);
  }
});

test('the matched phrase is at most 120 characters', () => {
  const claim = findClaim(`${'a '.repeat(200)}I sent it${' b'.repeat(200)}`);
  assert.ok(claim && claim.phrase.length <= 120);
  assert.match(claim.phrase, /I sent it/);
});

test('finalAssistantText reads string content, text blocks and ignores other shapes', () => {
  assert.equal(finalAssistantText([{ role: 'assistant', content: 'plain' }]), 'plain');
  assert.equal(finalAssistantText([{ role: 'assistant', content: [{ type: 'text', text: 'a' }, { type: 'toolCall' }, { type: 'text', text: 'b' }] }]), 'a\n\nb');
  assert.equal(finalAssistantText([{ role: 'assistant', content: 'old' }, { role: 'tool', content: 'x' }]), 'old');
  assert.equal(finalAssistantText([{ role: 'assistant', content: 5 }]), '');
  assert.equal(finalAssistantText('nope'), '');
  assert.equal(finalAssistantText([null, 3]), '');
});

test('ToolLog drops runs idle for over six hours and caps one run at 200 calls', () => {
  let t = 0;
  const log = new ToolLog(() => t);
  log.record('a', 'read', true);
  t += MAX_AGE_MS + 1;
  log.record('b', 'read', true);
  assert.deepEqual(log.list('a'), []);
  for (let i = 0; i < 250; i++) {
    log.record('b', 'read', true);
  }
  assert.equal(log.list('b').length, 200);
  assert.deepEqual(log.list(undefined), []);
});

test('config falls back for malformed values; the grant is read from plugins.entries', () => {
  const c = resolveConfig({ publishAgents: 'x', maxBriefChars: 1.5, briefsDir: '' });
  assert.deepEqual([c.publishAgents, c.maxBriefChars, c.briefsDir], [['research'], 60000, undefined]);
  assert.equal(resolveConfig(null).maxBriefChars, 60000);
  assert.equal(hasConversationAccess(null), false);
  assert.equal(hasConversationAccess({ plugins: { entries: { 'turn-guard': { hooks: { allowConversationAccess: true } } } } }), true);
});

test('the default log file sits under the state directory', async () => {
  const h = install({ pluginConfig: { briefsDir: '/x' } });
  await h.fire('agent_end', { runId: 'r', messages: [], success: false, error: 'e' }, { agentId: 'a' });
  assert.match(h.warnings.join('\n'), /\/nonexistent-state\/logs\/turn-guard\.jsonl/);
});

test('a runtime still unavailable when the log is written warns and does not throw', async () => {
  const h = install({ pluginConfig: { briefsDir: '/x' }, runtime: unavailableRuntime() });
  await h.fire('agent_end', { runId: 'r', messages: [], success: false, error: 'e' }, { agentId: 'a' });
  assert.match(h.warnings.join('\n'), /could not write the log file/);
});

test('a successful automations call (cron as hooks name it) backs "I scheduled it"', async () => {
  const { h, lines } = await setup();
  await tool(h, 'automations');
  await end(h, {}, said('I scheduled it for 9.'));
  assert.deepEqual(await lines(), []);
});

test('a later attempt of the same run still sees tools from the earlier attempt', async () => {
  const { h, lines } = await setup();
  await tool(h, 'sessions_send');
  await end(h, {}, said('Working on it.'));
  await end(h, {}, said('I sent it to the reader.'));
  assert.deepEqual(await lines(), []);
});

test('an abort or timeout (success false, no error) is not logged as a run error', async () => {
  const { h, lines } = await setup();
  await end(h, { success: false });
  assert.deepEqual(await lines(), []);
});
