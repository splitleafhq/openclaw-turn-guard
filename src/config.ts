export const PLUGIN_ID = 'turn-guard';

export interface TurnGuardConfig {
  briefsDir?: string;
  publishedPathPrefix?: string;
  publishAgents: string[];
  maxBriefChars: number;
  logFile?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function strings(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v !== '') : fallback;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function count(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : fallback;
}

/** The manifest schema rejects bad shapes; these fallbacks cover a config that never went through it. */
export function resolveConfig(raw: unknown): TurnGuardConfig {
  const c = isRecord(raw) ? raw : {};
  return {
    briefsDir: text(c.briefsDir),
    publishedPathPrefix: text(c.publishedPathPrefix),
    publishAgents: strings(c.publishAgents, ['research']),
    maxBriefChars: count(c.maxBriefChars, 60000),
    logFile: text(c.logFile),
  };
}

/** True when the operator set `plugins.entries.turn-guard.hooks.allowConversationAccess`. */
export function hasConversationAccess(config: unknown): boolean {
  const plugins = isRecord(config) && isRecord(config.plugins) ? config.plugins : {};
  const entries = isRecord(plugins.entries) ? plugins.entries : {};
  const entry = isRecord(entries[PLUGIN_ID]) ? entries[PLUGIN_ID] : {};
  return isRecord(entry.hooks) && entry.hooks.allowConversationAccess === true;
}
