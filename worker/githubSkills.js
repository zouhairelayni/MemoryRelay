// Owner-managed GitHub skill sets. Sync never executes downloaded code.
import { now } from './util.js';
import { parseSkill, toSkillMd } from './skills.js';

const PATTERN = /^[A-Za-z0-9_.-]{1,100}$/;
const official = ['mcp-builder','skill-creator','doc-coauthoring','frontend-design','webapp-testing','internal-comms','discernment-nudge','web-artifacts-builder','theme-factory','canvas-design','brand-guidelines'];

export function repoArgs(value, root='skills', ref='main', names='') {
  const match = String(value || '').trim().match(/^(?:https:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
  if (!match || !PATTERN.test(match[1]) || !PATTERN.test(match[2]) || !/^[\w./-]{1,120}$/.test(root) || root.includes('..') || !/^[\w./-]{1,120}$/.test(ref) || ref.includes('..')) throw Error('Use a GitHub owner/repo URL, a branch and a skills folder.');
  const parsed = Array.isArray(names) ? names : String(names || '').split(',');
  const selected = [...new Set(parsed.map(n=>String(n).trim()).filter(Boolean))];
  if(selected.length > 50 || selected.some(n=>!PATTERN.test(n))) throw Error('Invalid skill selection (max 50 names).');
  const owner = match[1], repo = match[2], directory = String(root).replace(/^\/+|\/+$/g,'');
  return {id: `${owner.toLowerCase()}/${repo.toLowerCase()}:${directory}`,owner,repo,root:directory,ref,names:JSON.stringify(selected)};
}

export async function listSkillRepos(env) {
  return (await env.DB.prepare('SELECT * FROM skill_repos ORDER BY id').all()).results.map(r=>({...r,enabled:!!r.enabled,names:JSON.parse(r.names)}));
}

export async function addSkillRepo(env, data) {
  try {
    const r=repoArgs(data.repo,data.root||'skills',data.ref||'main',data.names||'');
    const count=await env.DB.prepare('SELECT COUNT(*) n FROM skill_repos').first();
    if(count.n>=25) return {error:'Too many tracked repositories (25 maximum).'};
    await env.DB.prepare('INSERT INTO skill_repos (id, owner, repo, root, ref, names, enabled) VALUES (?,?,?,?,?,?,0)')
      .bind(r.id,r.owner,r.repo,r.root,r.ref,r.names).run();
    return {ok:true,id:r.id};
  } catch(e) {return {error:/constraint|UNIQUE/i.test(String(e))?'That GitHub skill set is already tracked.':String(e.message||e)};}
}
export async function setSkillRepoSync(env,id,enabled){
  const r=await env.DB.prepare('UPDATE skill_repos SET enabled = ? WHERE id = ?').bind(enabled?1:0,String(id)).run();
  return r.meta.changes?{ok:true,enabled:!!enabled}:{error:'Repository not found.'};
}
export async function removeSkillRepo(env,id){
  await env.DB.prepare('DELETE FROM skill_repo_stage WHERE repo_id = ?').bind(String(id)).run();
  const r=await env.DB.prepare('DELETE FROM skill_repos WHERE id = ?').bind(String(id)).run();
  return {deleted:r.meta.changes}; // Do not delete installed skills when disabling or removing a source.
}
// A sync is a resumable D1 queue: at most eight GitHub files per invocation.
// This stays under Cloudflare Free Workers' 50 external subrequests/invocation.
const BASE_HEADERS={'User-Agent':'MemoryRelay/3.2 (skills updater)','Accept':'application/vnd.github+json'};
function headers(env){return {...BASE_HEADERS,...(env.GITHUB_TOKEN?{Authorization:'Bearer '+env.GITHUB_TOKEN}:{})};}
async function checkedFetch(env,url){
  const res=await fetch(url,{headers:headers(env),signal:AbortSignal.timeout(15000)});
  if(!res.ok){
    if(res.status===401 && env.GITHUB_TOKEN) throw Error('GitHub rejected GITHUB_TOKEN (HTTP 401). Replace the Worker secret with a valid raw token (no Bearer prefix or quotes).');
    if(res.status===403 || res.status===429){
      const remaining=res.headers.get('x-ratelimit-remaining');
      const reset=res.headers.get('x-ratelimit-reset');
      const wait=reset?'Reset: '+new Date(Number(reset)*1000).toISOString()+'. ':'';
      if(remaining==='0' || res.status===429) throw Error('GitHub rate limited (HTTP '+res.status+'). '+wait+(env.GITHUB_TOKEN?'Token is configured; check its rate limit.':'Configure GITHUB_TOKEN on this Worker.'));
      throw Error('GitHub access refused (HTTP '+res.status+'). '+(env.GITHUB_TOKEN?'Check token permissions or secondary rate limits.':'Configure GITHUB_TOKEN on this Worker.')+' '+wait);
    }
    throw Error('GitHub HTTP '+res.status+' while fetching '+new URL(url).pathname.slice(0,140));
  }
  return res;
}
// An owner-triggered diagnostic only; never returns or stores token contents.
export async function checkGitHubAccess(env){
  const configured=!!env.GITHUB_TOKEN;
  try {
    const res=await fetch('https://api.github.com/rate_limit',{headers:headers(env),signal:AbortSignal.timeout(15000)});
    if(!res.ok) return {ok:false,configured,error:res.status===401?'GitHub rejected GITHUB_TOKEN (401). Replace the Worker secret with a valid raw token.':`GitHub access check failed (HTTP ${res.status}).`};
    const data=await res.json();
    const core=data.resources?.core||data.rate||{};
    return {ok:true,configured,limit:Number(core.limit??0),remaining:Number(core.remaining??0),reset:core.reset?new Date(Number(core.reset)*1000).toISOString():''};
  }catch(e){return {ok:false,configured,error:'Cannot reach GitHub: '+String(e.message||e).slice(0,140)};}
}
const rawUrl=(r,sha,path)=>`https://raw.githubusercontent.com/${encodeURIComponent(r.owner)}/${encodeURIComponent(r.repo)}/${sha}/${path.split('/').map(encodeURIComponent).join('/')}`;
const ignored=(path)=>/(?:^|\/)(?:licen[cs]e(?:\.[^.]+)?|copying(?:\.[^.]+)?|notice(?:\.[^.]+)?)$/i.test(path);
async function failSync(env,id,e){
  const message=String(e?.message||e).slice(0,280);
  await env.DB.prepare('UPDATE skill_repos SET last_error=?,last_checked=? WHERE id=?').bind(message,now(),id).run();
  return {error:message};
}
async function startSync(env,r,importMissing){
  const prefix=`https://api.github.com/repos/${encodeURIComponent(r.owner)}/${encodeURIComponent(r.repo)}`;
  const commit=await (await checkedFetch(env,prefix+'/commits/'+encodeURIComponent(r.ref))).json();
  const sha=commit.sha, treeSha=commit.commit?.tree?.sha;
  if(!/^[a-f0-9]{40}$/.test(sha||'')||!/^[a-f0-9]{40}$/.test(treeSha||'')) throw Error('Invalid GitHub revision.');
  if(!importMissing && r.last_sha===sha){
    await env.DB.prepare("UPDATE skill_repos SET last_checked=?,last_error='',sync_status='up-to-date' WHERE id=?").bind(now(),r.id).run();
    return {ok:true,unchanged:true,sha,updated:0,added:0,skipped:0};
  }
  const tree=await (await checkedFetch(env,prefix+'/git/trees/'+treeSha+'?recursive=1')).json();
  if(tree.truncated || !Array.isArray(tree.tree)) throw Error('GitHub returned an incomplete repository tree.');
  const root=r.root?r.root+'/':'';
  const selected=new Set(JSON.parse(r.names));
  const skills=tree.tree.filter(x=>x.type==='blob'&&x.path.startsWith(root)&&x.path.endsWith('/SKILL.md')&&x.path.slice(root.length).split('/').length===2);
  const chosen=skills.filter(x=>!selected.size||selected.has(x.path.slice(root.length).split('/')[0]));
  if(chosen.length>50) throw Error('Too many skills. Specify individual skill names.');
  const todo=[];
  let skipped=0;
  for(const item of chosen){
    const folder=item.path.slice(0,-'SKILL.md'.length), name=folder.slice(root.length,-1);
    const existing=await env.DB.prepare('SELECT source FROM skills WHERE name=?').bind(name).first();
    if(!existing&&!importMissing){skipped++;continue;}
    const permitted=existing && (existing.source===`github:${r.id}` || (r.owner.toLowerCase()==='anthropics'&&r.repo.toLowerCase()==='skills'&&existing.source.startsWith('builtin:anthropic')));
    if(existing&&!permitted){skipped++;continue;}
    // Only the skill definition and Python scripts are needed; ignore assets and references.
    const blobs=tree.tree.filter(x=>x.type==='blob'&&x.path.startsWith(folder)&&x.path!==item.path&&/\.py$/i.test(x.path)&&x.size<=750000&&!ignored(x.path));
    if(blobs.length>1500) throw Error('Too many Python scripts in '+name+' (maximum 1500).');
    todo.push({skill:name,path:item.path,kind:'skill',fetch:true});
    for(const x of blobs){
      const path=x.path.slice(folder.length);
      todo.push({skill:name,path:x.path,relative:path,kind:'script',fetch:true});
    }
  }
  await env.DB.batch([
    env.DB.prepare('DELETE FROM skill_repo_stage WHERE repo_id=?').bind(r.id),
    env.DB.prepare("UPDATE skill_repos SET sync_sha=?,sync_todo=?,sync_done=0,sync_total=?,sync_status='running',last_error='',last_checked=? WHERE id=?").bind(sha,JSON.stringify(todo),todo.length,now(),r.id),
  ]);
  return {ok:true,started:true,sha,total:todo.length,done:0,skipped};
}
async function finishOneSkill(env,r,skill){
  const rows=(await env.DB.prepare('SELECT path,kind,content,url FROM skill_repo_stage WHERE repo_id=? AND skill=? ORDER BY path').bind(r.id,skill).all()).results;
  const head=rows.find(x=>x.kind==='skill');
  if(!head) throw Error('Missing SKILL.md for '+skill);
  const parsed=parseSkill(head.content,{limit:250000,allowOriginalDescription:true});
  if(parsed.name!==skill) throw Error('Skill filename/name mismatch: '+skill);
  const existing=await env.DB.prepare('SELECT * FROM skills WHERE name=?').bind(skill).first();
  const permitted=existing && (existing.source===`github:${r.id}`||(r.owner.toLowerCase()==='anthropics'&&r.repo.toLowerCase()==='skills'&&existing.source.startsWith('builtin:anthropic')));
  if(existing&&!permitted)return;
  const statements=[];
  const changed=!existing||toSkillMd(existing)!==head.content;
  if(!existing) statements.push(env.DB.prepare('INSERT INTO skills (name,description,body,enabled,core,source,created,updated) VALUES (?,?,?,1,0,?,?,?)').bind(skill,parsed.description,head.content,`github:${r.id}`,now(),now()));
  else if(changed){
    statements.push(env.DB.prepare("INSERT INTO skill_history (name,text,saved,by) VALUES (?,?,?,'github-sync')").bind(skill,toSkillMd(existing),now()));
    statements.push(env.DB.prepare('UPDATE skills SET description=?,body=?,source=?,updated=? WHERE name=?').bind(parsed.description,head.content,`github:${r.id}`,now(),skill));
  }
  statements.push(env.DB.prepare('DELETE FROM skill_resources WHERE skill=?').bind(skill));
  for(const file of rows.filter(x=>x.kind!=='skill'))statements.push(env.DB.prepare('INSERT INTO skill_resources (skill,path,kind,content,url) VALUES (?,?,?,?,?)').bind(skill,file.path,file.kind,file.content,file.url));
  statements.push(env.DB.prepare('DELETE FROM skill_repo_stage WHERE repo_id=? AND skill=?').bind(r.id,skill));
  // D1 batch sizes must stay bounded even for asset-heavy skill repositories.
  for(let i=0;i<statements.length;i+=75) await env.DB.batch(statements.slice(i,i+75));
}
export async function syncSkillRepo(env,id,{importMissing=false}={}){
  let r=await env.DB.prepare('SELECT * FROM skill_repos WHERE id=?').bind(String(id)).first();
  if(!r)return {error:'Repository not found.'};
  try{
    if(!r.sync_todo || r.sync_status!=='running'){
      const state=await startSync(env,r,importMissing);
      if(state.unchanged)return state;
      r=await env.DB.prepare('SELECT * FROM skill_repos WHERE id=?').bind(r.id).first();
    }
    const todo=JSON.parse(r.sync_todo||'[]');
    let done=Number(r.sync_done||0), processed=0;
    const max=8;
    for(;done<todo.length&&processed<max;done++,processed++){
      const item=todo[done];
      const url=rawUrl(r,r.sync_sha,item.path);
      let content=null;
      if(item.fetch){
        const res=await checkedFetch(env,url);
        const size=Number(res.headers.get('content-length')||0);
        if(size>750000)throw Error('File exceeds 750 KB: '+item.path);
        content=await res.text();
        if(content.length>750000)throw Error('File exceeds 750 KB: '+item.path);
      }
      await env.DB.prepare('INSERT OR REPLACE INTO skill_repo_stage (repo_id,skill,path,kind,content,url) VALUES (?,?,?,?,?,?)').bind(r.id,item.skill,item.relative||'SKILL.md',item.kind,content,url).run();
      const next=todo[done+1];
      if(!next || next.skill!==item.skill)await finishOneSkill(env,r,item.skill);
      await env.DB.prepare('UPDATE skill_repos SET sync_done=? WHERE id=?').bind(done+1,r.id).run();
    }
    if(done===todo.length){
      await env.DB.prepare("UPDATE skill_repos SET last_sha=sync_sha,last_checked=?,last_error='',sync_todo='',sync_done=0,sync_total=0,sync_status='complete' WHERE id=?").bind(now(),r.id).run();
      return {ok:true,complete:true,sha:r.sync_sha,done,total:todo.length};
    }
    return {ok:true,running:true,sha:r.sync_sha,done,total:todo.length};
  }catch(e){return failSync(env,r.id,e);}
}
export async function syncEnabledSkillRepos(env){
  const rows=(await env.DB.prepare('SELECT * FROM skill_repos WHERE enabled=1 ORDER BY id').all()).results;
  for(const r of rows){
    const active=r.sync_status==='running'&&r.sync_todo;
    // A failing queue remains retryable, but is not retried on every cron tick.
    const recentError=r.last_error&&r.last_checked&&Date.now()-new Date(r.last_checked.replace(' ','T')+'Z').getTime()<30*60000;
    const last=r.last_checked?new Date(r.last_checked.replace(' ','T')+'Z').getTime():0;
    if(recentError || (!active && last && Date.now()-last<86400000))continue;
    await syncSkillRepo(env,r.id,{importMissing:false});
    break; // One repo per cron invocation, bounded Cloudflare subrequests.
  }
}
export const OFFICIAL_REPO={...repoArgs('anthropics/skills','skills','main',official),enabled:0};
