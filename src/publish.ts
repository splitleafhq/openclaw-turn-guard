import { randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { FsSafeError, root } from 'openclaw/plugin-sdk/security-runtime';

export type PublishResult = { ok: true; path: string; chars: number } | { ok: false; message: string };

export interface PublishOptions {
  briefsDir: string;
  publishedPathPrefix?: string;
  maxBriefChars: number;
  now?: () => Date;
  hex?: () => string;
}

/** Lowercase `[a-z0-9-]`, at most 40 characters, never empty and never a path. */
export function slugify(topic: string): string {
  const slug = topic
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, 40)
    .replaceAll(/-+$/g, '');
  return slug === '' ? 'brief' : slug;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** UTC, so the name doesn't depend on the gateway's time zone. */
export function stamp(date: Date): string {
  const day = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  return `${day}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
}

function errno(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
}

/** fs-safe reports a failed write as `invalid-path` and keeps the OS error in `cause`. */
function reason(error: unknown): string {
  const cause = error instanceof FsSafeError ? errno(error.cause) : undefined;
  const code = typeof cause === 'string' ? cause : errno(error);
  return typeof code === 'string' ? `the write failed (${code})` : 'the write failed';
}

/**
 * Creates the file through OpenClaw's `root().create` with `atomic`, which publishes the finished file without ever
 * replacing an existing entry. A taken name, including one held by a symlink, is reported as `already-exists` or
 * `path-alias`. Returns false when the name is taken.
 */
async function create(dir: string, name: string, text: string): Promise<boolean> {
  try {
    await (await root(dir)).create(name, text, { atomic: true, mode: 0o644 });
    return true;
  } catch (error) {
    if (error instanceof FsSafeError && (error.code === 'already-exists' || error.code === 'path-alias')) {
      return false;
    }
    throw error;
  }
}

/** The file name is built here from the clock, a random suffix and the slug, so the caller never supplies a path. */
export async function publishBrief(topic: string, text: string, options: PublishOptions): Promise<PublishResult> {
  if (text.trim() === '') {
    return { ok: false, message: 'text is empty' };
  }
  if (text.length > options.maxBriefChars) {
    return { ok: false, message: `text is ${text.length} characters; the limit is ${options.maxBriefChars}` };
  }
  const slug = slugify(topic);
  const now = options.now ?? (() => new Date());
  const hex = options.hex ?? (() => randomBytes(3).toString('hex'));
  const prefix = (options.publishedPathPrefix ?? options.briefsDir).replace(/\/+$/, '');
  const attempt = async (left: number): Promise<PublishResult> => {
    if (left === 0) {
      return { ok: false, message: 'could not pick an unused file name' };
    }
    const name = `${stamp(now())}-${hex()}-${slug}.md`;
    return (await create(options.briefsDir, name, text))
      ? { ok: true, path: `${prefix}/${name}`, chars: text.length }
      : attempt(left - 1);
  };
  try {
    await mkdir(options.briefsDir, { recursive: true, mode: 0o755 });
    return await attempt(5);
  } catch (error) {
    return { ok: false, message: reason(error) };
  }
}
