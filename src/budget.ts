import { BUDGET_MESSAGE } from './config.ts';

export const MAX_AGE_MS = 6 * 60 * 60 * 1000;

interface Entry {
  seen: Set<string>;
  count: number;
  touched: number;
}

/**
 * Counts budgeted tool calls per run. Entries older than six hours are dropped on each call, so nothing needs a timer
 * and a run that never reaches `agent_end` can't grow the map.
 */
export class Budget {
  private readonly runs = new Map<string, Entry>();

  private readonly limit: number;
  private readonly now: () => number;

  constructor(limit: number, now: () => number = Date.now) {
    this.limit = limit;
    this.now = now;
  }

  /** The block reason when the call is past the budget, otherwise undefined. A repeated call id is never recounted. */
  check(key: string, callId: string | undefined): string | undefined {
    const t = this.now();
    this.evict(t);
    let entry = this.runs.get(key);
    if (!entry) {
      entry = { seen: new Set(), count: 0, touched: t };
      this.runs.set(key, entry);
    }
    entry.touched = t;
    if (callId !== undefined && entry.seen.has(callId)) {
      return undefined;
    }
    if (entry.count >= this.limit) {
      return BUDGET_MESSAGE;
    }
    entry.count += 1;
    if (callId !== undefined) {
      entry.seen.add(callId);
    }
    return undefined;
  }

  end(key: string): void {
    this.runs.delete(key);
  }

  get size(): number {
    return this.runs.size;
  }

  private evict(t: number): void {
    for (const [key, entry] of this.runs) {
      if (t - entry.touched > MAX_AGE_MS) {
        this.runs.delete(key);
      }
    }
  }
}
