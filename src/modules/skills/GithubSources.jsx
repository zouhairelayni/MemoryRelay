import {useEffect,useState} from "react";
import {skillRepos} from "../../api/endpoints.js";
import Switch from "../../components/Switch.jsx";

const TYPE_LABELS={script:"Scripts (.py .mjs .js .ts .sh)",test:"Tests (*.test.*, tests/ folders)",font:"Fonts (.woff2 .woff .ttf .otf)",reference:"Reference docs (.md .json .yaml …)"};
const KIND_NAMES={script:["script","scripts"],test:["test","tests"],font:["font","fonts"],reference:["reference doc","reference docs"]};
const countText=(counts)=>Object.entries(counts||{}).filter(([,n])=>n>0).map(([k,n])=>`${n} ${(KIND_NAMES[k]||[k,k])[n===1?0:1]}`).join(", ");
const summaryParts=(s)=>[[s.added,"new"],[s.updated,"updated"],[s.adopted,"taken over from pasted"],[s.unchanged,"unchanged"],[s.held,"held back"]].filter(([l])=>l?.length).map(([l,w])=>`${l.length} ${w}`);
const summaryText=(s)=>{if(!s)return "Sync complete.";const p=summaryParts(s);const f=countText(s.files);return (p.length?`Sync complete: ${p.join(" · ")}.`:s.empty?"Sync complete, but no skills were found in that folder.":"Sync complete, but nothing was imported.")+(f?` Files: ${f}.`:"");};

// What the last sync really did, so "synced" never hides that nothing was imported.
function SyncSummary({s,when}){
  const p=summaryParts(s), f=countText(s.files);
  return <div className="muted small" role="status">
    <div>Last sync{when?` ${when} UTC`:""}: {p.length?p.join(" · "):s.empty?"no skills found in this folder":"nothing was imported"}{f?` · files: ${f}`:""}</div>
    {s.available>0?<div>{s.available} more skill{s.available===1?"":"s"} in the repository not installed yet. Press Sync now to import {s.available===1?"it":"them"}.</div>:null}
  </div>;
}

// Which files besides SKILL.md are imported, and how pasted skills with the same name are handled.
function FileOptions({value,onChange,disabled,showRoot=false}){
  const toggle=(k)=>onChange({file_types:value.file_types.includes(k)?value.file_types.filter(x=>x!==k):[...value.file_types,k]});
  return <div className="stack" style={{gap:8}}>
    {showRoot?<label className="small" style={{display:"grid",gap:4}}>Skills folder
      <input className="fld" disabled={disabled} placeholder="Empty = find skills anywhere in the repository" value={value.root||""} onChange={e=>onChange({root:e.target.value})}/>
    </label>:null}
    <div className="row" style={{gap:12,flexWrap:"wrap"}}>
      {Object.entries(TYPE_LABELS).map(([k,label])=><label key={k} className="row small" style={{gap:6,alignItems:"center"}}><input type="checkbox" disabled={disabled} checked={value.file_types.includes(k)} onChange={()=>toggle(k)}/>{label}</label>)}
    </div>
    <textarea className="fld" rows={3} disabled={disabled} aria-label="Path filter" placeholder={"Path filter, one pattern per line (blank = all)\nscripts/**\n*.mjs\n!**/fixtures/**"} value={value.path_filter} onChange={e=>onChange({path_filter:e.target.value})}/>
    <label className="row small" style={{gap:8,alignItems:"center"}}>Largest file <input className="fld" type="number" min="50" max="1000" style={{width:90}} disabled={disabled} value={value.max_kb} onChange={e=>onChange({max_kb:Number(e.target.value)||750})}/> KB (up to 1000)</label>
    <label className="row small" style={{gap:8,alignItems:"center",flexWrap:"wrap"}}>Automatic updates
      <select className="fld" disabled={disabled} value={value.update_mode||"safe"} onChange={e=>onChange({update_mode:e.target.value})}>
        <option value="safe">Hold risky changes for my review</option>
        <option value="review">Hold every change for my review</option>
        <option value="all">Apply everything</option>
      </select></label>
    <label className="row small" style={{gap:6,alignItems:"center"}}><input type="checkbox" disabled={disabled} checked={value.adopt} onChange={e=>onChange({adopt:e.target.checked})}/>Replace pasted skills that have the same name (the old text stays in history)</label>
  </div>;
}

const fmtBytes=(b)=>b<1024?`${b} B`:`${Math.round(b/1024)} KB`;

// Every file this repo brought in, grouped by skill, with a preview and a way to drop one for good.
function RepoFiles({repoId,onChanged}){
  const [data,setData]=useState(null);
  const [error,setError]=useState("");
  const [kind,setKind]=useState("all");
  const [q,setQ]=useState("");
  const [shown,setShown]=useState("");
  const [preview,setPreview]=useState(null);
  const [note,setNote]=useState("");
  const load=()=>skillRepos.files(repoId).then(d=>{setData(d);setError("");}).catch(e=>setError(e.message));
  useEffect(()=>{load();},[repoId]);
  async function togglePreview(f){
    const key=f.skill+"/"+f.path;
    if(shown===key){setShown("");return;}
    setShown(key);setPreview({loading:true});
    try{setPreview(await skillRepos.preview(repoId,f.skill,f.path));}catch(e){setPreview({error:e.message});}
  }
  async function remove(f){
    if(!window.confirm(`Remove ${f.skill}/${f.path}? It stays out of future syncs until you restore it.`))return;
    try{await skillRepos.removeFile(repoId,f.skill,f.path);setShown("");setNote("");await load();onChanged&&onChanged();}catch(e){setError(e.message);}
  }
  async function restore(key){
    try{await skillRepos.restoreFile(repoId,key);setNote("Restored. Press Sync now to bring it back.");await load();onChanged&&onChanged();}catch(e){setError(e.message);}
  }
  if(error)return <p className="small" role="alert">{error}</p>;
  if(!data)return <p className="muted small">Loading files…</p>;
  const needle=q.trim().toLowerCase();
  const rows=data.files.filter(f=>(kind==="all"||f.kind===kind)&&(!needle||(f.skill+"/"+f.path).toLowerCase().includes(needle)));
  const bySkill=new Map();
  for(const f of rows.slice(0,200)){if(!bySkill.has(f.skill))bySkill.set(f.skill,[]);bySkill.get(f.skill).push(f);}
  return <div className="stack" style={{gap:8,marginTop:8}}>
    <div className="row" style={{gap:8,flexWrap:"wrap"}}>
      <select className="fld" aria-label="File type" value={kind} onChange={e=>setKind(e.target.value)}>
        <option value="all">All types</option>
        {Object.entries(KIND_NAMES).map(([k,n])=><option key={k} value={k}>{n[1]}</option>)}
      </select>
      <input className="fld" aria-label="Search files" placeholder="Search skill or path" value={q} onChange={e=>setQ(e.target.value)}/>
    </div>
    {note?<p className="muted small" role="status">{note}</p>:null}
    {!data.files.length?<p className="muted small">No files imported from this repository yet. SKILL.md files are not listed here.</p>:null}
    {[...bySkill.entries()].map(([skill,list])=><div key={skill}>
      <div className="small"><b>{skill}</b> · {list.length} file{list.length===1?"":"s"}</div>
      {list.map(f=>{const key=f.skill+"/"+f.path;return <div key={key} className="small" style={{marginLeft:10}}>
        <div className="row" style={{gap:8,alignItems:"center",flexWrap:"wrap"}}>
          <code style={{wordBreak:"break-all"}}>{f.path}</code>
          <span className="muted">{f.kind} · {fmtBytes(f.bytes)}</span>
          <button className="fld" type="button" onClick={()=>togglePreview(f)}>{shown===key?"Hide":"View"}</button>
          <button className="fld" type="button" onClick={()=>remove(f)}>Remove</button>
        </div>
        {shown===key?<div>{preview?.loading?<span className="muted">Loading…</span>:preview?.error?<span role="alert">{preview.error}</span>:preview?.preview===null?<span className="muted">{preview.note}</span>:<pre style={{maxHeight:220,overflow:"auto",whiteSpace:"pre-wrap",wordBreak:"break-word"}}>{preview?.preview}{preview?.truncated?"\n… (first 4000 characters)":""}</pre>}</div>:null}
      </div>;})}
    </div>)}
    {rows.length>200?<p className="muted small">Showing the first 200 of {rows.length} files. Use the search or type filter to narrow the list.</p>:null}
    {data.excluded?.length?<div>
      <div className="small"><b>Removed files</b> ({data.excluded.length}), left out of every sync</div>
      {data.excluded.map(k=><div key={k} className="row small" style={{gap:8,alignItems:"center",marginLeft:10}}><code style={{wordBreak:"break-all"}}>{k}</code><button className="fld" type="button" onClick={()=>restore(k)}>Restore</button></div>)}
    </div>:null}
  </div>;
}

export default function GithubSources({active,onUpdated}) {
  const [rows,setRows]=useState([]);
  const [tokenConfigured,setTokenConfigured]=useState(null);
  const [blockedUntil,setBlockedUntil]=useState("");
  const [quota,setQuota]=useState(null);
  const [repo,setRepo]=useState("");
  const [root,setRoot]=useState("");
  const [branch,setBranch]=useState("main");
  const [names,setNames]=useState("");
  const [busy,setBusy]=useState("");
  const [drafts,setDrafts]=useState({});
  const [filesOpen,setFilesOpen]=useState({});
  const [newOpts,setNewOpts]=useState({file_types:["script","test"],path_filter:"",max_kb:750,adopt:false,update_mode:"safe"});
  const draftOf=(r)=>drafts[r.id]||{file_types:r.file_types||["script","test"],root:r.root||"",path_filter:r.path_filter||"",max_kb:r.max_kb||750,adopt:!!r.adopt,update_mode:r.update_mode||"safe"};
  const setDraft=(r,patch)=>setDrafts(d=>({...d,[r.id]:{...draftOf(r),...patch}}));
  const [message,setMessage]=useState("");
  const load=()=>skillRepos.info().then(({repositories,token_configured,blocked_until,quota:q})=>{setRows(repositories);setTokenConfigured(token_configured);setBlockedUntil(blocked_until||"");setQuota(q||null);return repositories;}).catch(e=>setMessage(e.message));
  // Refresh only while this screen is open AND the page is visible; a hidden tab must not keep calling the Worker.
  useEffect(()=>{
    if(!active)return undefined;
    load();
    const tick=()=>{if(document.visibilityState==="visible")load();};
    const timer=setInterval(tick,15000);
    document.addEventListener("visibilitychange",tick);
    return()=>{clearInterval(timer);document.removeEventListener("visibilitychange",tick);};
  },[active]);
  // One request checks at most 8 files, so "Sync now" keeps going until the whole queue is done (or GitHub says stop).
  async function syncAll(id,force=false){
    let result={};
    for(let i=0;i<80;i++){
      result=await skillRepos.sync(id,force&&i===0);
      if(result.error)throw Error(result.error+(result.blocked_until?" The sync resumes by itself after that.":""));
      await load();
      if(result.busy){await new Promise(r=>setTimeout(r,2500));continue;}
      if(!result.running)break;
      setMessage(`Syncing… ${result.done} of ${result.total} files checked.`);
    }
    return result;
  }
  async function perform(key,work){
    setBusy(key);setMessage("");
    try{const result=await work();if(result.error)throw Error(result.error);await load();onUpdated?.();setMessage(result.unchanged?(result.free?"Already up to date. This check did not use your GitHub quota.":"Already up to date."):result.running?`Paused at ${result.done} of ${result.total} files. It continues on Cloudflare every couple of minutes.`:result.complete?summaryText(result.summary):"Saved.");}
    catch(e){setMessage(e.message)}finally{setBusy("")}
  }
  return <section className="card stack" aria-label="GitHub skill repositories">
    <div className="chead"><div className="grow"><h3>GitHub skill sync</h3>
      <div className="sub">Sync skills and their scripts daily or on demand. GitHub access: {tokenConfigured===null?'Checking…':tokenConfigured?'Token configured':'No token configured'}.</div>
    </div></div>
    {quota?<p className="muted small" role="status">GitHub requests left this hour: <b>{quota.remaining}</b> of {quota.limit}{quota.reset?` · resets ${new Date(quota.reset).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}`:""}{quota.token?"":" · no token"}{quota.estimated?" (estimated)":""}
      {typeof quota.used_by_this_worker==="number"?<span> · this app sent {quota.used_by_this_worker} in the last hour{!quota.token&&quota.limit-quota.remaining-quota.used_by_this_worker>0?`, other apps sharing this address used ${quota.limit-quota.remaining-quota.used_by_this_worker}`:""}</span>:null}</p>:null}
    {blockedUntil?<p className="small" role="alert" style={{color:"var(--danger, #b92a44)"}}>GitHub is limiting requests. Syncing is paused until {new Date(blockedUntil).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}.{tokenConfigured?"":" Adding a GITHUB_TOKEN secret removes this limit."}</p>:null}
    <details className="repo-guide"><summary>GitHub token setup</summary>
      <p className="muted small">Create a <a href="https://github.com/settings/personal-access-tokens/new?name=MemoryRelay%20Skill%20Sync&amp;contents=read&amp;expires_in=90" target="_blank" rel="noopener noreferrer">fine-grained personal access token</a> in GitHub with <strong>Contents: Read-only</strong> and <strong>Metadata: Read-only</strong> (automatic). Use 90-day expiry or your preferred rotation. Public repositories are readable; select private repositories only if necessary.</p>
      <p className="muted small">Cloudflare → Workers &amp; Pages → MemoryRelay Worker → Settings → Variables and Secrets → Add. Name <code>GITHUB_TOKEN</code>, type <strong>Secret</strong>, paste your token, then deploy the setting. Never paste a token here or commit it to GitHub. Authenticated GitHub API calls have a higher rate limit.</p>
    </details>
    {rows.map(r=><div key={r.id} className="stack" style={{borderTop:"1px solid var(--line)",paddingTop:12,gap:6}}>
      <div className="row" style={{justifyContent:"space-between",alignItems:"center"}}>
        <div className="grow"><strong>{r.owner}/{r.repo}</strong> <small className="muted">/ {r.root||"automatic"}</small>
          <div className="muted small">{r.names.length?`${r.names.length} selected skills`:'All skills'} · {r.last_sha?r.last_sha.slice(0,12):'Not checked'} · Auto sync {r.enabled?'on':'off'}</div>
          <div className="small"><b>{r.skill_count}</b> skill{r.skill_count===1?'':'s'} imported{countText(r.file_counts)?` · ${countText(r.file_counts)}`:''}</div>
        </div>
        <Switch checked={r.enabled} disabled={!!busy} title="Enable automatic GitHub sync" onChange={v=>perform(r.id,()=>skillRepos.toggle(r.id,v))}/>
      </div>
      {r.sync_status==='running'&&r.sync_total>0?<div className="repo-progress" aria-live="polite"><div className="row" style={{justifyContent:'space-between'}}><span className="muted small">Syncing on Cloudflare</span><b className="small">{r.sync_done} / {r.sync_total} files</b></div><progress max={r.sync_total} value={r.sync_done} style={{width:'100%'}}/><p className="muted small">{blockedUntil?`Waiting for GitHub until ${new Date(blockedUntil).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}, then continues by itself.`:"Continues on Cloudflare every couple of minutes, even when the app is closed."}</p></div>:null}
      {r.sync_note?<div className="muted small" role="status">{r.sync_note.split(" | ").map((n,i)=><div key={i}>• {n}</div>)}</div>:null}
      {r.last_error?<div className="small" role="alert" style={{color:"var(--danger, #b92a44)"}}>Last check failed: {r.last_error}</div>:null}
      {r.sync_status==='up-to-date'?<p className="muted small">Up to date: no changes on GitHub{r.last_checked?' · '+r.last_checked+' UTC':''}</p>:null}
      {r.summary&&r.sync_status!=='running'?<SyncSummary s={r.summary} when={r.summary.at}/>:r.sync_status==='complete'?<p className="muted small">Sync completed{r.last_checked?' · '+r.last_checked+' UTC':''}</p>:null}
      <details onToggle={e=>{const open=e.currentTarget.open;setFilesOpen(o=>({...o,[r.id]:open}));}}><summary className="small">Imported files ({Object.values(r.file_counts||{}).reduce((a,b)=>a+b,0)})</summary>
        {filesOpen[r.id]?<RepoFiles repoId={r.id} onChanged={load}/>:null}
      </details>
      <details><summary className="small">File settings</summary>
        <div className="stack" style={{marginTop:8,gap:8}}>
          <FileOptions showRoot value={draftOf(r)} onChange={patch=>setDraft(r,patch)} disabled={!!busy}/>
          <button className="fld" type="button" disabled={!!busy} onClick={()=>perform(r.id,()=>syncAll(r.id,true))}>Re-check everything (uses 2 GitHub requests)</button>
          <button className="fld" type="button" disabled={!!busy} onClick={()=>perform(r.id,async()=>{const saved=await skillRepos.filter(r.id,draftOf(r));if(saved.error)throw Error(saved.error);return syncAll(r.id);})}>Save and sync</button>
        </div>
      </details>
      <div className="row" style={{gap:8}}>
        <button className="fld" type="button" disabled={!!busy} onClick={()=>perform(r.id,()=>syncAll(r.id))}>{busy===r.id?"Checking…":"Sync now"}</button>
        <button className="fld" type="button" disabled={!!busy} onClick={()=>{if(window.confirm(`Stop tracking ${r.id}? Installed skills will remain.`))perform(r.id,()=>skillRepos.remove(r.id));}}>Remove repo</button>
      </div>
    </div>)}
    <details><summary><strong>Add GitHub skill set</strong></summary>
      <div className="stack" style={{marginTop:10,gap:8}}>
        <input className="fld" aria-label="GitHub repository" placeholder="owner/repo or GitHub URL" value={repo} onChange={e=>setRepo(e.target.value)}/>
        <div className="row" style={{gap:8}}>
          <input className="fld" aria-label="Skills folder" placeholder="Skills folder (empty = find automatically)" value={root} onChange={e=>setRoot(e.target.value)}/>
          <input className="fld" aria-label="Git branch" placeholder="main" value={branch} onChange={e=>setBranch(e.target.value)}/>
        </div>
        <input className="fld" aria-label="Skill names (optional)" placeholder="Skill names, comma-separated (blank = all)" value={names} onChange={e=>setNames(e.target.value)}/>
        <FileOptions value={newOpts} onChange={patch=>setNewOpts(o=>({...o,...patch}))} disabled={!!busy}/>
        <button className="fld" disabled={!!busy||!repo.trim()} onClick={()=>perform('add',()=>skillRepos.add(repo,root,branch,names,newOpts).then(r=>{if(!r.error)setRepo('');return r;}))}>Add repository</button>
      </div>
    </details>
    {message?<p className="small" role="status">{message}</p>:null}
  </section>;
}
