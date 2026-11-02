// Owner-managed GitHub skill sets. Sync never executes downloaded code.
import { now } from './util.js';
import { parseSkill, toSkillMd } from './skills.js';

const PATTERN = /^[A-Za-z0-9_.-]{1,100}$/;
const FILENAME = /\.(md|py|sh|js|mjs|cjs|ts|tsx|jsx|json|html|css|txt|yaml|yml|toml|xml|svg|csv)$/i;
const SCRIPT = /\.(py|sh|js|mjs|cjs|ts|tsx)$/i;
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
  const r=await env.DB.prepare('DELETE FROM skill_repos WHERE id = ?').bind(String(id)).run();
  return {deleted:r.meta.changes}; // Do not delete installed skills when disabling or removing a source.
}
const headers={'User-Agent':'MemoryRelay/3.2 (skills updater)','Accept':'application/vnd.github+json'};
async function fetchJson(url){
  const response=await fetch(url,{headers,signal:AbortSignal.timeout(15000)});
  if(!response.ok) throw Error(`GitHub responded ${response.status}`);
  return response.json();
}
async function fetchSource(url){
  const response=await fetch(url,{headers,signal:AbortSignal.timeout(15000)});
  if(!response.ok) throw Error(`GitHub file responded ${response.status}`);
  const size=Number(response.headers.get('content-length')||0);
  if(size>750000) throw Error('Source resource exceeds 750 KB: '+url.split('/').pop());
  const content=await response.text();
  if(content.length>750000) throw Error('Source resource exceeds 750 KB: '+url.split('/').pop());
  return content;
}

export async function syncSkillRepo(env,id,{importMissing=false}={}) {
  const r=await env.DB.prepare('SELECT * FROM skill_repos WHERE id = ?').bind(String(id)).first();
  if(!r) return {error:'Repository not found.'};
  let updated=0,added=0,skipped=0;
  try {
    const prefix=`https://api.github.com/repos/${encodeURIComponent(r.owner)}/${encodeURIComponent(r.repo)}`;
    const commit=await fetchJson(prefix+'/commits/'+encodeURIComponent(r.ref));
    const sha=commit.sha,treeSha=commit.commit?.tree?.sha;
    if(!/^[a-f0-9]{40}$/.test(sha||'')||!/^[a-f0-9]{40}$/.test(treeSha||'')) throw Error('Invalid GitHub revision.');
    if(!importMissing && r.last_sha===sha) {
      await env.DB.prepare('UPDATE skill_repos SET last_checked = ?, last_error = ? WHERE id = ?').bind(now(),'',id).run();
      return {ok:true,unchanged:true,sha,updated:0,added:0,skipped:0};
    }
    const tree=await fetchJson(prefix+'/git/trees/'+treeSha+'?recursive=1');
    if(tree.truncated || !Array.isArray(tree.tree)) throw Error('GitHub returned an incomplete repository tree.');
    const root=r.root ? r.root+'/' : '';
    const selected=new Set(JSON.parse(r.names));
    const skillEntries=tree.tree.filter(x=>x.type==='blob'&&x.path.startsWith(root)&&x.path.endsWith('/SKILL.md')&&x.path.slice(root.length).split('/').length===2);
    const names=skillEntries.filter(x=>!selected.size||selected.has(x.path.slice(root.length).split('/')[0]));
    if(names.length>50) throw Error('Set contains more than 50 skills; specify skill names to track.');
    for(const item of names){
      const folder=item.path.slice(0,-'SKILL.md'.length), skillName=folder.slice(root.length,-1);
      const existing=await env.DB.prepare('SELECT * FROM skills WHERE name = ?').bind(skillName).first();
      if (!existing && !importMissing) {skipped++;continue;}
      const permitted = existing && (existing.source===`github:${r.id}` || (r.owner.toLowerCase()==='anthropics' && r.repo.toLowerCase()==='skills' && existing.source.startsWith('builtin:anthropic')));
      if(existing && !permitted){skipped++;continue;} // preserve owner edits and unrelated repos
      const raw=(path)=>`https://raw.githubusercontent.com/${encodeURIComponent(r.owner)}/${encodeURIComponent(r.repo)}/${sha}/${path.split('/').map(encodeURIComponent).join('/')}`;
      const text=await fetchSource(raw(item.path));
      const parsed=parseSkill(text,{limit:250000,allowOriginalDescription:true});
      if(parsed.name!==skillName) throw Error('Folder and skill name disagree: '+skillName);
      const files=tree.tree.filter(x=>x.type==='blob'&&x.path.startsWith(folder)&&x.path!==item.path);
      if(files.length>180) throw Error('Too many resources in '+skillName);
      const resources=[];
      for(const file of files){
        const path=file.path.slice(folder.length),url=raw(file.path),isText=FILENAME.test(path)&&file.size<=750000;
        resources.push({path,url,kind:isText?(SCRIPT.test(path)?'script':'reference'):'asset',content:isText?await fetchSource(url):null});
      }
      const changed=!existing||toSkillMd(existing)!==text;
      const statements=[];
      if(!existing){
        statements.push(env.DB.prepare("INSERT INTO skills (name, description, body, enabled, core, source, created, updated) VALUES (?,?,?,1,0,?,?,?)")
          .bind(skillName,parsed.description,text,`github:${r.id}`,now(),now()));
        added++;
      } else if(changed){
        statements.push(env.DB.prepare("INSERT INTO skill_history (name,text,saved,by) VALUES (?,?,?,'github-sync')").bind(skillName,toSkillMd(existing),now()));
        statements.push(env.DB.prepare('UPDATE skills SET description = ?, body = ?, source = ?, updated = ? WHERE name = ?')
          .bind(parsed.description,text,`github:${r.id}`,now(),skillName));
        updated++;
      }
      statements.push(env.DB.prepare('DELETE FROM skill_resources WHERE skill = ?').bind(skillName));
      for(const file of resources) statements.push(env.DB.prepare('INSERT INTO skill_resources (skill,path,kind,content,url) VALUES (?,?,?,?,?)')
        .bind(skillName,file.path,file.kind,file.content,file.url));
      await env.DB.batch(statements);
    }
    await env.DB.prepare('UPDATE skill_repos SET last_sha = ?, last_checked = ?, last_error = ? WHERE id = ?').bind(sha,now(),'',id).run();
    return {ok:true,sha,updated,added,skipped};
  } catch(e){
    const message=String(e?.message||e).slice(0,280);
    await env.DB.prepare('UPDATE skill_repos SET last_checked = ?, last_error = ? WHERE id = ?').bind(now(),message,id).run();
    return {error:message,updated,added,skipped};
  }
}

export async function syncEnabledSkillRepos(env){
  const rows=(await env.DB.prepare('SELECT id FROM skill_repos WHERE enabled = 1 ORDER BY id').all()).results;
  for(const r of rows) await syncSkillRepo(env,r.id,{importMissing:false});
}

export const OFFICIAL_REPO={...repoArgs('anthropics/skills','skills','main',official),enabled:0};
