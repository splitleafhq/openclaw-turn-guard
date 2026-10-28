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
/** The manifest schema rejects bad shapes; these fallbacks cover a config that never went through it. */
export function resolveConfig(raw) {
    const c = isRecord(raw) ? raw : {};
    return {
        briefsDir: text(c.briefsDir),
        publishedPathPrefix: text(c.publishedPathPrefix),
        publishAgents: strings(c.publishAgents, ['research']),
        maxBriefChars: count(c.maxBriefChars, 60000),
    };
}
