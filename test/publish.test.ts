import { strict as assert } from 'node:assert';
import { chmod, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { publishBrief, slugify, stamp } from '../src/publish.ts';
import { defined, install } from './fixtures.ts';

const roots: string[] = [];
after(() => Promise.all(roots.map((r) => rm(r, { recursive: true, force: true }))));

async function temp(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'turn-guard-'));
  roots.push(dir);
  return dir;
}

const text = (r: { content: { text?: string }[] }) => r.content.map((c) => c.text ?? '').join('');

async function tool(briefsDir: string, extra: Record<string, unknown> = {}) {
  const host = install({ pluginConfig: { briefsDir, ...extra } });
  return defined(host.toolFor('research'));
}

test('two briefs on one topic in one second land in two files, neither overwritten', async () => {
  const dir = await temp();
  const t = await tool(dir);
  const a = await t.execute('c1', { topic: 'Mithral Hall', text: 'first brief by Bruenor' });
  const b = await t.execute('c2', { topic: 'Mithral Hall', text: 'second brief by Regis' });
  assert.notEqual(text(a), text(b));
  const names = await readdir(dir);
  assert.equal(names.length, 2);
  const bodies = await Promise.all(names.map((n) => readFile(join(dir, n), 'utf8')));
  assert.deepEqual(bodies.toSorted(), ['first brief by Bruenor', 'second brief by Regis']);
});

test('a name collision picks a new suffix instead of overwriting', async () => {
  const dir = await temp();
  const fixed = new Date(Date.UTC(2026, 9, 24, 8, 5, 3));
  await writeFile(join(dir, '2026-10-24-080503-aaaaaa-wulfgar.md'), 'kept');
  const seq = ['aaaaaa', 'bbbbbb'];
  const r = await publishBrief('wulfgar', 'new', { briefsDir: dir, maxBriefChars: 100, now: () => fixed, hex: () => seq.shift() ?? 'cccccc' });
  assert.ok(r.ok);
  assert.equal(r.path, `${dir}/2026-10-24-080503-bbbbbb-wulfgar.md`);
  assert.equal(await readFile(join(dir, '2026-10-24-080503-aaaaaa-wulfgar.md'), 'utf8'), 'kept');
});

test('a collision on every attempt returns an error result', async () => {
  const dir = await temp();
  await writeFile(join(dir, '2026-10-24-000000-aaaaaa-x.md'), 'kept');
  const r = await publishBrief('x', 'new', { briefsDir: dir, maxBriefChars: 100, now: () => new Date(Date.UTC(2026, 9, 24)), hex: () => 'aaaaaa' });
  assert.deepEqual(r, { ok: false, message: 'could not pick an unused file name' });
  assert.deepEqual(await readdir(dir), ['2026-10-24-000000-aaaaaa-x.md'], 'no temporary file is left behind');
});

test('a symlink at the chosen name is never followed or replaced', async () => {
  const dir = await temp();
  const outside = await temp();
  await writeFile(join(outside, 'target'), 'untouched');
  await symlink(join(outside, 'target'), join(dir, '2026-10-24-000000-aaaaaa-x.md'));
  const seq = ['aaaaaa', 'bbbbbb'];
  const r = await publishBrief('x', 'new', { briefsDir: dir, maxBriefChars: 100, now: () => new Date(Date.UTC(2026, 9, 24)), hex: () => seq.shift() ?? 'cccccc' });
  assert.ok(r.ok);
  assert.equal(await readFile(join(outside, 'target'), 'utf8'), 'untouched');
  assert.equal((await readdir(dir)).length, 2);
});

test('a 10,000-character brief round-trips exactly, with mode 0644', async () => {
  const dir = await temp();
  const body = Array.from({ length: 10_000 }, (_, i) => String.fromCodePoint(97 + (i % 26))).join('');
  const t = await tool(dir);
  const r = await t.execute('c1', { topic: 'Drizzt', text: body });
  const [name] = await readdir(dir);
  assert.equal(await readFile(join(dir, defined(name)), 'utf8'), body);
  assert.equal((await stat(join(dir, defined(name)))).mode & 0o777, 0o644);
  assert.equal(text(r), `${dir}/${name}`);
});

test('a path-like topic stays inside briefsDir', async () => {
  const dir = await temp();
  const t = await tool(join(dir, 'briefs'));
  const r = await t.execute('c1', { topic: '../../etc/x', text: 'Entreri was here' });
  assert.deepEqual(await readdir(dir), ['briefs']);
  const [name] = await readdir(join(dir, 'briefs'));
  assert.match(defined(name), /^\d{4}-\d{2}-\d{2}-\d{6}-[0-9a-f]{6}-etc-x\.md$/);
  assert.equal(text(r), `${dir}/briefs/${name}`);
});

test('an unwritable briefsDir reports the OS error code, not fs-safe\'s category, and does not throw', { skip: process.getuid?.() === 0 && 'root ignores directory permissions' }, async () => {
  const dir = await temp();
  await chmod(dir, 0o500);
  const t = await tool(dir);
  const r = await t.execute('c1', { topic: 'Catti-brie', text: 'a brief' });
  await chmod(dir, 0o700);
  assert.match(text(r), /^publish_brief failed: the write failed \(EACCES\)/);
  assert.deepEqual(r.details, { status: 'failed' });
});

test('a briefsDir that is a file returns an error result', async () => {
  const dir = await temp();
  await writeFile(join(dir, 'file'), 'x');
  const r = await publishBrief('t', 'text', { briefsDir: join(dir, 'file'), maxBriefChars: 100 });
  assert.equal(r.ok, false);
});

test('empty and whitespace-only text are rejected', async () => {
  const dir = await temp();
  const t = await tool(dir);
  for (const bad of ['', '   \n']) {
    const r = await t.execute('c1', { topic: 't', text: bad });
    assert.match(text(r), /text is empty/);
  }
  assert.deepEqual(await readdir(dir), []);
});

test('a brief over maxBriefChars is rejected and a brief at the limit is not', async () => {
  const dir = await temp();
  const t = await tool(dir, { maxBriefChars: 50 });
  assert.match(text(await t.execute('c1', { topic: 't', text: 'x'.repeat(51) })), /limit is 50/);
  assert.doesNotMatch(text(await t.execute('c2', { topic: 't', text: 'x'.repeat(50) })), /failed/);
  assert.equal((await readdir(dir)).length, 1);
});

test('publishedPathPrefix replaces the host path in the result, without a doubled slash', async () => {
  const dir = await temp();
  const t = await tool(dir, { publishedPathPrefix: '/mnt/briefs/' });
  const [r] = [await t.execute('c1', { topic: 'Jarlaxle', text: 'a brief' })];
  const [name] = await readdir(dir);
  assert.equal(text(r), `/mnt/briefs/${name}`);
});

test('a topic with no usable characters falls back to the "brief" slug', async () => {
  const dir = await temp();
  const t = await tool(dir);
  await t.execute('c1', { topic: '研究', text: 'a brief' });
  const names = await readdir(dir);
  assert.equal(names.length, 1);
  assert.match(defined(names[0]), /-brief\.md$/);
});

test('slugify keeps [a-z0-9-], caps at 40 characters and falls back to "brief"', () => {
  assert.equal(slugify('Drizzt Do’Urden: The Hunter\'s Blades!'), 'drizzt-do-urden-the-hunter-s-blades');
  assert.equal(slugify('a'.repeat(60)), 'a'.repeat(40));
  assert.equal(slugify(`${'a'.repeat(39)} b`), 'a'.repeat(39));
  assert.equal(slugify('///'), 'brief');
  assert.equal(slugify('研究'), 'brief');
});

test('stamp is UTC', () => {
  assert.equal(stamp(new Date(Date.UTC(2026, 0, 2, 3, 4, 5))), '2026-01-02-030405');
});

test('publish_brief goes only to agents in publishAgents, and is not registered without briefsDir', () => {
  const host = install({ pluginConfig: { briefsDir: '/x', publishAgents: ['scribe'] } });
  assert.equal(host.toolFor('research'), undefined);
  assert.ok(host.toolFor('scribe'));
  assert.equal(install({ pluginConfig: { briefsDir: '/x' } }).toolFor('main'), undefined);
  const none = install({ pluginConfig: {} });
  assert.equal(none.toolFor('research'), undefined);
  assert.match(none.warnings.join('\n'), /briefsDir is not set/);
});
