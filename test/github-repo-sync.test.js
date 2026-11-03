import test from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './helpers/d1.js';
import { resetSchemaCache, ensureSchema } from '../worker/db.js';
import { seedBuiltins } from '../worker/builtins.js';
import { addSkillRepo, listSkillRepos, repoArgs, setSkillRepoSync, syncEnabledSkillRepos, syncSkillRepo } from '../worker/githubSkills.js';
import { deleteSkill, selectSkills, formatForAgent } from '../worker/skills.js';

const sha1 = 'a'.repeat(40),sha2='b'.repeat(40),treeSha='c'.repeat(40);
const fn = (name)=>`---\nname: ${name}\ndescription: Use when reviewing a demo workflow.\n---\n# Demo\n\n${'Exact official source. '.repeat(70)}\n`;
function githubMock(ref=sha1){
 const original=globalThis.fetch;
 const responses=(url)=>{
  const s=String(url);
  if(s.endsWith('/commits/main'))return {sha:ref,commit:{tree:{sha:treeSha}}};
  if(s.includes('/git/trees/'))return {truncated:false,tree:[
   {type:'blob',path:'skills/demo-tool/SKILL.md',size:5000},
   {type:'blob',path:'skills/demo-tool/scripts/test.py',size:42},
   {type:'blob',path:'skills/demo-tool/refs/guide.md',size:60},
   {type:'blob',path:'skills/demo-tool/assets/icon.png',size:300},
  ]};
  if(s.endsWith('/SKILL.md'))return fn('demo-tool');
  if(s.endsWith('/test.py'))return `print('version ${ref[0]}')\n`;
  if(s.endsWith('/guide.md'))return 'Keep this guide unchanged.';
  throw Error('unexpected mocked GitHub URL '+s);
 };
 globalThis.fetch=async url=>({ok:true,headers:new Headers(),json:async()=>responses(url),text:async()=>responses(url)});
 return ()=>{globalThis.fetch=original};
}
async function fixture(){resetSchemaCache();const {db,DB}=createD1();const env={DB};await ensureSchema(env);await seedBuiltins(env);return {env,db};}

test('GitHub repo parsing accepts GitHub sources only, and tracks one skill set per folder',()=>{
 assert.equal(repoArgs('https://github.com/example/demo','skills','main','demo-tool').id,'example/demo:skills');
 assert.throws(()=>repoArgs('https://evil.test/x/y'),/GitHub owner/);
 assert.throws(()=>repoArgs('example/demo','../secret'),/GitHub owner/);
});

test('GitHub repo switch controls automatic sync; scripts update, delete with skill, and can be reimported',async()=>{
 const {env,db}=await fixture();
 let restore=githubMock();
 try {
  const created=await addSkillRepo(env,{repo:'example/demo',names:'demo-tool'});
  assert.equal(created.ok,true);
  const repo=created.id;
  assert.equal((await listSkillRepos(env)).find(x=>x.id===repo).enabled,false);
  await syncEnabledSkillRepos(env);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM skills WHERE name = ?').get('demo-tool').n,0);
  const imported=await syncSkillRepo(env,repo,{importMissing:true});
  assert.equal(imported.complete,true);
  assert.equal(db.prepare('SELECT content FROM skill_resources WHERE skill = ? AND path = ?').get('demo-tool','scripts/test.py').content,"print('version a')\n");
  const picked=await selectSkills(env,{request:'reviewing a demo workflow demo-tool'},{useGemini:false});
  assert.ok(picked.skills.some(x=>x.name==='demo-tool' && x.resources?.some(f=>f.path==='scripts/test.py')),
    'GitHub-installed skill must include its resource listing when selected');
  assert.match(formatForAgent(picked), /scripts\/test\.py/);

  assert.match(db.prepare('SELECT body FROM skills WHERE name = ?').get('demo-tool').body,/Exact official source/);
  await setSkillRepoSync(env,repo,true);
  restore();restore=githubMock(sha2);
  await env.DB.prepare("UPDATE skill_repos SET last_checked='2026-10-01 00:00' WHERE id=?").bind(repo).run();
  await syncEnabledSkillRepos(env);
  assert.equal(db.prepare('SELECT content FROM skill_resources WHERE skill = ? AND path = ?').get('demo-tool','scripts/test.py').content,"print('version b')\n");
  assert.equal(db.prepare('SELECT COUNT(*) n FROM skill_resources WHERE skill = ?').get('demo-tool').n,1);
  await deleteSkill(env,'demo-tool');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM skill_resources WHERE skill = ?').get('demo-tool').n,0);
  // Deletion is respected by automatic sync without creating a blacklist.
  restore();restore=githubMock(sha1);
  await syncEnabledSkillRepos(env);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM skills WHERE name = ?').get('demo-tool').n,0);
  const again=await syncSkillRepo(env,repo,{importMissing:true});
  assert.equal(again.complete,true);
  await setSkillRepoSync(env,repo,false);
  restore();restore=githubMock(sha2);
  await syncEnabledSkillRepos(env);
  assert.equal(db.prepare('SELECT content FROM skill_resources WHERE skill = ? AND path = ?').get('demo-tool','scripts/test.py').content,"print('version a')\n");
 }finally{restore();}
});

test('Adding a GitHub skill repository is stored without making any GitHub request',async()=>{
 const {env}=await fixture();
 const original=globalThis.fetch;
 globalThis.fetch=async()=>{throw Error('GitHub unavailable');};
 try{
  const response=await addSkillRepo(env,{repo:'demo/new-repository',root:'skills',ref:'main'});
  assert.equal(response.ok,true);
  assert.equal((await listSkillRepos(env)).find(r=>r.id==='demo/new-repository:skills').enabled,false);
 }finally{globalThis.fetch=original;}
});

test('GitHub HTTP 403 distinguishes a missing token from an already configured token',async()=>{
 const {env}=await fixture();
 const repo=(await addSkillRepo(env,{repo:'demo/limited'})).id;
 const original=globalThis.fetch;
 globalThis.fetch=async()=>new Response('rate limit',{status:403,headers:{'x-ratelimit-remaining':'0','x-ratelimit-reset':'1793749200'}});
 try{
  const unauthenticated=await syncSkillRepo(env,repo,{importMissing:true});
  assert.match(unauthenticated.error,/Configure GITHUB_TOKEN/);
  env.GITHUB_TOKEN='github_pat_fake_test';
  const authenticated=await syncSkillRepo(env,repo,{importMissing:true});
  assert.match(authenticated.error,/Token is configured/);
  assert.doesNotMatch(authenticated.error,/github_pat_fake_test/);
 }finally{globalThis.fetch=original;}
});

test('Large skill repositories ignore unrelated assets and keep only Python scripts',async()=>{
 const {env,db}=await fixture();
 const repo=(await addSkillRepo(env,{repo:'demo/large',names:'large-tool'})).id;
 const old=globalThis.fetch;
 const tree=[{type:'blob',path:'skills/large-tool/SKILL.md',size:1200},...Array.from({length:1801},(_,i)=>({type:'blob',path:`skills/large-tool/assets/image-${i}.png`,size:500})),{type:'blob',path:'skills/large-tool/scripts/render.py',size:120}];
 globalThis.fetch=async url=>{
  const u=String(url);
  const data=u.includes('/commits/')?{sha:sha1,commit:{tree:{sha:treeSha}}}:u.includes('/git/trees/')?{truncated:false,tree}:null;
  return {ok:true,headers:new Headers(),json:async()=>data,text:async()=>fn('large-tool')};
 };
 try{
  let result;
  for(let i=0;i<25;i++){
   result=await syncSkillRepo(env,repo,{importMissing:true});
   assert.equal(result.error,undefined,result.error);
   if(result.complete)break;
  }
  assert.equal(result.complete,true);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM skill_resources WHERE skill=?').get('large-tool').n,1);
  assert.equal(db.prepare('SELECT kind FROM skill_resources WHERE skill=? AND path=?').get('large-tool','scripts/render.py').kind,'script');
 }finally{globalThis.fetch=old;}
});
