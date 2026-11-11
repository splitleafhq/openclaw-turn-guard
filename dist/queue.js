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
/** A waiter is granted this long before its deadline at the latest, so a rest never turns into a refusal. */
const REST_MARGIN_MS = 1000;
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
            slot = { holder: undefined, phase: 'starting', runId: undefined, runStart: 0, followUps: 0, cancelTimer: NO_TIMER, restUntil: 0, cancelRest: undefined, waiters: [], runs: [] };
            slots.set(agent, slot);
        }
        return slot;
    }
    function heldSlot(sessionKey) {
        const agent = agentOf(sessionKey);
        const slot = agent === undefined ? undefined : slots.get(agent);
        return agent !== undefined && slot !== undefined && slot.holder === sessionKey ? { agent, slot } : undefined;
    }
    function busy(slot, rest) {
        const from = now() - rest.windowMs;
        slot.runs = slot.runs.filter((run) => run.end > from);
        const answering = slot.runs.reduce((sum, run) => sum + (run.end - Math.max(run.start, from)), 0);
        return answering > rest.afterBusyShare * rest.windowMs;
    }
    /** The holder has `startGraceMs` to show a run. A command, another plugin's claim or an aborted turn never does. */
    function awaitStart(agent, slot) {
        slot.phase = 'starting';
        slot.runId = undefined;
        slot.followUps = 0;
        slot.cancelTimer();
        slot.cancelTimer = setTimer(() => {
            log(`${agent}: no run within ${config.startGraceMs} ms, slot freed`);
            free(agent, slot);
        }, config.startGraceMs);
    }
    function grant(agent, slot, sessionKey) {
        slot.holder = sessionKey;
        awaitStart(agent, slot);
    }
    function next(agent, slot) {
        slot.cancelRest?.();
        slot.cancelRest = undefined;
        const waiter = slot.waiters.shift();
        if (waiter === undefined) {
            return;
        }
        waiter.cancelDeadline();
        grant(agent, slot, waiter.sessionKey);
        waiter.settle('waited');
    }
    /** Starts the first waiter now, or when the rest ends, or just before its deadline, whichever comes first. */
    function schedule(agent, slot) {
        const first = slot.waiters[0];
        if (slot.holder !== undefined || first === undefined || slot.cancelRest !== undefined) {
            return;
        }
        const wait = Math.min(slot.restUntil, first.deadlineAt - REST_MARGIN_MS) - now();
        if (wait <= 0) {
            next(agent, slot);
            return;
        }
        slot.cancelRest = setTimer(() => {
            slot.cancelRest = undefined;
            next(agent, slot);
        }, wait);
    }
    function free(agent, slot) {
        slot.cancelTimer();
        slot.cancelTimer = NO_TIMER;
        slot.holder = undefined;
        schedule(agent, slot);
    }
    return {
        async acquire(sessionKey, messageId) {
            const agent = agentOf(sessionKey);
            if (agent === undefined || sessionKey === undefined) {
                return 'unlisted';
            }
            const slot = slotFor(agent);
            if (slot.holder === sessionKey) {
                slot.followUps += 1;
                return 'same-session';
            }
            if (slot.holder === undefined && slot.waiters.length === 0 && now() >= slot.restUntil) {
                grant(agent, slot, sessionKey);
                return 'started';
            }
            // OpenClaw redelivers a message it gave up on; the copy must not be answered as well.
            const old = messageId === undefined ? -1 : slot.waiters.findIndex((waiter) => waiter.messageId === messageId);
            if (old === -1 && config.maxWaiting !== undefined && slot.waiters.length >= config.maxWaiting) {
                return 'full';
            }
            const started = now();
            const admission = await new Promise((settle) => {
                const waiter = { sessionKey, messageId, settle, deadlineAt: started + config.maxWaitMs, cancelDeadline: NO_TIMER };
                const replaced = old === -1 ? undefined : slot.waiters[old];
                if (replaced === undefined) {
                    slot.waiters.push(waiter);
                }
                else {
                    replaced.cancelDeadline();
                    waiter.deadlineAt = replaced.deadlineAt;
                    slot.waiters[old] = waiter;
                    replaced.settle('replaced');
                }
                waiter.cancelDeadline = setTimer(() => {
                    const at = slot.waiters.indexOf(waiter);
                    if (at !== -1) {
                        slot.waiters.splice(at, 1);
                        settle('timeout');
                    }
                }, waiter.deadlineAt - started);
                schedule(agent, slot);
            });
            log(`${sessionKey}: ${admission} after ${now() - started} ms`);
            return admission;
        },
        runStarted(sessionKey, runId) {
            const held = heldSlot(sessionKey);
            if (held === undefined) {
                return;
            }
            const { agent, slot } = held;
            if (slot.phase === 'starting') {
                slot.runStart = now();
            }
            slot.phase = 'running';
            slot.runId = runId;
            slot.cancelTimer();
            slot.cancelTimer = setTimer(() => {
                log(`${agent}: run reported no end within ${config.maxRunMs} ms, slot freed`);
                free(agent, slot);
            }, config.maxRunMs);
        },
        runEnded(sessionKey, runId, success) {
            const held = heldSlot(sessionKey);
            if (held === undefined) {
                return;
            }
            const { agent, slot } = held;
            // An end from an earlier run of this session (one that outlived maxRunMs) must not free the current hold.
            if (slot.phase !== 'running' || (runId !== undefined && slot.runId !== undefined && runId !== slot.runId)) {
                return;
            }
            const end = now();
            slot.runs.push({ start: slot.runStart, end });
            if (config.rest !== undefined && busy(slot, config.rest)) {
                slot.restUntil = end + config.rest.pauseMs;
            }
            // OpenClaw reports an end per attempt, and a follow-up let through during the run starts its own run next:
            // either way another run of this session may follow, so the slot is kept for the start grace.
            if (!success || slot.followUps > 0) {
                awaitStart(agent, slot);
                return;
            }
            free(agent, slot);
        },
    };
}
