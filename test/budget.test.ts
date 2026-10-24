import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { Budget, MAX_AGE_MS } from '../src/budget.ts';
import { BUDGET_MESSAGE } from '../src/config.ts';
import { install } from './fixtures.ts';

const host = (extra: Record<string, unknown> = {}) => install({ pluginConfig: { briefsDir: '/x', ...extra } });
const call = (toolName: string, id: string, runId?: string) => ({ toolName, params: {}, toolCallId: id, ...(runId ? { runId } : {}) });
const ctx = (agentId: string, runId?: string, sessionKey?: string) => ({ agentId, ...(runId ? { runId } : {}), ...(sessionKey ? { sessionKey } : {}) });
const blocked = { block: true, blockReason: BUDGET_MESSAGE };

test('the 17th web_search or web_fetch in one run is blocked, and a different run is not', async () => {
  const h = host();
  for (let i = 1; i <= 16; i++) {
    assert.equal(await h.fire('before_tool_call', call(i % 2 ? 'web_search' : 'web_fetch', `c${i}`, 'run-a'), ctx('research', 'run-a')), undefined, `call ${i}`);
  }
  assert.deepEqual(await h.fire('before_tool_call', call('web_search', 'c17', 'run-a'), ctx('research', 'run-a')), blocked);
  assert.deepEqual(await h.fire('before_tool_call', call('web_fetch', 'c18', 'run-a'), ctx('research', 'run-a')), blocked);
  assert.equal(await h.fire('before_tool_call', call('web_search', 'd1', 'run-b'), ctx('research', 'run-b')), undefined);
});

test('a repeated toolCallId is counted once', async () => {
  const h = host({ budget: 2 });
  for (const id of ['c1', 'c1', 'c1', 'c2', 'c2']) {
    assert.equal(await h.fire('before_tool_call', call('web_search', id, 'r'), ctx('research', 'r')), undefined, id);
  }
  assert.deepEqual(await h.fire('before_tool_call', call('web_search', 'c3', 'r'), ctx('research', 'r')), blocked);
  assert.equal(await h.fire('before_tool_call', call('web_search', 'c1', 'r'), ctx('research', 'r')), undefined);
});

test('an agent outside budgetAgents and a tool outside the budget are never counted', async () => {
  const h = host({ budget: 1 });
  for (let i = 0; i < 5; i++) {
    assert.equal(await h.fire('before_tool_call', call('web_search', `m${i}`, 'r'), ctx('main', 'r')), undefined);
    assert.equal(await h.fire('before_tool_call', call('read', `x${i}`, 'r'), ctx('research', 'r')), undefined);
  }
  assert.equal(await h.fire('before_tool_call', call('web_search', 'c1', 'r'), ctx('research', 'r')), undefined);
  assert.deepEqual(await h.fire('before_tool_call', call('web_search', 'c2', 'r'), ctx('research', 'r')), blocked);
  assert.equal(await h.fire('before_tool_call', call('web_search', 'c1', 'r'), {}), undefined);
});

test('without a runId, calls are not counted', async () => {
  const h = host({ budget: 1 });
  for (let i = 0; i < 5; i++) {
    assert.equal(await h.fire('before_tool_call', call('web_search', `n${i}`), ctx('research', undefined, 'agent:session-1')), undefined);
  }
});

test('agent_end ends an attempt, not the run: a retry with the same runId keeps its count', async () => {
  const h = host({ budget: 1 });
  await h.fire('before_tool_call', call('web_search', 'a', 'r'), ctx('research', 'r'));
  await h.fire('agent_end', { messages: [], success: false }, ctx('research', 'r'));
  assert.deepEqual(await h.fire('before_tool_call', call('web_search', 'b', 'r'), ctx('research', 'r')), blocked);
});

test('a reused toolCallId with different arguments counts again', async () => {
  const h = host({ budget: 1 });
  const at = (q: string) => ({ toolName: 'web_search', params: { query: q }, toolCallId: 'call_0', runId: 'r' });
  assert.equal(await h.fire('before_tool_call', at('one'), ctx('research', 'r')), undefined);
  assert.equal(await h.fire('before_tool_call', at('one'), ctx('research', 'r')), undefined);
  assert.deepEqual(await h.fire('before_tool_call', at('two'), ctx('research', 'r')), blocked);
});

test('agent ids match without regard to case', async () => {
  const h = host({ budget: 1, budgetAgents: ['Research'] });
  await h.fire('before_tool_call', call('web_search', 'a', 'r'), ctx('research', 'r'));
  assert.deepEqual(await h.fire('before_tool_call', call('web_search', 'b', 'r'), ctx('research', 'r')), blocked);
});

test('entries older than six hours are evicted on the next call, with no timer', () => {
  let t = 1_000_000;
  const b = new Budget(1, () => t);
  assert.equal(b.check('old', 'a'), undefined);
  assert.equal(b.check('old', 'b'), BUDGET_MESSAGE);
  t += MAX_AGE_MS - 1;
  assert.equal(b.check('other', 'a'), undefined);
  assert.equal(b.size, 2);
  t += 2;
  assert.equal(b.check('third', 'a'), undefined);
  assert.equal(b.size, 2);
  assert.equal(b.check('old', 'c'), undefined);
});

test('the budget hook fails open when the event is malformed', async () => {
  const h = host();
  assert.equal(await h.fire('before_tool_call', undefined, undefined), undefined);
});
