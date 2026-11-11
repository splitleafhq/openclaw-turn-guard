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
            maxWaitMs: count(q.maxWaitMs, 270000),
            maxWaiting: count(q.maxWaiting, 4),
            maxHoldMs: count(q.maxHoldMs, 300000),
            restMs: count(q.restMs, 60000),
            busyShare: share(q.busyShare, 0.5),
            busyWindowMs: count(q.busyWindowMs, 600000),
            busyText: text(q.busyText) ?? "I'm working through a line of questions right now. Ask again in a few minutes.",
        },
    };
}
