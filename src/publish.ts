import { randomBytes } from 'node:crypto';
import { mkdir, open } from 'node:fs/promises';
import { join } from 'node:path';

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

function reason(error: unknown): string {
  const code = errno(error);
  return typeof code === 'string' ? `the write failed (${code})` : 'the write failed';
}

/** Creates the file or returns undefined when the name is taken. `wx` refuses to overwrite or follow a symlink. */
async function create(path: string, text: string): Promise<boolean> {
  let handle;
  try {
    handle = await open(path, 'wx', 0o644);
  } catch (error) {
    if (errno(error) === 'EEXIST') {
      return false;
    }
    throw error;
  }
  try {
    await handle.chmod(0o644);
    await handle.writeFile(text, 'utf8');
  } finally {
    await handle.close();
  }
  return true;
}

/** The file name is built here from the clock, a random suffix and the slug, so the caller never supplies a path. */
export async function publishBrief(topic: unknown, text: unknown, options: PublishOptions): Promise<PublishResult> {
  if (typeof text !== 'string' || text.trim() === '') {
    return { ok: false, message: 'text is empty' };
  }
  if (text.length > options.maxBriefChars) {
    return { ok: false, message: `text is ${text.length} characters; the limit is ${options.maxBriefChars}` };
  }
  const slug = slugify(typeof topic === 'string' ? topic : '');
  const now = options.now ?? (() => new Date());
  const hex = options.hex ?? (() => randomBytes(3).toString('hex'));
  const prefix = (options.publishedPathPrefix ?? options.briefsDir).replace(/\/+$/, '');
  const attempt = async (left: number): Promise<PublishResult> => {
    if (left === 0) {
      return { ok: false, message: 'could not pick an unused file name' };
    }
    const name = `${stamp(now())}-${hex()}-${slug}.md`;
    return (await create(join(options.briefsDir, name), text))
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
