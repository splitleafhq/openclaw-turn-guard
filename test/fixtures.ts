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
  const api: PluginHost = {
    pluginConfig,
    logger: { warn: (message) => warnings.push(message) },
    registerTool: (tool: unknown) => {
      if (typeof tool === 'function') {
        factories.push((ctx) => tool(ctx));
      }
    },
  };
  registerTurnGuard(api);
  return {
    warnings,
    toolFor(agentId: string): ToolLike | undefined {
      const tool = factories[0]?.({ agentId });
      return isTool(tool) ? tool : undefined;
    },
  };
}
