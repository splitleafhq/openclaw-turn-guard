export const PLUGIN_ID = 'turn-guard';
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function strings(value, fallback) {
    return Array.isArray(value) ? value.filter((v) => typeof v === 'string' && v !== '') : fallback;
}
function text(value) {
    return typeof value === 'string' && value !== '' ? value : undefined;
}
function count(value, fallback) {
    return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : fallback;
}
function share(value, fallback) {
    return typeof value === 'number' && value > 0 && value <= 1 ? value : fallback;
}
/** All three or nothing: a rest with a guessed part would pause turns on numbers nobody chose. */
function restConfig(value) {
    if (!isRecord(value)) {
        return undefined;
    }
    const afterBusyShare = share(value.afterBusyShare, 0);
    const windowMs = count(value.windowMs, 0);
    const pauseMs = count(value.pauseMs, 0);
    return afterBusyShare > 0 && windowMs > 0 && pauseMs > 0 ? { afterBusyShare, windowMs, pauseMs } : undefined;
}
/** The manifest schema rejects bad shapes; these fallbacks cover a config that never went through it. */
export function resolveConfig(raw) {
    const c = isRecord(raw) ? raw : {};
    const q = isRecord(c.queue) ? c.queue : {};
    return {
        briefsDir: text(c.briefsDir),
        publishedPathPrefix: text(c.publishedPathPrefix),
        publishAgents: strings(c.publishAgents, ['research']),
        maxBriefChars: count(c.maxBriefChars, 60000),
        queue: {
            agents: strings(q.agents, []),
            maxWaitMs: count(q.maxWaitMs, 240000),
            maxWaiting: typeof q.maxWaiting === 'number' ? count(q.maxWaiting, 1) : undefined,
            startGraceMs: count(q.startGraceMs, 60000),
            maxRunMs: count(q.maxRunMs, 900000),
            rest: restConfig(q.rest),
            busyText: text(q.busyText) ?? "I'm working through a line of questions right now. Ask again in a few minutes.",
        },
    };
}
