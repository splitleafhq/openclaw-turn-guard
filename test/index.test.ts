import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import entry from '../src/index.ts';
import { PLUGIN_ID } from '../src/config.ts';

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
  assert.ok('budget' in schema.properties && typeof schema.properties.budget === 'object' && schema.properties.budget !== null);
  assert.equal('default' in schema.properties.budget && schema.properties.budget.default, 16);
});
