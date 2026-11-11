import type { QueueConfig } from './queue.ts';

export const PLUGIN_ID = 'turn-guard';

export interface TurnGuardConfig {
  briefsDir?: string;
  publishedPathPrefix?: string;
  publishAgents: string[];
  maxBriefChars: number;
  queue: QueueConfig & { busyText: string };
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

function share(value: unknown, fallback: number): number {
  return typeof value === 'number' && value > 0 && value <= 1 ? value : fallback;
}

/** The manifest schema rejects bad shapes; these fallbacks cover a config that never went through it. */
export function resolveConfig(raw: unknown): TurnGuardConfig {
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

