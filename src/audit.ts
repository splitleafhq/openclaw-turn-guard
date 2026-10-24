import { mkdir } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { root } from 'openclaw/plugin-sdk/security-runtime';
import { MAX_AGE_MS } from './budget.ts';

const VERBS = 'sent|queued|dispatched|scheduled|posted|forwarded|delivered|submitted';
const ADVERBS = '(?:(?:just|already|now|also|successfully|gone ahead and|went ahead and)\\s+)*';

/**
 * First person ("I've sent", "we went ahead and queued"), passive without an agent ("has been sent", "is queued", not
 * "was sent by Regis") and a bare verb opening a sentence ("Queued.", "Message sent."). A heuristic for a log, so it
 * leans toward matching.
 */
const CLAIMS = [
  new RegExp(`\\b(?:I|we)(?:['’]ve| have)?\\s+${ADVERBS}(${VERBS})\\b`, 'i'),
  new RegExp(`\\b(?:has|have|had) been\\s+${ADVERBS}(${VERBS})\\b(?!\\s+by\\b)`, 'i'),
  new RegExp(`\\b(?:is|are|was|were)\\s+(?:now\\s+)?(${VERBS})\\b(?!\\s+by\\b)`, 'i'),
  new RegExp(`(?:^|[.!?]\\s+|\\n\\s*)(?:(?:message|brief|it|request|task|job)\\s+)?(${VERBS})\\s*[.!]`, 'i'),
];

/** Tools whose successful call backs each claimed verb. A claim with none of these in the run is logged. */
export const BACKING_TOOLS: Record<string, string[]> = {
  sent: ['message', 'sessions_send', 'conversations_send', 'publish_brief'],
  forwarded: ['message', 'sessions_send', 'conversations_send'],
  delivered: ['message', 'sessions_send', 'conversations_send', 'publish_brief'],
  posted: ['message', 'publish_brief'],
  // Hooks report cron as `automations` (OpenClaw 2026.10.5 TOOL_NAME_ALIASES); `cron` is kept for older names.
  queued: ['sessions_send', 'sessions_spawn', 'automations', 'cron', 'message'],
  submitted: ['sessions_send', 'sessions_spawn', 'automations', 'cron', 'message'],
  dispatched: ['sessions_send', 'sessions_spawn', 'message'],
  scheduled: ['automations', 'cron'],
};

export interface Claim {
  verb: string;
  phrase: string;
}

/** The earliest claim in the text, with up to 120 characters of text around it. */
export function findClaim(text: string): Claim | undefined {
  let first: RegExpExecArray | undefined;
  for (const pattern of CLAIMS) {
    const match = pattern.exec(text);
    if (match?.[1] && (first === undefined || match.index < first.index)) {
      first = match;
    }
  }
  if (!first?.[1]) {
    return undefined;
  }
  const start = Math.max(0, first.index - 50);
  return { verb: first[1].toLowerCase(), phrase: text.slice(start, start + 120).replaceAll(/\s+/g, ' ').trim() };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** The text of the last assistant message, or '' when there is none. */
export function finalAssistantText(messages: unknown): string {
  if (!Array.isArray(messages)) {
    return '';
  }
  for (let i = messages.length - 1; i >= 0; i--) {
    const message: unknown = messages[i];
    if (!isRecord(message) || message.role !== 'assistant') {
      continue;
    }
    const { content } = message;
    if (typeof content === 'string') {
      return content;
    }
    if (Array.isArray(content)) {
      return content
        .map((block: unknown) => (isRecord(block) && block.type === 'text' && typeof block.text === 'string' ? block.text : ''))
        .join('\n');
    }
    return '';
  }
  return '';
}

export interface ToolRecord {
  name: string;
  ok: boolean;
}

interface Run {
  tools: ToolRecord[];
  touched: number;
}

const MAX_TOOLS_PER_RUN = 200;

/** Tool calls per run, from `after_tool_call`. Evicts runs older than six hours on each call. */
export class ToolLog {
  private readonly runs = new Map<string, Run>();

  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  record(runId: string, name: string, ok: boolean): void {
    const t = this.now();
    this.evict(t);
    const run = this.runs.get(runId) ?? { tools: [], touched: t };
    run.touched = t;
    if (run.tools.length < MAX_TOOLS_PER_RUN) {
      run.tools.push({ name, ok });
    }
    this.runs.set(runId, run);
  }

  /** The run's calls so far. Kept after reading: a later attempt of the same run still sees them. */
  list(runId: string | undefined): ToolRecord[] {
    return runId === undefined ? [] : [...(this.runs.get(runId)?.tools ?? [])];
  }

  private evict(t: number): void {
    for (const [key, run] of this.runs) {
      if (t - run.touched > MAX_AGE_MS) {
        this.runs.delete(key);
      }
    }
  }
}

export interface Entry {
  time: string;
  kind: 'unbacked-claim' | 'run-error';
  agentId?: string;
  sessionKey?: string;
  runId?: string;
  phrase?: string;
  error?: string;
  tools: ToolRecord[];
}

/** Appends JSON lines through OpenClaw's `root().append`, creating the file at mode 0600. Never throws: a log failure must not touch the run. */
export class JsonlLog {
  private readonly file: string;
  private readonly warn: (message: string) => void;

  constructor(file: string, warn: (message: string) => void) {
    this.file = file;
    this.warn = warn;
  }

  async write(entries: Entry[]): Promise<void> {
    if (entries.length === 0) {
      return;
    }
    try {
      await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
      await (await root(dirname(this.file))).append(basename(this.file), entries.map((e) => `${JSON.stringify(e)}\n`).join(''), { mode: 0o600 });
    } catch {
      this.warn(`could not write ${this.file}`);
    }
  }
}

/** Entries for one finished attempt: an unbacked claim, a run error, both or neither. */
export function audit(
  run: { success: boolean; error?: string; messages: unknown },
  who: { agentId?: string; sessionKey?: string; runId?: string },
  tools: ToolRecord[],
  now: Date,
): Entry[] {
  const base = { time: now.toISOString(), ...who, tools };
  const entries: Entry[] = [];
  const claim = findClaim(finalAssistantText(run.messages));
  if (claim) {
    const backing = BACKING_TOOLS[claim.verb] ?? [];
    if (!tools.some((t) => t.ok && backing.includes(t.name))) {
      entries.push({ ...base, kind: 'unbacked-claim', phrase: claim.phrase });
    }
  }
  // Only an error counts: an abort, a yield or a timeout also ends with success false and no error.
  if (run.error !== undefined && run.error !== '') {
    entries.push({ ...base, kind: 'run-error', error: run.error.slice(0, 300) });
  }
  return entries;
}
