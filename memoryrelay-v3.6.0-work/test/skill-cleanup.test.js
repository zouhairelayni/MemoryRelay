import test from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './helpers/d1.js';
import { resetSchemaCache, ensureSchema } from '../worker/db.js';
import { seedBuiltins } from '../worker/builtins.js';
import { deleteSkill, addSkill } from '../worker/skills.js';
import { callTool } from '../worker/mcp.js';

async function fixture() {
  resetSchemaCache();
  const {db, DB} = createD1();
  const env = {DB};
  await ensureSchema(env);
  await seedBuiltins(env);
  return {db, env};
}

test('deleting a skill removes linked Python scripts and official resources, not other skills', async () => {
  const {db, env} = await fixture();
  assert.equal(db.prepare('SELECT COUNT(*) n FROM skill_scripts WHERE skill = ?').get('webapp-testing').n, 1);
  await env.DB.prepare('INSERT INTO skill_resources (skill,path,kind,content,url) VALUES (?,?,?,?,?)')
    .bind('webapp-testing', 'scripts/official-test.py', 'script', 'print("test")', '').run();
  await env.DB.prepare('INSERT INTO skill_resources (skill,path,kind,content,url) VALUES (?,?,?,?,?)')
    .bind('canvas-design', 'scripts/canvas.py', 'script', 'print("keep")', '').run();
  const result = await deleteSkill(env, 'webapp-testing');
  assert.deepEqual(result, {deleted: 1, scripts_deleted: 1, resources_deleted: 1});
  assert.equal(db.prepare('SELECT COUNT(*) n FROM skills WHERE name = ?').get('webapp-testing').n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM skill_scripts WHERE skill = ?').get('webapp-testing').n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM skill_resources WHERE skill = ?').get('webapp-testing').n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM skill_resources WHERE skill = ?').get('canvas-design').n, 1);
  await assert.rejects(callTool(env, 'get_skill_script', {name: 'webapp-smoke'}), /script not found/);
  await assert.rejects(callTool(env, 'get_skill_resource', {skill: 'webapp-testing',path: 'scripts/official-test.py'}), /resource not found/);
  assert.deepEqual(await deleteSkill(env, 'webapp-testing'), {deleted: 0, scripts_deleted: 0, resources_deleted: 0});
});

test('agent can propose deleted skill again for owner approval, without affecting other resources', async () => {
  const {db,env} = await fixture();
  await deleteSkill(env, 'canvas-design');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM skill_scripts WHERE skill = ?').get('canvas-design').n, 0);
  const added = await addSkill(env, '---\nname: canvas-design\ndescription: Use when drawing custom illustrations.\n---\nDraw from a local specification.\n', 'agent');
  assert.equal(added.ok, true);
  assert.equal(added.pending, true);
  assert.equal(db.prepare('SELECT enabled FROM skills WHERE name = ?').get('canvas-design').enabled, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM skill_scripts WHERE skill = ?').get('webapp-testing').n, 1);
});
