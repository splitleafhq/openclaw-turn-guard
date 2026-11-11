import { strict as assert } from 'node:assert';
import { setImmediate as tick } from 'node:timers/promises';
import { test } from 'node:test';
import { createAgentQueue } from '../src/queue.ts';
import { resolveConfig } from '../src/config.ts';
import { install } from './fixtures.ts';

const BRIEFS = { briefsDir: '/tmp/turn-guard-test-briefs' };
const DRIZZT = 'agent:companions:discord:channel:1';
const BRUENOR = 'agent:companions:discord:channel:2';
const WULFGAR = 'agent:companions:discord:channel:3';
const ELSEWHERE = 'agent:mithral-hall:matrix:channel:9';

function queued(queue: Record<string, unknown> = {}) {
  return install({ pluginConfig: { ...BRIEFS, queue: { agents: ['companions'], ...queue } } });
}

test('with no queue agents the plugin registers no hooks, so no turn is ever held', () => {
  assert.deepEqual(install({ pluginConfig: BRIEFS }).hooks, []);
  assert.deepEqual(queued().hooks, ['agent_end', 'before_dispatch']);
});

test('a second question for a busy agent waits for the first to end, then runs: two answers never overlap', async () => {
  const host = queued();
  assert.equal(await host.arrive(DRIZZT), undefined);
  const order: string[] = [];
  const second = host.arrive(BRUENOR).then((result) => order.push(`bruenor:${String(result)}`));
  const third = host.arrive(WULFGAR).then((result) => order.push(`wulfgar:${String(result)}`));
  await tick();
  assert.deepEqual(order, []);
  host.finish(DRIZZT);
  await second;
  assert.deepEqual(order, ['bruenor:undefined']);
  host.finish(BRUENOR);
  await third;
  assert.deepEqual(order, ['bruenor:undefined', 'wulfgar:undefined']);
});

test('other agents, keys that are not agent session keys, and a follow-up in the running session are never held', async () => {
  const host = queued();
  await host.arrive(DRIZZT);
  assert.equal(await host.arrive(ELSEWHERE), undefined);
  assert.equal(await host.arrive('not-a-session-key'), undefined);
  assert.equal(await host.arrive(undefined), undefined);
  assert.equal(await host.arrive(DRIZZT), undefined);
});

test('a question that waits past maxWaitMs gets the busy reply instead of being held until OpenClaw aborts it', async () => {
  const host = queued({ maxWaitMs: 20, busyText: 'The hall is full. Ask again shortly.' });
  await host.arrive(DRIZZT);
  assert.deepEqual(await host.arrive(BRUENOR), { handled: true, text: 'The hall is full. Ask again shortly.' });
  host.finish(DRIZZT);
  assert.equal(await host.arrive(BRUENOR), undefined);
});

test('a question arriving at a full line gets the busy reply at once', async () => {
  const host = queued({ maxWaiting: 1 });
  await host.arrive(DRIZZT);
  const waiting = host.arrive(BRUENOR);
  await tick();
  const refused = await host.arrive(WULFGAR);
  assert.ok(typeof refused === 'object' && refused !== null && 'handled' in refused && 'text' in refused);
  assert.equal(refused.handled, true);
  assert.equal(refused.text, resolveConfig({}).queue.busyText);
  host.finish(DRIZZT);
  assert.equal(await waiting, undefined);
});

test('a redelivered message takes over its place in line: it is answered once, not twice', async () => {
  const host = queued({ maxWaiting: 1 });
  await host.arrive(DRIZZT);
  const first = host.arrive(BRUENOR, 'message-1');
  await tick();
  const again = host.arrive(BRUENOR, 'message-1');
  assert.deepEqual(await first, { handled: true });
  host.finish(DRIZZT);
  assert.equal(await again, undefined);
});

test('a turn that never reports an end frees the slot after maxHoldMs: the line cannot jam', async () => {
  const host = queued({ maxHoldMs: 20 });
  await host.arrive(DRIZZT);
  assert.equal(await host.arrive(BRUENOR), undefined);
  assert.ok(host.logs.some((line) => line.includes('without an end')));
});

test('an end from a session that does not hold the slot releases nothing', async () => {
  const host = queued();
  await host.arrive(DRIZZT);
  let ran = false;
  const second = host.arrive(BRUENOR).then(() => {
    ran = true;
    return ran;
  });
  host.finish(BRUENOR);
  host.finish(ELSEWHERE);
  host.finish(undefined);
  await tick();
  assert.equal(ran, false);
  host.finish(DRIZZT);
  await second;
});

function clocked(overrides: Record<string, unknown> = {}) {
  const clock = { at: 0 };
  const pending: { fn: () => void; due: number }[] = [];
  const config = { ...resolveConfig({ queue: { agents: ['Companions '], busyWindowMs: 600, restMs: 60, maxWaitMs: 5000, maxHoldMs: 5000, ...overrides } }).queue };
  const queue = createAgentQueue(config, () => {}, {
    now: () => clock.at,
    setTimer: (fn, ms) => {
      const timer = { fn, due: clock.at + ms };
      pending.push(timer);
      return () => {
        const at = pending.indexOf(timer);
        if (at !== -1) {
          pending.splice(at, 1);
        }
      };
    },
  });
  return {
    queue,
    advance(to: number) {
      clock.at = to;
      for (const timer of pending.filter((candidate) => candidate.due <= to)) {
        pending.splice(pending.indexOf(timer), 1);
        timer.fn();
      }
    },
  };
}

test('after answering for more than busyShare of the window, the next question rests restMs before it runs', async () => {
  const { queue, advance } = clocked();
  assert.equal(await queue.acquire(DRIZZT), 'started');
  let admitted: string | undefined;
  const second = queue.acquire(BRUENOR).then((admission) => {
    admitted = admission;
    return admission;
  });
  advance(400);
  queue.release(DRIZZT);
  await tick();
  assert.equal(admitted, undefined);
  const third = queue.acquire(WULFGAR);
  advance(459);
  await tick();
  assert.equal(admitted, undefined);
  advance(460);
  await second;
  assert.equal(admitted, 'waited');
  advance(470);
  queue.release(BRUENOR);
  advance(530);
  assert.equal(await third, 'waited');
});

test('a quiet stretch has no rest: the next question starts the moment the slot frees', async () => {
  const { queue, advance } = clocked();
  await queue.acquire(DRIZZT);
  const second = queue.acquire(BRUENOR);
  advance(100);
  queue.release(DRIZZT);
  assert.equal(await second, 'waited');
});

test('queue settings fall back to defaults when missing or out of range', () => {
  const { queue } = resolveConfig({ queue: { agents: 'companions', maxWaitMs: 0, busyShare: 2, busyText: '' } });
  assert.deepEqual(queue.agents, []);
  assert.equal(queue.maxWaitMs, 270000);
  assert.equal(queue.busyShare, 0.5);
  assert.ok(queue.busyText.length > 0);
});
