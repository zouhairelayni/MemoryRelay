import test from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './helpers/d1.js';
import { resetSchemaCache } from '../worker/db.js';
import worker from '../worker/index.js';

const setup = async () => {
  resetSchemaCache();
  const { DB } = createD1();
  const env = {DB, ASSETS: {fetch: async () => new Response('<div id="root"></div>')}};
  const ctx = {waitUntil: p => p};
  const call = (path, init) => worker.fetch(new Request('http://localhost' + path, init), env, ctx);
  const setupResponse = await call('/auth/setup', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({email:'test@memoryrelay.dev',password:'longenough12'})});
  assert.equal(setupResponse.status, 200);
  const cookie = setupResponse.headers.get('set-cookie').split(';')[0];
  const api = (path, method = 'GET', body) => call(path,{method,headers:{cookie,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});
  return {api,call,env};
};

test('GitHub token status is visible to owner but token itself is never returned', async () => {
  const {api,call,env} = await setup();
  assert.equal((await (await api('/api/skill-repos')).json()).token_configured, false);
  env.GITHUB_TOKEN = 'github_pat_DO_NOT_EXPOSE_diagnostic';
  const response = await (await api('/api/skill-repos')).text();
  assert.equal(JSON.parse(response).token_configured, true);
  assert.ok(!response.includes(env.GITHUB_TOKEN));
  assert.equal((await call('/api/skill-repos')).status, 401);
});

test('Gemini model catalog uses previously stored enabled keys, falling back on invalid key', async () => {
  const {api} = await setup();
  await api('/api/gemini','POST',{op:'add_key',label:'expired',key:'expired-gemini'});
  await api('/api/gemini','POST',{op:'add_key',label:'working',key:'saved-gemini'});
  const originalFetch = globalThis.fetch;
  const seen=[];
  globalThis.fetch = async (_url,opts={}) => {
    seen.push(opts.headers['x-goog-api-key']);
    return opts.headers['x-goog-api-key']==='saved-gemini'
      ? new Response(JSON.stringify({models:[{name:'models/gemini-2.5-flash',supportedGenerationMethods:['generateContent']},{name:'models/embedding-001',supportedGenerationMethods:['embedContent']}]}),{status:200,headers:{'content-type':'application/json'}})
      : new Response('invalid',{status:401});
  };
  try {
    const result=await api('/api/gemini/models');
    assert.equal(result.status,200);
    assert.deepEqual((await result.json()).models,['gemini-2.5-flash']);
    assert.deepEqual(seen,['expired-gemini','saved-gemini']);
    assert.equal((await (await api('/api/gemini')).json()).keys.length,2);
  } finally { globalThis.fetch=originalFetch; }
});

test('OpenAI catalog uses saved keys and retries another key without adding a new one', async () => {
  const {api} = await setup();
  await api('/api/openai','POST',{op:'add_key',key:'sk-expired-key'});
  await api('/api/openai','POST',{op:'add_key',key:'sk-valid-key'});
  const oldFetch=globalThis.fetch,seen=[];
  globalThis.fetch=async (_url,opts={})=>{
    seen.push(opts.headers.authorization);
    if(opts.headers.authorization==='Bearer sk-valid-key') return new Response(JSON.stringify({data:[{id:'gpt-4.1-mini'},{id:'text-embedding-3-large'}]}),{status:200,headers:{'content-type':'application/json'}});
    return new Response('not authorized',{status:401});
  };
  try{
    const result=await api('/api/openai/models');
    assert.equal(result.status,200);
    assert.deepEqual((await result.json()).models.map(m=>m.id),['gpt-4.1-mini']);
    assert.deepEqual(seen,['Bearer sk-expired-key','Bearer sk-valid-key']);
  } finally {globalThis.fetch=oldFetch;}
});
