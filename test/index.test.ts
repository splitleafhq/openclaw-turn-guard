import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import entry from '../src/index.ts';
import { PLUGIN_ID } from '../src/config.ts';
import { install, unavailableRuntime } from './fixtures.ts';

test('the plugin entry loads with the pinned SDK and carries the plugin id', () => {
  assert.equal(entry.id, PLUGIN_ID);
  assert.equal(typeof entry.register, 'function');
});

test('the manifest id, tool contract and defaults match the code', async () => {
  const manifest: unknown = JSON.parse(await readFile(new URL('../openclaw.plugin.json', import.meta.url), 'utf8'));
  assert.ok(typeof manifest === 'object' && manifest !== null && 'id' in manifest && 'contracts' in manifest && 'configSchema' in manifest);
  assert.equal(manifest.id, PLUGIN_ID);
  assert.deepEqual(manifest.contracts, { tools: ['publish_brief'] });
  const schema = manifest.configSchema;
  assert.ok(typeof schema === 'object' && schema !== null && 'properties' in schema && typeof schema.properties === 'object' && schema.properties !== null);
  assert.ok('maxBriefChars' in schema.properties && typeof schema.properties.maxBriefChars === 'object' && schema.properties.maxBriefChars !== null);
  assert.equal('default' in schema.properties.maxBriefChars && schema.properties.maxBriefChars.default, 60000);
});

test('register() does not touch the runtime, which is unavailable during cli-metadata registration', () => {
  const h = install({ pluginConfig: { briefsDir: '/x' }, runtime: unavailableRuntime() });
  assert.ok(h.hasHook('after_tool_call'));
  assert.ok(h.hasHook('agent_end'));
});
