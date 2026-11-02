import test from 'node:test';
import assert from 'node:assert/strict';
import {createD1} from './helpers/d1.js';
import {ensureSchema,resetSchemaCache} from '../worker/db.js';
import {activity,monitor} from '../worker/monitor.js';

test('activity monitoring reports skill calls, provider tokens, failures, and running subagent briefs',async()=>{
 resetSchemaCache();const {db,DB}=createD1();const env={DB};await ensureSchema(env);
 await activity(env,{service:'svc1',category:'skill',action:'selected',detail:'frontend-design'});
 await activity(env,{service:'svc1',category:'provider',action:'api_call',provider:'gemini',model:'demo',tin:380,tout:120});
 await activity(env,{service:'svc1',category:'mcp',action:'delegate',ok:false,code:'TOOL_FAILED',message:'Safe error message'});
 await env.DB.prepare("INSERT INTO delegations(service_id,kind,ts,state,task_summary) VALUES (?,?,?,'running',?)")
   .bind('svc1','review',Date.now()-15000,'Audit project dependencies').run();
 const result=await monitor(env,7);
 assert.equal(result.counts.tokens_in,380);assert.equal(result.counts.tokens_out,120);
 assert.equal(result.counts.skills,1);assert.equal(result.counts.active,1);
 assert.equal(result.jobs[0].task_summary,'Audit project dependencies');
 assert.ok(result.jobs[0].ts<Date.now());
 assert.equal(result.errors[0].error_code,'TOOL_FAILED');
 assert.equal(result.errors[0].error_message,'Safe error message');
 assert.equal(db.prepare('SELECT COUNT(*) n FROM activity_events').get().n,3);
});

test('hour and day periods keep separate five-minute and hourly trend buckets', async () => {
  resetSchemaCache();const {DB}=createD1(),env={DB};await ensureSchema(env);
  await activity(env,{category:'mcp',action:'remember'});
  await activity(env,{category:'provider',action:'api_call',tin:20,tout:9});
  await activity(env,{category:'api',action:'PUT /api/settings',ok:false,code:'HTTP_400'});
  for(const [period,step] of [['1h',300000],['1d',3600000]]){
    const result=await monitor(env,period);
    assert.equal(result.period,period);assert.equal(result.step,step);
    assert.equal(result.counts.requests,3);assert.equal(result.counts.tokens_in,20);
    assert.ok(result.series.some(x=>x.category==='mcp'&&x.action==='remember'));
    assert.ok(result.series.every(x=>Number(x.bucket)%step===0));
    assert.equal(result.totals.find(x=>x.category==='api').errors,1);
  }
  assert.equal((await monitor(env,'not-a-period')).period,'30');
});

test('skill selection limit persists and rejects invalid values',async()=>{
  resetSchemaCache();const {DB}=createD1(),env={DB};await ensureSchema(env);
  const {getSkillSettings,setSkillMax}=await import('../worker/skills.js');
  assert.equal((await setSkillMax(env,8)).max,8);
  assert.equal((await getSkillSettings(env)).max,8);
  for(const value of [0,9,-1,'wrong',1.5])assert.match((await setSkillMax(env,value)).error,/1 to 8/);
  assert.equal((await getSkillSettings(env)).max,8);
  assert.equal((await setSkillMax(env,1)).max,1);
});


test('older running agents remain visible after forty newer completed jobs',async()=>{
  resetSchemaCache();const {DB}=createD1(),env={DB};await ensureSchema(env);
  await DB.prepare("INSERT INTO delegations(service_id,kind,ts,state,task_summary) VALUES ('','review',?,'running','still processing')")
    .bind(Date.now()-600000).run();
  for(let i=0;i<40;i++)await DB.prepare("INSERT INTO delegations(service_id,kind,ts,state) VALUES ('','review',?,'completed')")
    .bind(Date.now()-i*1000).run();
  const result=await monitor(env,'1h');
  assert.equal(result.counts.active,1);
  assert.equal(result.jobs[0].state,'running');
  assert.equal(result.jobs[0].task_summary,'still processing');
});
