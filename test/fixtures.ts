/** A stand-in for OpenClaw's plugin API that records what the plugin registers. All names and text are synthetic. */
import { strict as assert } from 'node:assert';
import { type PluginHost, registerTurnGuard } from '../src/index.ts';

interface ToolLike {
  execute(id: string, params: unknown): Promise<{ content: { text?: string }[]; details?: unknown }>;
}

function isTool(value: unknown): value is ToolLike {
  return typeof value === 'object' && value !== null && 'execute' in value && typeof value.execute === 'function';
}

export function defined<T>(value: T | undefined | null): T {
  assert.ok(value !== undefined && value !== null, 'expected a value');
  return value;
}

export interface Options {
  pluginConfig: Record<string, unknown>;
}

/** Stands in for OpenClaw around the plugin, on a clock the test moves. */
export function install({ pluginConfig }: Options) {
  const factories: ((ctx: { agentId?: string }) => unknown)[] = [];
  const warnings: string[] = [];
  const hooks = new Map<string, (event: object, ctx: object) => unknown>();
  const clock = { at: 0 };
  const pending: { fn: () => void; due: number }[] = [];
  const api: PluginHost = {
    pluginConfig,
    logger: { warn: (message) => warnings.push(message), info: () => {} },
    on: (name: string, handler: unknown) => {
      if (typeof handler === 'function') {
        hooks.set(name, (event, ctx) => handler(event, ctx));
      }
    },
    registerTool: (tool: unknown) => {
      if (typeof tool === 'function') {
        factories.push((ctx) => tool(ctx));
      }
    },
  };
  registerTurnGuard(api, {
    now: () => clock.at,
    setTimer: (fn, ms) => {
      const timer = { fn, due: clock.at + ms };
      pending.push(timer);
      return () => {
        const at = pending.indexOf(timer);
        if (at !== -1) {
          pending.splice(at, 1);
        }
      };
    },
  });
  return {
    warnings,
    toolFor(agentId: string): ToolLike | undefined {
      const tool = factories[0]?.({ agentId });
      return isTool(tool) ? tool : undefined;
    },
    /** An inbound message reaching `before_dispatch`: resolves with what the hook returned. Without the hook, OpenClaw just dispatches. */
    async arrive(sessionKey: string | undefined, messageId?: string): Promise<unknown> {
      return await hooks.get('before_dispatch')?.({ content: 'question', sessionKey, messageId }, {});
    },
    /** A run of the session reaching the model, as `before_agent_run` reports it. */
    start(sessionKey: string | undefined, runId?: string): void {
      hooks.get('before_agent_run')?.({ prompt: 'question', messages: [] }, { sessionKey, runId });
    },
    /** A run attempt ending, as `agent_end` reports it. */
    finish(sessionKey: string | undefined, runId?: string, success = true): void {
      hooks.get('agent_end')?.({ messages: [], success, runId }, { sessionKey });
    },
    /** Moves the clock to `to` milliseconds, firing the timers that come due on the way, in order. */
    async advance(to: number): Promise<void> {
      for (;;) {
        const due = pending.filter((timer) => timer.due <= to).toSorted((a, b) => a.due - b.due)[0];
        if (due === undefined) {
          break;
        }
        pending.splice(pending.indexOf(due), 1);
        clock.at = due.due;
        due.fn();
        await new Promise((resolve) => setImmediate(resolve));
      }
      clock.at = to;
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}
