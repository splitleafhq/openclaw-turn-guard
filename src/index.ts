import { isAbsolute } from 'node:path';
import { type OpenClawPluginApi, definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import { textResult } from 'openclaw/plugin-sdk/tool-results';
import { type Static, Type } from 'typebox';
import { PLUGIN_ID, resolveConfig } from './config.ts';
import { publishBrief } from './publish.ts';

type Api = OpenClawPluginApi;

/** The parts of OpenClaw's plugin API this plugin uses. `register` passes OpenClaw's own, and tests pass a stand-in. */
export interface PluginHost {
  pluginConfig?: Api['pluginConfig'];
  logger?: Partial<Pick<Api['logger'], 'warn'>>;
  registerTool: Api['registerTool'];
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

export function registerTurnGuard(api: PluginHost): void {
  const config = resolveConfig(api.pluginConfig);
  const warn = (message: string) => api.logger?.warn?.(`[${PLUGIN_ID}] ${message}`);
  const { briefsDir } = config;

  if (briefsDir === undefined) {
    warn('briefsDir is not set: publish_brief is not registered');
  } else if (!isAbsolute(briefsDir)) {
    // A relative path resolves against the gateway's cwd, and the returned path would not open from the reader's.
    warn(`briefsDir is not an absolute path (${briefsDir}): publish_brief is not registered`);
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

}

export default definePluginEntry({
  id: PLUGIN_ID,
  name: 'Turn Guard',
  description: 'Publishes briefs to a host folder.',
  register: registerTurnGuard,
});
