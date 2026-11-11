import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { resolveConfig } from '../src/config.ts';
import { install } from './fixtures.ts';

const BRIEFS = { briefsDir: '/tmp/turn-guard-test-briefs' };
const DRIZZT = 'agent:companions:discord:channel:1';
const BRUENOR = 'agent:companions:discord:channel:2';
const WULFGAR = 'agent:companions:discord:channel:3';
const ELSEWHERE = 'agent:mithral-hall:matrix:channel:9';
const SECOND = 1000;
const BUSY = { handled: true, text: 'The hall is full. Ask again shortly.' };

function queued(queue: Record<string, unknown> = {}) {
  return install({ pluginConfig: { ...BRIEFS, queue: { agents: ['Companions '], busyText: BUSY.text, ...queue } } });
}

/** What the hook returned for a turn, or `waiting` while it has not returned. */
function watch(turn: Promise<unknown>): { result: unknown } {
  const seen: { result: unknown } = { result: 'waiting' };
  void turn.then((result) => {
    seen.result = result;
    return result;
  });
  return seen;
}

test('without queue agents no turn is held', async () => {
  const host = install({ pluginConfig: BRIEFS });
  assert.equal(await host.arrive(DRIZZT), undefined);
  assert.equal(await host.arrive(BRUENOR), undefined);
});

test('a second and third question wait for the run before them to end: two answers never overlap', async () => {
  const host = queued();
  assert.equal(await host.arrive(DRIZZT), undefined);
  host.start(DRIZZT, 'run-1');
  const bruenor = watch(host.arrive(BRUENOR));
  const wulfgar = watch(host.arrive(WULFGAR));
  await host.advance(50 * SECOND);
  assert.deepEqual([bruenor.result, wulfgar.result], ['waiting', 'waiting']);
  host.finish(DRIZZT, 'run-1');
  await host.advance(50 * SECOND);
  assert.deepEqual([bruenor.result, wulfgar.result], [undefined, 'waiting']);
  host.start(BRUENOR, 'run-2');
  host.finish(BRUENOR, 'run-2');
  await host.advance(50 * SECOND);
  assert.equal(wulfgar.result, undefined);
});

test('other agents and keys that are not agent session keys are never held', async () => {
  const host = queued();
  await host.arrive(DRIZZT);
  host.start(DRIZZT);
  assert.equal(await host.arrive(ELSEWHERE), undefined);
  assert.equal(await host.arrive('not-a-session-key'), undefined);
  assert.equal(await host.arrive(undefined), undefined);
});

test('a question that waits past maxWaitMs gets the busy reply instead of being held until OpenClaw aborts it', async () => {
  const host = queued({ maxWaitMs: 240 * SECOND });
  await host.arrive(DRIZZT);
  host.start(DRIZZT);
  const bruenor = watch(host.arrive(BRUENOR));
  await host.advance(239 * SECOND);
  assert.equal(bruenor.result, 'waiting');
  await host.advance(240 * SECOND);
  assert.deepEqual(bruenor.result, BUSY);
  host.finish(DRIZZT);
  assert.equal(await host.arrive(BRUENOR), undefined);
});

test('with maxWaiting set, a question arriving at a full line gets the busy reply at once', async () => {
  const host = queued({ maxWaiting: 1 });
  await host.arrive(DRIZZT);
  host.start(DRIZZT);
  const bruenor = watch(host.arrive(BRUENOR));
  assert.deepEqual(await host.arrive(WULFGAR), BUSY);
  host.finish(DRIZZT);
  await host.advance(SECOND);
  assert.equal(bruenor.result, undefined);
});

test('a redelivered message takes over its place in line: it is answered once, not twice', async () => {
  const host = queued({ maxWaiting: 1 });
  await host.arrive(DRIZZT);
  host.start(DRIZZT);
  const first = watch(host.arrive(BRUENOR, 'message-1'));
  const again = watch(host.arrive(BRUENOR, 'message-1'));
  await host.advance(SECOND);
  assert.deepEqual(first.result, { handled: true });
  host.finish(DRIZZT);
  await host.advance(2 * SECOND);
  assert.equal(again.result, undefined);
});

test('a command or claimed turn, which starts no run, frees the agent after startGraceMs: the line does not jam', async () => {
  const host = queued({ startGraceMs: 60 * SECOND });
  assert.equal(await host.arrive(DRIZZT), undefined);
  const bruenor = watch(host.arrive(BRUENOR));
  await host.advance(59 * SECOND);
  assert.equal(bruenor.result, 'waiting');
  await host.advance(60 * SECOND);
  assert.equal(bruenor.result, undefined);
});

test('a follow-up let through during a run keeps the agent for its own run: the next question does not start beside it', async () => {
  const host = queued();
  await host.arrive(DRIZZT);
  host.start(DRIZZT, 'run-1');
  assert.equal(await host.arrive(DRIZZT), undefined);
  const bruenor = watch(host.arrive(BRUENOR));
  host.finish(DRIZZT, 'run-1');
  await host.advance(5 * SECOND);
  assert.equal(bruenor.result, 'waiting');
  host.start(DRIZZT, 'run-2');
  await host.advance(100 * SECOND);
  assert.equal(bruenor.result, 'waiting');
  host.finish(DRIZZT, 'run-2');
  await host.advance(101 * SECOND);
  assert.equal(bruenor.result, undefined);
});

test('a failed attempt that is retried keeps the agent; one that is not retried frees it after the grace', async () => {
  const host = queued({ startGraceMs: 60 * SECOND });
  await host.arrive(DRIZZT);
  host.start(DRIZZT, 'run-1');
  const bruenor = watch(host.arrive(BRUENOR));
  host.finish(DRIZZT, 'run-1', false);
  await host.advance(10 * SECOND);
  assert.equal(bruenor.result, 'waiting');
  host.start(DRIZZT, 'run-1');
  await host.advance(100 * SECOND);
  assert.equal(bruenor.result, 'waiting');
  host.finish(DRIZZT, 'run-1', false);
  await host.advance(159 * SECOND);
  assert.equal(bruenor.result, 'waiting');
  await host.advance(160 * SECOND);
  assert.equal(bruenor.result, undefined);
});

test('a late end from a run that outlived maxRunMs does not free the session\'s next run', async () => {
  const host = queued({ maxRunMs: 60 * SECOND });
  await host.arrive(DRIZZT);
  host.start(DRIZZT, 'run-1');
  await host.advance(60 * SECOND);
  assert.equal(await host.arrive(DRIZZT), undefined);
  host.start(DRIZZT, 'run-2');
  const bruenor = watch(host.arrive(BRUENOR));
  host.finish(DRIZZT, 'run-1');
  await host.advance(70 * SECOND);
  assert.equal(bruenor.result, 'waiting');
  host.finish(DRIZZT, 'run-2');
  await host.advance(71 * SECOND);
  assert.equal(bruenor.result, undefined);
});

test('an end from a session that does not hold the agent releases nothing', async () => {
  const host = queued();
  await host.arrive(DRIZZT);
  host.start(DRIZZT);
  const bruenor = watch(host.arrive(BRUENOR));
  host.start(BRUENOR);
  host.finish(BRUENOR);
  host.finish(ELSEWHERE);
  host.finish(undefined);
  await host.advance(SECOND);
  assert.equal(bruenor.result, 'waiting');
});

const REST = { rest: { afterBusyShare: 0.5, windowMs: 600 * SECOND, pauseMs: 60 * SECOND } };

test('after a busy stretch the next question rests pauseMs, whether it was waiting or arrives just after', async () => {
  const host = queued({ ...REST, maxWaitMs: 270 * SECOND });
  await host.arrive(DRIZZT);
  host.start(DRIZZT);
  await host.advance(390 * SECOND);
  const bruenor = watch(host.arrive(BRUENOR));
  await host.advance(400 * SECOND);
  host.finish(DRIZZT);
  await host.advance(459 * SECOND);
  assert.equal(bruenor.result, 'waiting');
  await host.advance(460 * SECOND);
  assert.equal(bruenor.result, undefined);
  host.start(BRUENOR);
  await host.advance(470 * SECOND);
  host.finish(BRUENOR);
  const wulfgar = watch(host.arrive(WULFGAR));
  await host.advance(529 * SECOND);
  assert.equal(wulfgar.result, 'waiting');
  await host.advance(530 * SECOND);
  assert.equal(wulfgar.result, undefined);
});

test('a rest never turns a waiting question into a refusal: it starts before its maxWaitMs', async () => {
  const host = queued({ ...REST, maxWaitMs: 270 * SECOND });
  await host.arrive(DRIZZT);
  host.start(DRIZZT);
  await host.advance(150 * SECOND);
  const bruenor = watch(host.arrive(BRUENOR));
  await host.advance(400 * SECOND);
  host.finish(DRIZZT);
  await host.advance(420 * SECOND);
  assert.equal(bruenor.result, undefined);
});

test('a quiet stretch has no rest: the next question starts the moment the agent frees', async () => {
  const host = queued(REST);
  await host.arrive(DRIZZT);
  host.start(DRIZZT);
  const bruenor = watch(host.arrive(BRUENOR));
  await host.advance(100 * SECOND);
  host.finish(DRIZZT);
  await host.advance(100 * SECOND);
  assert.equal(bruenor.result, undefined);
});

test('queue settings out of range fall back, and a rest missing a part is no rest', () => {
  const { queue } = resolveConfig({ queue: { agents: 'companions', maxWaitMs: 0, maxWaiting: 0, rest: { afterBusyShare: 0.5, windowMs: 600000 }, busyText: '' } });
  assert.deepEqual(queue.agents, []);
  assert.equal(queue.maxWaitMs, 240000);
  assert.equal(queue.maxWaiting, 1);
  assert.equal(queue.rest, undefined);
  assert.ok(queue.busyText.length > 0);
  assert.equal(resolveConfig({ queue: { rest: 'on' } }).queue.rest, undefined);
  assert.equal(resolveConfig({}).queue.maxWaiting, undefined);
});
