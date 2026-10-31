import { isAbsolute } from 'node:path';
import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import { textResult } from 'openclaw/plugin-sdk/tool-results';
import { Type } from 'typebox';
import { PLUGIN_ID, resolveConfig } from './config.js';
import { publishBrief } from './publish.js';
const TOOL = 'publish_brief';
const PARAMETERS = Type.Object({
    topic: Type.String({ description: 'Short subject of the brief. It only names the file.' }),
    text: Type.String({ description: 'The whole brief, as Markdown.' }),
});
function fail(message) {
    return textResult(`${TOOL} failed: ${message}`, { status: 'failed' });
}
/** Agent ids are compared lowercase, as OpenClaw normalizes them. */
function listed(agentId, ids) {
    return agentId !== undefined && ids.some((id) => id.toLowerCase() === agentId.toLowerCase());
}
export function registerTurnGuard(api) {
    const config = resolveConfig(api.pluginConfig);
    const warn = (message) => api.logger?.warn?.(`[${PLUGIN_ID}] ${message}`);
    const { briefsDir } = config;
    if (briefsDir === undefined) {
        warn('briefsDir is not set: publish_brief is not registered');
    }
    else if (!isAbsolute(briefsDir)) {
        // A relative path resolves against the gateway's cwd, and the returned path would not open from the reader's.
        warn(`briefsDir is not an absolute path (${briefsDir}): publish_brief is not registered`);
    }
    else {
        api.registerTool((ctx) => {
            if (!listed(ctx.agentId, config.publishAgents)) {
                return null;
            }
            return {
                name: TOOL,
                label: 'Publish brief',
                description: 'Save a finished research brief as a Markdown file. Returns the file path. Call it once, at the end.',
                parameters: PARAMETERS,
                async execute(_id, params) {
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
        }, { name: TOOL, optional: true });
    }
}
export default definePluginEntry({
    id: PLUGIN_ID,
    name: 'Turn Guard',
    description: 'Publishes briefs to a host folder.',
    register: registerTurnGuard,
});
