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

export function install({ pluginConfig }: Options) {
  const factories: ((ctx: { agentId?: string }) => unknown)[] = [];
  const warnings: string[] = [];
  const logs: string[] = [];
  const hooks = new Map<string, (event: object, ctx: object) => unknown>();
  const api: PluginHost = {
    pluginConfig,
    logger: { warn: (message) => warnings.push(message), info: (message) => logs.push(message) },
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
  registerTurnGuard(api);
  return {
    warnings,
    logs,
    hooks: [...hooks.keys()].toSorted(),
    /** An inbound message reaching `before_dispatch`: resolves with what the hook returned. */
    async arrive(sessionKey: string | undefined, messageId?: string): Promise<unknown> {
      return await defined(hooks.get('before_dispatch'))({ content: 'question', sessionKey, messageId }, {});
    },
    /** A run ending, as `agent_end` reports it. */
    finish(sessionKey: string | undefined): void {
      defined(hooks.get('agent_end'))({ messages: [], success: true }, { sessionKey });
    },
    toolFor(agentId: string): ToolLike | undefined {
      const tool = factories[0]?.({ agentId });
      return isTool(tool) ? tool : undefined;
    },
  };
}
