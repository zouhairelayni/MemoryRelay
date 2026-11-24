import test from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './helpers/d1.js';
import { resetSchemaCache } from '../worker/db.js';
import worker from '../worker/index.js';

test('stale MCP tool schemas can page and read full Markdown using search(query, limit)', async () => {
  resetSchemaCache();
  const { DB } = createD1();
  const env = { DB, ASSETS: { fetch: async () => new Response('index') } };
  const call = (path, options) => worker.fetch(new Request('http://localhost' + path, options), env, { waitUntil() {} });
  const setup = await call('/auth/setup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'test@local.invalid', password: 'testing-long-password-123' }) });
  assert.equal(setup.status, 200);
  const cookie = setup.headers.get('set-cookie').split(';')[0];
  const services = await (await call('/api/services', { headers: { cookie } })).json();
  const url = services.services[0].url;
  const tool = async (name, args) => {
    const response = await call(new URL(url, 'http://localhost').pathname, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
    const data = await response.json();
    assert.equal(data.result?.isError, undefined, data.result?.content?.[0]?.text);
    const raw = data.result.content[0].text; try { return JSON.parse(raw); } catch { return raw; }
  };
  const saved = await tool('remember', { text: '**Archive release**\n- *Evidence:* retained', description: 'Old release' });
  const id = String(saved).match(/[a-f0-9]{12}/)?.[0];
  assert.ok(id);
  const first = await tool('search', { query: '@page:0', limit: 100 });
  assert.ok(first.results.some(m => m.id === id));
  assert.ok(!Object.hasOwn(first.results[0], 'text'));
  const full = await tool('search', { query: '@read:' + id, limit: 100 });
  assert.equal(full.id, id);
  assert.match(full.text, /Archive release/);
  assert.equal((await tool('get_memory', { memory_id: id })).text, full.text);
});
