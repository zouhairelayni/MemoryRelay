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
