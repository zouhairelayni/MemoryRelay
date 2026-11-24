import test from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './helpers/d1.js';
import { ensureSchema, resetSchemaCache } from '../worker/db.js';
import { seedBuiltins } from '../worker/builtins.js';
import { OFFICIAL_SHA, OFFICIAL_SKILLS, OFFICIAL_RESOURCES } from '../worker/anthropicUpstream.generated.js';
import { selectSkills, formatForAgent, toSkillMd } from '../worker/skills.js';
import { callTool } from '../worker/mcp.js';

test('official skill import round-trip is lossless and delivers associated files', async(t) => {
  if (!OFFICIAL_SHA) { t.skip('run after upstream sync (official source not fetched in offline runner)'); return; }
  resetSchemaCache();
  const {DB, db} = createD1();
  const env = {DB};
  await ensureSchema(env);
  await seedBuiltins(env);
  for (const original of OFFICIAL_SKILLS) {
    const row = db.prepare('SELECT * FROM skills WHERE name = ?').get(original.name);
    assert.equal(row.source, 'builtin:anthropic-official');
    assert.equal(toSkillMd(row), original.content);
  }
  const r=OFFICIAL_RESOURCES.find(x=>x.kind==='script' && x.content);
  if (r) {
    const fetched=await callTool(env,'get_skill_resource',{skill:r.skill,path:r.path});
    assert.equal(fetched.content,r.content);
    const selected=await selectSkills(env,{request:'Use playwright for testing my local webapp and capture console failures'}, {useGemini:false});
    assert.match(formatForAgent(selected),/ORIGINAL UPSTREAM RESOURCES/);
  }
  const count=db.prepare('SELECT COUNT(*) n FROM skill_resources').get().n;
  assert.equal(count,OFFICIAL_RESOURCES.length);
  const code=OFFICIAL_SKILLS.find(x=>x.name==='frontend-design');
  assert.ok(code?.content.length>1000);
  const officialFrontend=OFFICIAL_RESOURCES.filter(x=>x.skill==='frontend-design' && x.kind==='script');
  assert.equal(officialFrontend.length,0,'frontend-design does not ship scripts');
});
