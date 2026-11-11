import { normalizeAgentIdStrict, parseAgentSessionKey } from 'openclaw/plugin-sdk/routing';
const REAL_TIMERS = {
    now: Date.now,
    setTimer: (fn, ms) => {
        // unref: a waiting turn must not keep a stopping gateway alive.
        const timer = setTimeout(fn, ms).unref();
        return () => clearTimeout(timer);
    },
};
const NO_TIMER = () => { };
/**
 * One slot per listed agent: a turn for a busy agent waits in arrival order.
 * State is in memory, so a plugin reload or a gateway restart empties the line.
 */
export function createAgentQueue(config, log, timers = REAL_TIMERS) {
    const { now, setTimer } = timers;
    const listed = new Set();
    for (const id of config.agents) {
        const agent = normalizeAgentIdStrict(id);
        if (agent.ok) {
            listed.add(agent.value);
        }
    }
    const slots = new Map();
    function agentOf(sessionKey) {
        const agent = normalizeAgentIdStrict(parseAgentSessionKey(sessionKey)?.agentId);
        return agent.ok && listed.has(agent.value) ? agent.value : undefined;
    }
    function slotFor(agent) {
        let slot = slots.get(agent);
        if (slot === undefined) {
            slot = { holder: undefined, since: 0, cancelHold: NO_TIMER, resting: false, waiters: [], runs: [] };
            slots.set(agent, slot);
        }
        return slot;
    }
    function busy(slot) {
        const from = now() - config.busyWindowMs;
        slot.runs = slot.runs.filter((run) => run.end > from);
        const answering = slot.runs.reduce((sum, run) => sum + (run.end - Math.max(run.start, from)), 0);
        return answering > config.busyShare * config.busyWindowMs;
    }
    function grant(agent, slot, sessionKey) {
        slot.holder = sessionKey;
        slot.since = now();
        // agent_end does not fire for a turn that never starts a run (a command, another plugin's claim), so the slot frees itself.
        slot.cancelHold = setTimer(() => {
            log(`slot for ${agent} freed after ${config.maxHoldMs} ms without an end`);
            free(agent, slot);
        }, config.maxHoldMs);
    }
    function next(agent, slot) {
        slot.resting = false;
        const waiter = slot.waiters.shift();
        if (waiter === undefined) {
            return;
        }
        waiter.cancelDeadline();
        grant(agent, slot, waiter.sessionKey);
        waiter.settle('waited');
    }
    function free(agent, slot) {
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
            const admission = await new Promise((settle) => {
                const waiter = { sessionKey, messageId, settle, cancelDeadline: NO_TIMER };
                const replaced = old === -1 ? undefined : slot.waiters[old];
                if (replaced === undefined) {
                    slot.waiters.push(waiter);
                }
                else {
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
