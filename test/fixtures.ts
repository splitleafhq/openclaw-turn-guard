/** A stand-in for OpenClaw's plugin API that records what the plugin registers. All names and text are synthetic. */
import { strict as assert } from 'node:assert';
import { type PluginHost, registerTurnGuard } from '../src/index.ts';

type Handler = (event: unknown, ctx: unknown) => unknown;

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
  grant?: boolean;
  runtime?: PluginHost['runtime'];
}

/** Like OpenClaw's runtime during CLI-metadata registration: reading any property throws. */
export function unavailableRuntime(): PluginHost['runtime'] {
  const target: PluginHost['runtime'] = { state: { resolveStateDir: () => '' } };
  return new Proxy(target, {
    get() {
      throw new Error('runtime is intentionally unavailable during "cli-metadata" registration');
    },
  });
}

export function install({ pluginConfig, grant = true, runtime = { state: { resolveStateDir: () => '/nonexistent-state' } } }: Options) {
  const hooks = new Map<string, Handler>();
  const factories: ((ctx: { agentId?: string }) => unknown)[] = [];
  const warnings: string[] = [];
  const api: PluginHost = {
    config: grant ? { plugins: { entries: { 'turn-guard': { hooks: { allowConversationAccess: true } } } } } : {},
    pluginConfig,
    logger: { warn: (message) => warnings.push(message) },
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
    runtime,
  };
  registerTurnGuard(api);
  return {
    warnings,
    hasHook: (name: string) => hooks.has(name),
    toolFor(agentId: string): ToolLike | undefined {
      const tool = factories[0]?.({ agentId });
      return isTool(tool) ? tool : undefined;
    },
    async fire(name: string, event: unknown, ctx: unknown) {
      return defined(hooks.get(name))(event, ctx);
    },
  };
}
