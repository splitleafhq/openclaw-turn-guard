import { createHash } from 'node:crypto';
import { type OpenClawPluginApi, definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import { textResult } from 'openclaw/plugin-sdk/tool-results';
import { type Static, Type } from 'typebox';
import { JsonlLog, ToolLog, audit } from './audit.ts';
import { Budget } from './budget.ts';
import { PLUGIN_ID, hasConversationAccess, resolveConfig } from './config.ts';
import { publishBrief } from './publish.ts';

type Api = OpenClawPluginApi;

/** The parts of OpenClaw's plugin API this plugin uses. `register` passes OpenClaw's own, and tests pass a stand-in. */
export interface PluginHost {
  config: Api['config'];
  pluginConfig?: Api['pluginConfig'];
  logger?: Partial<Pick<Api['logger'], 'warn'>>;
  on: Api['on'];
  registerTool: Api['registerTool'];
  runtime: { state: Pick<Api['runtime']['state'], 'resolveStateDir'> };
}

const TOOL = 'publish_brief';

const PARAMETERS = Type.Object({
  topic: Type.String({ description: 'Short subject of the brief. It only names the file.' }),
  text: Type.String({ description: 'The whole brief, as Markdown.' }),
});

function fail(message: string) {
  return textResult(`${TOOL} failed: ${message}`, { status: 'failed' });
}

/** Agent ids are compared lowercase, as OpenClaw normalizes them. */
function listed(agentId: string | undefined, ids: string[]): boolean {
  return agentId !== undefined && ids.some((id) => id.toLowerCase() === agentId.toLowerCase());
}

/**
 * The call's id with its tool and arguments, so a server that reuses ids across different calls (index-style ids)
 * can't make two lookups count as one.
 */
function callKey(toolCallId: string | undefined, toolName: string, params: unknown): string | undefined {
  if (toolCallId === undefined) {
    return undefined;
  }
  const args = createHash('sha256').update(JSON.stringify(params) ?? '').digest('hex').slice(0, 16);
  return `${toolCallId}|${toolName}|${args}`;
}

export function registerTurnGuard(api: PluginHost): void {
  const config = resolveConfig(api.pluginConfig);
  const warn = (message: string) => api.logger?.warn?.(`[${PLUGIN_ID}] ${message}`);
  const { briefsDir } = config;

  if (briefsDir === undefined) {
    warn('briefsDir is not set: publish_brief is not registered');
  } else {
    api.registerTool(
      (ctx) => {
        if (!listed(ctx.agentId, config.publishAgents)) {
          return null;
        }
        return {
          name: TOOL,
          label: 'Publish brief',
          description: 'Save a finished research brief as a Markdown file. Returns the file path. Call it once, at the end.',
          parameters: PARAMETERS,
          async execute(_id: string, params: Static<typeof PARAMETERS>) {
            const result = await publishBrief(params.topic, params.text, {
              briefsDir,
              publishedPathPrefix: config.publishedPathPrefix,
              maxBriefChars: config.maxBriefChars,
            });
            if (!result.ok) {
              warn(`publish failed: ${result.message}`);
              return fail(result.message);
            }
            return textResult(result.path, { path: result.path, chars: result.chars });
          },
        };
      },
      { name: TOOL, optional: true },
    );
  }

  const budget = new Budget(config.budget);
  api.on('before_tool_call', (event, ctx) => {
    // A throw or timeout here blocks the call (plugins/hooks/reference.md), so every path fails open.
    try {
      if (!listed(ctx.agentId, config.budgetAgents) || !config.budgetTools.includes(event.toolName)) {
        return undefined;
      }
      // A run keeps its runId across attempts (compaction retries), so the count holds for the whole run. Without a
      // runId the call is not counted: a shared bucket would let unrelated runs block each other.
      const key = event.runId ?? ctx.runId;
      if (key === undefined) {
        return undefined;
      }
      const reason = budget.check(key, callKey(event.toolCallId ?? ctx.toolCallId, event.toolName, event.params));
      return reason === undefined ? undefined : { block: true, blockReason: reason };
    } catch {
      return undefined;
    }
  });

  const tools = new ToolLog();
  const logFile = config.logFile ?? `${api.runtime.state.resolveStateDir(process.env)}/logs/turn-guard.jsonl`;
  const log = new JsonlLog(logFile, warn);
  api.on('after_tool_call', (event, ctx) => {
    const runId = event.runId ?? ctx.runId;
    if (runId !== undefined) {
      tools.record(runId, event.toolName, event.error === undefined);
    }
  });

  if (!hasConversationAccess(api.config)) {
    warn('hooks.allowConversationAccess is not set: agent_end is not registered, so the claim and error log is off');
    return;
  }
  // agent_end fires once per attempt, not per run (a compaction retry re-enters with the same runId), so it neither
  // resets the budget nor drops the run's tool record: both age out after six hours.
  api.on('agent_end', async (event, ctx) => {
    try {
      const runId = event.runId ?? ctx.runId;
      const who = { agentId: ctx.agentId, sessionKey: ctx.sessionKey, runId };
      await log.write(audit(event, who, tools.list(runId), new Date()));
    } catch {
      warn('agent_end check failed');
    }
  });
}

export default definePluginEntry({
  id: PLUGIN_ID,
  name: 'Turn Guard',
  description: 'Caps web lookups per run, publishes briefs to a host folder, and logs unbacked "I sent it" claims and run errors.',
  register: registerTurnGuard,
});
