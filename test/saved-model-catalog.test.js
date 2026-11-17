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

test('GitHub tokens are owner-only, encrypted, replaceable, and used by sync before the Worker secret', async () => {
  const {api,call,env} = await setup();
  const token = 'ghp_' + 'a'.repeat(36), replacement = 'github_pat_' + 'b'.repeat(40);
  env.GITHUB_TOKEN = 'worker-fallback';
  const oldFetch = globalThis.fetch, seen = [];
  globalThis.fetch = async (url, opts = {}) => {
    seen.push([String(url), opts.headers.Authorization]);
    if (String(url).endsWith('/rate_limit')) return new Response(JSON.stringify({resources:{core:{limit:5000,remaining:4999}}}));
    if (String(url).includes('/info/refs')) return new Response('', {status:404});
    if (String(url).includes('/commits/main')) return new Response(JSON.stringify({sha:'a'.repeat(40),commit:{tree:{sha:'b'.repeat(40)}}}));
    if (String(url).includes('/git/trees/')) return new Response(JSON.stringify({tree:[],truncated:false}));
    throw Error('Unexpected request');
  };
  try {
    assert.equal((await call('/api/github-token',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({token})})).status,401);
    assert.equal((await call('/api/github-token',{method:'DELETE'})).status,401);
    env.KEY_SECRET = 'test-encryption-secret';
    assert.equal((await api('/api/github-token','PUT',{token:'Bearer '+token})).status,400);
    await env.DB.prepare("INSERT INTO config (key,value) VALUES ('github_blocked_until',?)").bind((Date.now()+3600000)+':1').run();
    const saved = await api('/api/github-token','PUT',{token});
    assert.equal(saved.status,200);
    assert.ok(!(await saved.text()).includes(token));
    const stored = await env.DB.prepare("SELECT value FROM config WHERE key='github_token'").first();
    assert.match(stored.value,/^enc:v1:/);
    assert.ok(!stored.value.includes(token));
    const info = await (await api('/api/skill-repos')).json();
    assert.equal(info.token_source,'database');
    assert.equal(info.blocked_until,'');
    assert.equal(info.token_configured,true);
    const repo = await (await api('/api/skill-repos','POST',{repo:'owner/private'})).json();
    assert.equal((await api('/api/skill-repos/'+encodeURIComponent(repo.id)+'/sync','POST',{})).status,200);
    assert.ok(seen.some(([url,auth])=>url.includes('/commits/')&&auth==='Bearer '+token));
    assert.ok(seen.some(([url,auth])=>url.includes('/info/refs')&&auth==='Basic '+btoa('x-access-token:'+token)));
    assert.equal((await api('/api/github-token','PUT',{token:replacement})).status,200);
    const {openKey} = await import('../worker/secrets.js');
    assert.equal(await openKey(env,(await env.DB.prepare("SELECT value FROM config WHERE key='github_token'").first()).value),replacement);
    // A rejected replacement must preserve the working saved token.
    globalThis.fetch = async()=>new Response('',{status:401});
    assert.equal((await api('/api/github-token','PUT',{token})).status,400);
    assert.equal(await openKey(env,(await env.DB.prepare("SELECT value FROM config WHERE key='github_token'").first()).value),replacement);
    delete env.KEY_SECRET;
    const locked = await (await api('/api/skill-repos')).json();
    assert.equal(locked.token_locked,true);
    assert.equal(locked.token_configured,false);
    assert.equal((await api('/api/skill-repos/'+encodeURIComponent(repo.id)+'/sync','POST',{})).status,400);
    const removed = await (await api('/api/github-token','DELETE')).json();
    assert.equal(removed.token_source,'worker');
    assert.equal(removed.token_saved,false);
    assert.equal(await env.DB.prepare("SELECT value FROM config WHERE key='github_token'").first(),null);
  } finally { globalThis.fetch = oldFetch; }
});


test('GitHub token saving works without KEY_SECRET and enabling encryption migrates the saved token', async () => {
  const {api,env} = await setup();
  const token = 'ghp_' + 'c'.repeat(36);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({resources:{core:{limit:5000,remaining:4999}}}));
  try {
    const response = await api('/api/github-token','PUT',{token});
    assert.equal(response.status,200);
    const text = await response.text();
    assert.ok(!text.includes(token));
    const state = JSON.parse(text);
    assert.equal(state.token_saved,true);
    assert.equal(state.token_configured,true);
    assert.equal(state.token_encrypted,false);
    assert.equal(state.token_encryption_enabled,false);
    const readStored = async () => (await env.DB.prepare("SELECT value FROM config WHERE key='github_token'").first()).value;
    assert.equal(await readStored(),token);
    const info = await (await api('/api/skill-repos')).json();
    assert.equal(info.token_saved,true);
    assert.equal(info.token_encrypted,false);
    assert.ok(!JSON.stringify(info).includes(token));
    assert.ok(!(await (await api('/api/export')).text()).includes(token));
    env.KEY_SECRET = 'enable-encryption-later';
    const {sealAllKeys,openKey} = await import('../worker/secrets.js');
    assert.equal(await sealAllKeys(env),1);
    assert.match(await readStored(),/^enc:v1:/);
    assert.equal(await openKey(env,await readStored()),token);
    assert.equal(await sealAllKeys(env),0);
    assert.equal((await (await api('/api/skill-repos')).json()).token_encrypted,true);
  } finally { globalThis.fetch = originalFetch; }
});
