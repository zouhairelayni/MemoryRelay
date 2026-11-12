// Owner-managed GitHub skill sets. Sync never executes downloaded code.
import { now } from './util.js';
import { getConfig, setConfig } from './db.js';
import { parseSkill, scanSkill, toSkillMd } from './skills.js';

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

// Repos with live counters: how many skills each one provides now, and how many files of each kind came with them.
export async function listSkillRepos(env) {
  const rows = (await env.DB.prepare('SELECT * FROM skill_repos ORDER BY id').all()).results;
  const skillCounts = new Map((await env.DB.prepare("SELECT source, COUNT(*) n FROM skills WHERE source LIKE 'github:%' GROUP BY source").all()).results.map((x) => [x.source, x.n]));
  const fileCounts = new Map();
  for (const x of (await env.DB.prepare("SELECT s.source source, r.kind kind, COUNT(*) n FROM skill_resources r JOIN skills s ON s.name = r.skill WHERE s.source LIKE 'github:%' GROUP BY s.source, r.kind").all()).results) {
    if (!fileCounts.has(x.source)) fileCounts.set(x.source, {});
    fileCounts.get(x.source)[x.kind] = x.n;
  }
  return rows.map((r) => ({ ...r, enabled: !!r.enabled, adopt: !!Number(r.adopt), names: JSON.parse(r.names),
    file_types: safeJson(r.file_types, ['script', 'test']), summary: safeJson(r.last_summary, null),
    skill_count: skillCounts.get('github:' + r.id) || 0, file_counts: fileCounts.get('github:' + r.id) || {} }));
}
// When GitHub told us to wait, every repo pauses until then (the limit is per token or per shared Worker IP, not per repo).
const BLOCK_KEY='github_blocked_until';
// The pause is remembered together with whether a token was set, so adding a token lifts it at once (a token has its own quota).
const tokenFlag=(env)=>env.GITHUB_TOKEN?'1':'0';
export async function githubBlockedUntil(env){
  const [until,flag]=String(await getConfig(env,BLOCK_KEY)||'').split(':');
  return flag===tokenFlag(env)&&Number(until)>Date.now()?Number(until):0;
}

// ---- which files a repo import keeps: kinds, path filters, sizes ----
export const FILE_TYPES = { script: 'Scripts', test: 'Tests', font: 'Fonts', reference: 'Reference docs' };
const CODE_RE = /\.(py|mjs|cjs|js|ts|sh|bash)$/i;
const FONT_RE = /\.(woff2?|ttf|otf)$/i;
const DOC_RE = /\.(md|markdown|txt|json|ya?ml|csv|html?|css|xml)$/i;
const TEST_RE = /(^|\/)(tests?|__tests__|specs?|e2e)\/|\.(test|spec)\.[a-z]+$|(^|\/)test_[^/]*\.py$|_test\.(py|m?js|ts)$/i;
const IGNORE_RE = /(^|\/)(node_modules|\.git|__pycache__|\.venv)\/|(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|\.DS_Store)$|\.min\.(js|css)$/i;
const licenseFile = (path) => /(?:^|\/)(?:licen[cs]e(?:\.[^.]+)?|copying(?:\.[^.]+)?|notice(?:\.[^.]+)?)$/i.test(path);
// Kind of a file inside a skill folder ('' = never imported). Code inside test folders or named *.test.* is a test.
export function fileType(rel) {
  if (IGNORE_RE.test(rel) || licenseFile(rel)) return '';
  if (CODE_RE.test(rel)) return TEST_RE.test(rel) ? 'test' : 'script';
  if (FONT_RE.test(rel)) return 'font';
  if (DOC_RE.test(rel)) return 'reference';
  return '';
}
const globRe = (g) => {
  const esc = g.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const re = esc.replace(/\*\*\//g, '\u0001').replace(/\*\*/g, '\u0002').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')
    .replace(/\u0001/g, '(?:.*/)?').replace(/\u0002/g, '.*');
  return new RegExp('^' + re + '$', 'i');
};
// One pattern per line or comma: "scripts/**", "*.mjs", "!**/fixtures/**". Excludes always win; no include means everything.
export function parseFilter(text) {
  const inc = [], exc = [];
  for (const raw of String(text || '').split(/[\n,]/).map((l) => l.trim()).filter(Boolean).slice(0, 20)) {
    const neg = raw.startsWith('!');
    const g = raw.replace(/^!/, '').replace(/^\.?\//, '');
    if (!g || g.length > 120 || g.includes('..')) continue;
    (neg ? exc : inc).push({ re: globRe(g), base: !g.includes('/') });
  }
  return { inc, exc };
}
export function passesFilter(rel, f) {
  const hit = (e) => e.re.test(rel) || (e.base && e.re.test(rel.split('/').pop()));
  if (f.exc.some(hit)) return false;
  return !f.inc.length || f.inc.some(hit);
}
const safeJson = (text, fallback) => { try { const v = JSON.parse(text); return v ?? fallback; } catch { return fallback; } };
export function repoOpts(r) {
  const types = new Set((safeJson(r.file_types, ['script', 'test'])).filter((t) => t in FILE_TYPES));
  return { types, filter: parseFilter(r.path_filter), maxBytes: Math.min(1000, Math.max(50, Number(r.max_kb) || 750)) * 1000, adopt: !!Number(r.adopt) };
}
function cleanOpts(d) {
  const o = {};
  if (d.file_types !== undefined) {
    if (!Array.isArray(d.file_types)) throw Error('file_types must be a list.');
    o.file_types = JSON.stringify([...new Set(d.file_types.map(String).filter((t) => t in FILE_TYPES))]);
  }
  if (d.path_filter !== undefined) o.path_filter = String(d.path_filter).slice(0, 600);
  if (d.max_kb !== undefined) o.max_kb = Math.min(1000, Math.max(50, Math.round(Number(d.max_kb)) || 750));
  if (d.adopt !== undefined) o.adopt = d.adopt ? 1 : 0;
  return o;
}
const toBase64 = (buf) => {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const sourceLabel = (source) => source.startsWith('github:') ? 'from repo ' + source.slice(7) : source.startsWith('builtin') ? 'built-in' : 'pasted or agent-made';
const emptySummary = () => ({ added: [], updated: [], unchanged: [], adopted: [], held: [], problems: [], conflicts: [], not_found: [], available: 0, files: {}, empty: false });
const MAX_PER_RUN = 12;

export async function addSkillRepo(env, data) {
  try {
    const r=repoArgs(data.repo,data.root||'skills',data.ref||'main',data.names||'');
    const o=cleanOpts(data);
    const had=await env.DB.prepare('SELECT id FROM skill_repos WHERE id=?').bind(r.id).first();
    if(had){
      const n=await env.DB.prepare("SELECT COUNT(*) n FROM skills WHERE source=?").bind('github:'+r.id).first();
      return {error:`That GitHub skill set is already tracked (${n.n} skill${n.n===1?'':'s'} imported from it). Use Sync now on it.`,existing:r.id};
    }
    const count=await env.DB.prepare('SELECT COUNT(*) n FROM skill_repos').first();
    if(count.n>=25) return {error:'Too many tracked repositories (25 maximum).'};
    const cols=['id','owner','repo','root','ref','names','enabled',...Object.keys(o)];
    await env.DB.prepare(`INSERT INTO skill_repos (${cols.join(',')}) VALUES (${cols.map(()=>'?').join(',')})`)
      .bind(r.id,r.owner,r.repo,r.root,r.ref,r.names,0,...Object.values(o)).run();
    return {ok:true,id:r.id};
  } catch(e) {return {error:/constraint|UNIQUE/i.test(String(e))?'That GitHub skill set is already tracked.':String(e.message||e)};}
}
// Changing what is imported restarts the repo's sync from scratch on the next run; installed skills stay until then.
export async function setSkillRepoFilter(env,id,data){
  const row=await env.DB.prepare('SELECT id FROM skill_repos WHERE id=?').bind(String(id)).first();
  if(!row) return {error:'Repository not found.'};
  let o;
  try{o=cleanOpts(data||{});}catch(e){return {error:String(e.message||e)};}
  const keys=Object.keys(o);
  if(!keys.length) return {error:'Nothing to change.'};
  await env.DB.batch([
    env.DB.prepare('DELETE FROM skill_repo_stage WHERE repo_id=?').bind(row.id),
    env.DB.prepare(`UPDATE skill_repos SET ${keys.map(k=>k+'=?').join(',')}, last_sha='', etag='', sync_etag='', sync_todo='', sync_done=0, sync_total=0, sync_status='', sync_note='', sync_summary='' WHERE id=?`).bind(...Object.values(o),row.id),
  ]);
  return {ok:true,needs_sync:true};
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
// The queue is resumed by cron (even when auto sync is off, because the owner started it) and by the dashboard.
const LOCK_MS=120000;
const BASE_HEADERS={'User-Agent':'MemoryRelay/3.3 (skills updater)','Accept':'application/vnd.github+json'};
function headers(env){return {...BASE_HEADERS,...(env.GITHUB_TOKEN?{Authorization:'Bearer '+env.GITHUB_TOKEN}:{})};}
const iso=(ms)=>new Date(ms).toISOString().slice(0,16).replace('T',' ')+' UTC';
// Thrown when GitHub asks us to slow down: nothing else is sent until `until`.
class SyncBlocked extends Error{constructor(message,until){super(message);this.until=until;}}
// Thrown for one skill or file that can never import (bad name, too big...). It is reported and skipped, never retried forever.
class SkillProblem extends Error{}
async function checkedFetch(env,url,extra={}){
  const waiting=await githubBlockedUntil(env);
  if(waiting)throw new SyncBlocked('GitHub rate limit: paused until '+iso(waiting)+'. No requests are sent before then.'+(env.GITHUB_TOKEN?'':' Configure GITHUB_TOKEN on this Worker to raise the limit.'),waiting);
  const res=await fetch(url,{headers:{...headers(env),...extra},signal:AbortSignal.timeout(15000)});
  if(res.status===304)return res;
  if(!res.ok){
    if(res.status===401 && env.GITHUB_TOKEN) throw Error('GitHub rejected GITHUB_TOKEN (HTTP 401). Replace the Worker secret with a valid raw token (no Bearer prefix or quotes).');
    if(res.status===403 || res.status===429){
      const remaining=res.headers.get('x-ratelimit-remaining');
      const reset=Number(res.headers.get('x-ratelimit-reset')||0)*1000;
      const retry=Number(res.headers.get('retry-after')||0)*1000;
      if(remaining==='0' || res.status===429 || retry>0){
        // Wait for the reset GitHub announced (at least a minute, at most two hours), and remember it for every repo.
        const guess=reset>Date.now()?reset:retry?Date.now()+retry:Date.now()+10*60000;
        const until=Math.min(Date.now()+2*3600000,Math.max(Date.now()+60000,guess));
        await setConfig(env,BLOCK_KEY,until+':'+tokenFlag(env));
        throw new SyncBlocked('GitHub rate limited (HTTP '+res.status+'). Paused until '+iso(until)+'. '+(env.GITHUB_TOKEN?'Token is configured; check its rate limit.':'Configure GITHUB_TOKEN on this Worker: without a token GitHub allows only 60 requests/hour for a shared address.'),until);
      }
      throw Error('GitHub access refused (HTTP '+res.status+'). '+(env.GITHUB_TOKEN?'Check token permissions.':'The repository may be private: add a GITHUB_TOKEN secret.'));
    }
    const err=Error('GitHub HTTP '+res.status+' while fetching '+new URL(url).pathname.slice(0,140));
    err.status=res.status;
    throw err;
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
// Direction overrides and zero-width characters can hide text from the owner (Trojan Source). Emoji joiners stay allowed.
const TROJAN_RE=/[\u202A-\u202E\u2066-\u2069\u200B\u2060\uFEFF]/;
// New wording like these in an unattended update means a human should look before agents receive it.
const RISKY=new Set(['tries to override other instructions','asks the agent to hide things from the user','asks the agent to bypass safeguards','pipes a download into a shell','runs hidden or encoded code']);
const addNote=(env,id,note)=>env.DB.prepare("UPDATE skill_repos SET sync_note=substr(CASE WHEN sync_note='' THEN ? ELSE sync_note||' | '||? END,1,700) WHERE id=?").bind(note,note,id).run();
async function failSync(env,id,e){
  const message=String(e?.message||e).slice(0,280);
  await env.DB.prepare('UPDATE skill_repos SET last_error=?,last_checked=? WHERE id=?').bind(message,now(),id).run();
  return e instanceof SyncBlocked?{error:message,blocked_until:iso(e.until)}:{error:message};
}
async function startSync(env,r,importMissing){
  const prefix=`https://api.github.com/repos/${encodeURIComponent(r.owner)}/${encodeURIComponent(r.repo)}`;
  const opts=repoOpts(r);
  // An unchanged branch answers 304, which GitHub does not count against the quota.
  const conditional=!importMissing&&r.etag&&r.last_sha?{'If-None-Match':r.etag}:{};
  const first=await checkedFetch(env,prefix+'/commits/'+encodeURIComponent(r.ref),conditional).catch(e=>{
    if(e&&e.status===404)throw Error(`Repository or branch not found: ${r.owner}/${r.repo} @ ${r.ref}.`+(env.GITHUB_TOKEN?'':' If the repository is private, add a GITHUB_TOKEN secret.'));
    throw e;
  });
  if(first.status===304){
    await env.DB.prepare("UPDATE skill_repos SET last_checked=?,last_error='',sync_status='up-to-date' WHERE id=?").bind(now(),r.id).run();
    return {ok:true,unchanged:true,sha:r.last_sha,updated:0,added:0,skipped:0};
  }
  const commit=await first.json(), etag=first.headers.get('etag')||'';
  const sha=commit.sha, treeSha=commit.commit?.tree?.sha;
  if(!/^[a-f0-9]{40}$/.test(sha||'')||!/^[a-f0-9]{40}$/.test(treeSha||'')) throw Error('Invalid GitHub revision.');
  if(!importMissing && r.last_sha===sha){
    await env.DB.prepare("UPDATE skill_repos SET last_checked=?,last_error='',sync_status='up-to-date',etag=? WHERE id=?").bind(now(),etag,r.id).run();
    return {ok:true,unchanged:true,sha,updated:0,added:0,skipped:0};
  }
  const tree=await (await checkedFetch(env,prefix+'/git/trees/'+treeSha+'?recursive=1')).json();
  if(tree.truncated || !Array.isArray(tree.tree)) throw Error('GitHub returned an incomplete repository tree.');
  const root=r.root?r.root+'/':'';
  const selected=new Set(JSON.parse(r.names));
  const skills=tree.tree.filter(x=>x.type==='blob'&&x.path.startsWith(root)&&x.path.endsWith('/SKILL.md')&&x.path.slice(root.length).split('/').length===2);
  const chosen=skills.filter(x=>!selected.size||selected.has(x.path.slice(root.length).split('/')[0]));
  if(chosen.length>50) throw Error('Too many skills. Specify individual skill names.');
  const summary=emptySummary();
  const found=new Set(skills.map(x=>x.path.slice(root.length).split('/')[0]));
  summary.not_found=[...selected].filter(n=>!found.has(n)).slice(0,10);
  summary.empty=chosen.length===0;
  const have=new Map((await env.DB.prepare('SELECT name,source FROM skills').all()).results.map(x=>[x.name,x.source]));
  const todo=[], notes=[];
  const tooBig=[];
  let truncated=0;
  for(const item of chosen){
    const folder=item.path.slice(0,-'SKILL.md'.length), name=folder.slice(root.length,-1);
    const source=have.get(name);
    if(source===undefined&&!importMissing){summary.available++;continue;}
    const own=source!==undefined && (source===`github:${r.id}` || (r.owner.toLowerCase()==='anthropics'&&r.repo.toLowerCase()==='skills'&&source.startsWith('builtin:anthropic')));
    const adoptable=source!==undefined&&!own&&importMissing&&opts.adopt&&!source.startsWith('github:')&&!source.startsWith('builtin');
    if(source!==undefined&&!own&&!adoptable){summary.conflicts.push({name,from:sourceLabel(source)});continue;}
    // Only the types the owner picked, passing the path filter and size limit. SKILL.md is always imported.
    const blobs=[];
    for(const x of tree.tree){
      if(x.type!=='blob'||!x.path.startsWith(folder)||x.path===item.path)continue;
      const rel=x.path.slice(folder.length), type=fileType(rel);
      if(!type||!opts.types.has(type)||!passesFilter(rel,opts.filter))continue;
      if(x.size>opts.maxBytes){tooBig.push(rel);continue;}
      blobs.push({x,rel,type});
    }
    if(blobs.length>300){truncated++;blobs.length=300;}
    todo.push({skill:name,path:item.path,kind:'skill',fetch:true});
    for(const b of blobs)todo.push({skill:name,path:b.x.path,relative:b.rel,kind:b.type,fetch:true,binary:b.type==='font'});
  }
  if(summary.conflicts.length)notes.push('Not imported, the name is already used: '+summary.conflicts.slice(0,8).map(c=>c.name+' ('+c.from+')').join(', ')+(summary.conflicts.length>8?'…':'')+'. Turn on "Replace pasted skills" in this repo\'s file settings to take over pasted ones.');
  if(summary.not_found.length)notes.push('Not found in the repository: '+summary.not_found.join(', ')+'.');
  if(chosen.length===0)notes.push(`No skills found: nothing matches ${root}<name>/SKILL.md in ${r.owner}/${r.repo} @ ${r.ref}. Check the skills folder.`);
  if(tooBig.length)notes.push(tooBig.length+' file'+(tooBig.length===1?'':'s')+' over '+Math.round(opts.maxBytes/1000)+' KB skipped ('+tooBig.slice(0,3).join(', ')+(tooBig.length>3?'…':'')+'). Raise the size limit to import them.');
  if(truncated)notes.push(truncated+' skill'+(truncated===1?' has':'s have')+' more than 300 matching files; only the first 300 were kept. Narrow the path filter.');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM skill_repo_stage WHERE repo_id=?').bind(r.id),
    env.DB.prepare("UPDATE skill_repos SET sync_sha=?,sync_etag=?,sync_todo=?,sync_done=0,sync_total=?,sync_status='running',sync_manual=?,sync_note=?,sync_summary=?,last_error='',last_checked=? WHERE id=?").bind(sha,etag,JSON.stringify(todo),todo.length,importMissing?1:0,notes.join(' | ').slice(0,700),JSON.stringify(summary),now(),r.id),
  ]);
  return {ok:true,started:true,sha,total:todo.length,done:0,skipped:summary.conflicts.length};
}
// Installs one fully downloaded skill. Returns {note, outcome, files}. Throws SkillProblem when it can never import.
async function finishOneSkill(env,r,skill,{manual}){
  const drop=()=>env.DB.prepare('DELETE FROM skill_repo_stage WHERE repo_id=? AND skill=?').bind(r.id,skill).run();
  const rows=(await env.DB.prepare('SELECT path,kind,content,url FROM skill_repo_stage WHERE repo_id=? AND skill=? ORDER BY path').bind(r.id,skill).all()).results;
  const head=rows.find(x=>x.kind==='skill');
  if(!head){await drop();throw new SkillProblem(skill+': SKILL.md could not be downloaded');}
  let parsed;
  try{parsed=parseSkill(head.content,{limit:250000,allowOriginalDescription:true});}
  catch(e){await drop();throw new SkillProblem(skill+': '+String(e.message||e).slice(0,160));}
  if(parsed.name!==skill){await drop();throw new SkillProblem(skill+': SKILL.md declares name "'+parsed.name+'" but its folder is "'+skill+'", so it was not imported');}
  if(TROJAN_RE.test(head.content)){await drop();throw new SkillProblem(skill+': contains hidden direction-changing or zero-width characters, not imported');}
  const existing=await env.DB.prepare('SELECT * FROM skills WHERE name=?').bind(skill).first();
  const own=existing && (existing.source===`github:${r.id}`||(r.owner.toLowerCase()==='anthropics'&&r.repo.toLowerCase()==='skills'&&existing.source.startsWith('builtin:anthropic')));
  const adopting=!!existing&&!own&&manual&&!!Number(r.adopt)&&!existing.source.startsWith('github:')&&!existing.source.startsWith('builtin');
  if(existing&&!own&&!adopting){await drop();return {outcome:null};}
  const before=new Set(existing?scanSkill(toSkillMd(existing)):[]);
  const added=scanSkill(head.content).filter(w=>RISKY.has(w)&&!before.has(w));
  if(existing&&!manual&&added.length){
    await drop();
    return {outcome:'held',note:skill+': update held back, new risky wording ('+added.join('; ')+'). Press Sync now to review and accept it.'};
  }
  const statements=[];
  const changed=!existing||toSkillMd(existing)!==head.content;
  if(!existing) statements.push(env.DB.prepare('INSERT INTO skills (name,description,body,enabled,core,source,created,updated) VALUES (?,?,?,1,0,?,?,?)').bind(skill,parsed.description,head.content,`github:${r.id}`,now(),now()));
  else {
    if(changed) statements.push(env.DB.prepare("INSERT INTO skill_history (name,text,saved,by) VALUES (?,?,?,?)").bind(skill,toSkillMd(existing),now(),adopting?'github-adopt':'github-sync'));
    if(changed||adopting) statements.push(env.DB.prepare('UPDATE skills SET description=?,body=?,source=?,updated=? WHERE name=?').bind(parsed.description,head.content,`github:${r.id}`,now(),skill));
  }
  statements.push(env.DB.prepare('DELETE FROM skill_resources WHERE skill=?').bind(skill));
  const files={};
  for(const file of rows.filter(x=>x.kind!=='skill')){
    statements.push(env.DB.prepare('INSERT INTO skill_resources (skill,path,kind,content,url) VALUES (?,?,?,?,?)').bind(skill,file.path,file.kind,file.content,file.url));
    files[file.kind]=(files[file.kind]||0)+1;
  }
  statements.push(env.DB.prepare('DELETE FROM skill_repo_stage WHERE repo_id=? AND skill=?').bind(r.id,skill));
  // D1 batch sizes must stay bounded even for asset-heavy skill repositories.
  for(let i=0;i<statements.length;i+=75) await env.DB.batch(statements.slice(i,i+75));
  const outcome=!existing?'added':adopting?'adopted':changed?'updated':'unchanged';
  return {outcome,files,note:added.length?skill+': installed, check it ('+added.join('; ')+')':null};
}
async function fetchItem(env,r,item,maxBytes){
  // A file listed in the pinned commit that answers 404 will never appear: report it and move on.
  const res=await checkedFetch(env,rawUrl(r,r.sync_sha,item.path)).catch(e=>{
    if(e&&e.status===404)throw new SkillProblem(item.path+' was not found on GitHub and was skipped');
    throw e;
  });
  const limit=item.kind==='skill'?750000:maxBytes;
  const tooBig=()=>new SkillProblem(item.path+' is over '+Math.round(limit/1000)+' KB and was skipped');
  if(Number(res.headers.get('content-length')||0)>limit)throw tooBig();
  if(item.binary){
    const buf=await res.arrayBuffer(); // fonts are binary: stored as base64 so every byte survives
    if(buf.byteLength>limit)throw tooBig();
    return toBase64(buf);
  }
  const content=await res.text();
  if(content.length>limit)throw tooBig();
  return content;
}
export async function syncSkillRepo(env,id,{importMissing=false}={}){
  let r=await env.DB.prepare('SELECT * FROM skill_repos WHERE id=?').bind(String(id)).first();
  if(!r)return {error:'Repository not found.'};
  // Lease: cron and the dashboard may both try; only one works on a repository at a time.
  const t=Date.now();
  const lease=await env.DB.prepare('UPDATE skill_repos SET sync_lock=? WHERE id=? AND sync_lock<?').bind(t,r.id,t-LOCK_MS).run();
  if(!lease.meta.changes)return {ok:true,running:true,busy:true,sha:r.sync_sha,done:Number(r.sync_done||0),total:Number(r.sync_total||0)};
  try{
    if(!r.sync_todo || r.sync_status!=='running'){
      const state=await startSync(env,r,importMissing);
      if(state.unchanged)return state;
      r=await env.DB.prepare('SELECT * FROM skill_repos WHERE id=?').bind(r.id).first();
    }
    const manual=!!Number(r.sync_manual);
    const opts=repoOpts(r);
    const todo=JSON.parse(r.sync_todo||'[]');
    const summary={...emptySummary(),...safeJson(r.sync_summary,{})};
    let done=Number(r.sync_done||0), processed=0;
    const problem=async(msg)=>{summary.problems.push(msg);await addNote(env,r.id,msg);};
    for(;done<todo.length&&processed<MAX_PER_RUN;done++,processed++){
      const item=todo[done];
      let content=null, skip=false;
      if(item.fetch){
        try{content=await fetchItem(env,r,item,opts.maxBytes);}
        catch(e){if(!(e instanceof SkillProblem))throw e;await problem(e.message);skip=true;}
      }
      if(!skip)await env.DB.prepare('INSERT OR REPLACE INTO skill_repo_stage (repo_id,skill,path,kind,content,url) VALUES (?,?,?,?,?,?)').bind(r.id,item.skill,item.relative||'SKILL.md',item.kind,content,rawUrl(r,r.sync_sha,item.path)).run();
      const next=todo[done+1];
      if(!next || next.skill!==item.skill){
        // One bad skill is reported and skipped; it must never freeze the whole queue.
        try{
          const res=await finishOneSkill(env,r,item.skill,{manual});
          if(res.outcome==='held')summary.held.push(item.skill);
          else if(res.outcome)summary[res.outcome].push(item.skill);
          for(const [k,n] of Object.entries(res.files||{}))summary.files[k]=(summary.files[k]||0)+n;
          if(res.note)await addNote(env,r.id,res.note);
        }catch(e){if(!(e instanceof SkillProblem))throw e;await problem(e.message);}
      }
      await env.DB.prepare('UPDATE skill_repos SET sync_done=?,sync_summary=? WHERE id=?').bind(done+1,JSON.stringify(summary).slice(0,12000),r.id).run();
    }
    if(done>=todo.length){
      summary.at=now();
      await env.DB.prepare("UPDATE skill_repos SET last_sha=sync_sha,etag=sync_etag,last_checked=?,last_error='',sync_todo='',sync_done=0,sync_total=0,sync_status='complete',sync_manual=0,last_summary=?,sync_summary='' WHERE id=?").bind(now(),JSON.stringify(summary).slice(0,12000),r.id).run();
      return {ok:true,complete:true,sha:r.sync_sha,done,total:todo.length,summary};
    }
    return {ok:true,running:true,sha:r.sync_sha,done,total:todo.length};
  }catch(e){return failSync(env,r.id,e);}
  finally{await env.DB.prepare('UPDATE skill_repos SET sync_lock=0 WHERE id=?').bind(r.id).run().catch(()=>{});}
}
// Cron: continue any queue that was started (even with auto sync off), and check enabled repos once a day.
export async function syncEnabledSkillRepos(env){
  if(await githubBlockedUntil(env))return; // GitHub asked us to wait: send nothing at all
  const rows=(await env.DB.prepare("SELECT * FROM skill_repos WHERE enabled=1 OR (sync_status='running' AND sync_todo<>'') ORDER BY (sync_status='running') DESC, id").all()).results;
  const stamp=(s)=>s?new Date(s.replace(' ','T')+'Z').getTime():0;
  for(const r of rows){
    const active=r.sync_status==='running'&&!!r.sync_todo;
    const last=stamp(r.last_checked);
    // After a failure retry after a short pause. Only a successful check earns the 24 h wait.
    if(r.last_error){if(last&&Date.now()-last<10*60000)continue;}
    else if(!active&&last&&Date.now()-last<86400000)continue;
    await syncSkillRepo(env,r.id,{importMissing:false});
    break; // One repo per cron invocation, bounded Cloudflare subrequests.
  }
}
export const OFFICIAL_REPO={...repoArgs('anthropics/skills','skills','main',official),enabled:0};
