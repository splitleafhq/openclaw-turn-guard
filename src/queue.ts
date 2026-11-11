import { normalizeAgentIdStrict, parseAgentSessionKey } from 'openclaw/plugin-sdk/routing';

export interface QueueConfig {
  agents: string[];
  maxWaitMs: number;
  maxWaiting: number;
  maxHoldMs: number;
  restMs: number;
  busyShare: number;
  busyWindowMs: number;
}

/** What became of a turn that asked for its agent's slot. */
export type Admission = 'unlisted' | 'same-session' | 'started' | 'waited' | 'full' | 'timeout' | 'replaced';

interface Timers {
  now: () => number;
  /** Returns a function that cancels the timer. */
  setTimer: (fn: () => void, ms: number) => () => void;
}

interface Waiter {
  sessionKey: string;
  messageId: string | undefined;
  settle: (admission: Admission) => void;
  cancelDeadline: () => void;
}

interface Slot {
  holder: string | undefined;
  since: number;
  cancelHold: () => void;
  resting: boolean;
  waiters: Waiter[];
  runs: { start: number; end: number }[];
}

export interface AgentQueue {
  acquire(sessionKey: string | undefined, messageId?: string): Promise<Admission>;
  release(sessionKey: string | undefined): boolean;
}

const REAL_TIMERS: Timers = {
  now: Date.now,
  setTimer: (fn, ms) => {
    // unref: a waiting turn must not keep a stopping gateway alive.
    const timer = setTimeout(fn, ms).unref();
    return () => clearTimeout(timer);
  },
};

const NO_TIMER = (): void => {};

/**
 * One slot per listed agent: a turn for a busy agent waits in arrival order.
 * State is in memory, so a plugin reload or a gateway restart empties the line.
 */
export function createAgentQueue(config: QueueConfig, log: (message: string) => void, timers: Timers = REAL_TIMERS): AgentQueue {
  const { now, setTimer } = timers;
  const listed = new Set<string>();
  for (const id of config.agents) {
    const agent = normalizeAgentIdStrict(id);
    if (agent.ok) {
      listed.add(agent.value);
    }
  }
  const slots = new Map<string, Slot>();

  function agentOf(sessionKey: string | undefined): string | undefined {
    const agent = normalizeAgentIdStrict(parseAgentSessionKey(sessionKey)?.agentId);
    return agent.ok && listed.has(agent.value) ? agent.value : undefined;
  }

  function slotFor(agent: string): Slot {
    let slot = slots.get(agent);
    if (slot === undefined) {
      slot = { holder: undefined, since: 0, cancelHold: NO_TIMER, resting: false, waiters: [], runs: [] };
      slots.set(agent, slot);
    }
    return slot;
  }

  function busy(slot: Slot): boolean {
    const from = now() - config.busyWindowMs;
    slot.runs = slot.runs.filter((run) => run.end > from);
    const answering = slot.runs.reduce((sum, run) => sum + (run.end - Math.max(run.start, from)), 0);
    return answering > config.busyShare * config.busyWindowMs;
  }

  function grant(agent: string, slot: Slot, sessionKey: string): void {
    slot.holder = sessionKey;
    slot.since = now();
    // agent_end does not fire for a turn that never starts a run (a command, another plugin's claim), so the slot frees itself.
    slot.cancelHold = setTimer(() => {
      log(`slot for ${agent} freed after ${config.maxHoldMs} ms without an end`);
      free(agent, slot);
    }, config.maxHoldMs);
  }

  function next(agent: string, slot: Slot): void {
    slot.resting = false;
    const waiter = slot.waiters.shift();
    if (waiter === undefined) {
      return;
    }
    waiter.cancelDeadline();
    grant(agent, slot, waiter.sessionKey);
    waiter.settle('waited');
  }

  function free(agent: string, slot: Slot): void {
    slot.cancelHold();
    slot.runs.push({ start: slot.since, end: now() });
    slot.holder = undefined;
    if (slot.waiters.length === 0) {
      return;
    }
    if (!busy(slot)) {
      next(agent, slot);
      return;
    }
    log(`${agent} has been busy: resting ${config.restMs} ms, ${slot.waiters.length} waiting`);
    slot.resting = true;
    setTimer(() => next(agent, slot), config.restMs);
  }

  return {
    async acquire(sessionKey, messageId) {
      const agent = agentOf(sessionKey);
      if (agent === undefined || sessionKey === undefined) {
        return 'unlisted';
      }
      const slot = slotFor(agent);
      if (slot.holder === sessionKey) {
        return 'same-session';
      }
      if (slot.holder === undefined && !slot.resting) {
        grant(agent, slot, sessionKey);
        return 'started';
      }
      // A redelivered message takes over its old place instead of a second one.
      const old = messageId === undefined ? -1 : slot.waiters.findIndex((waiter) => waiter.messageId === messageId);
      if (old === -1 && slot.waiters.length >= config.maxWaiting) {
        return 'full';
      }
      const started = now();
      const admission = await new Promise<Admission>((settle) => {
        const waiter: Waiter = { sessionKey, messageId, settle, cancelDeadline: NO_TIMER };
        const replaced = old === -1 ? undefined : slot.waiters[old];
        if (replaced === undefined) {
          slot.waiters.push(waiter);
        } else {
          replaced.cancelDeadline();
          slot.waiters[old] = waiter;
          replaced.settle('replaced');
        }
        waiter.cancelDeadline = setTimer(() => {
          const at = slot.waiters.indexOf(waiter);
          if (at !== -1) {
            slot.waiters.splice(at, 1);
            settle('timeout');
          }
        }, config.maxWaitMs);
      });
      log(`${sessionKey}: ${admission} after ${now() - started} ms`);
      return admission;
    },
    release(sessionKey) {
      const agent = agentOf(sessionKey);
      const slot = agent === undefined ? undefined : slots.get(agent);
      if (agent === undefined || slot === undefined || slot.holder !== sessionKey) {
        return false;
      }
      free(agent, slot);
      return true;
    },
  };
}
