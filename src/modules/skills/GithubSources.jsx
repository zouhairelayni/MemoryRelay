import {useEffect,useState} from "react";
import {skillRepos} from "../../api/endpoints.js";
import Switch from "../../components/Switch.jsx";
import AppSelect from "../../components/AppSelect.jsx";
import Icon from "../../components/Icon.jsx";

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
    <label className="row small" style={{gap:8,alignItems:"center"}}>Largest file <input className="fld" type="number" min="50" max="1000" style={{width:90}} disabled={disabled} placeholder="750" value={value.max_kb} onChange={e=>onChange({max_kb:e.target.value})}/> KB (50–1000; blank = 750)</label>
    <label className="row small" style={{gap:8,alignItems:"center",flexWrap:"wrap"}}>Automatic updates
      <AppSelect label="Automatic update policy" disabled={disabled} value={value.update_mode||"safe"}
        onChange={next=>onChange({update_mode:next})} options={[
          {value:"safe",label:"Review risky changes",description:"Safest default"},
          {value:"review",label:"Review every change"},
          {value:"all",label:"Automatically apply all",description:"Trusted repositories only"},
        ]}/></label>
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
  const [confirmFile,setConfirmFile]=useState("");
  const load=()=>skillRepos.files(repoId).then(d=>{setData(d);setError("");}).catch(e=>setError(e.message));
  useEffect(()=>{load();},[repoId]);
  async function togglePreview(f){
    const key=f.skill+"/"+f.path;
    if(shown===key){setShown("");return;}
    setShown(key);setPreview({loading:true});
    try{setPreview(await skillRepos.preview(repoId,f.skill,f.path));}catch(e){setPreview({error:e.message});}
  }
  async function remove(f){
    setConfirmFile("");
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
      <AppSelect label="File type" value={kind} onChange={setKind} options={[
        {value:"all",label:"All types"},
        ...Object.entries(KIND_NAMES).map(([value,labels])=>({value,label:labels[1]})),
      ]}/>
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
          <button className="fld" type="button" onClick={()=>setConfirmFile(confirmFile===key?"":key)}>Remove</button>
        </div>
        {confirmFile===key?<div className="repo-file-confirm" role="group" aria-label={`Confirm removal of ${f.path}`}>
          <span>Exclude this file from future syncs?</span>
          <button className="btn sm danger" type="button" onClick={()=>remove(f)}>Remove file</button>
          <button className="btn sm ghost" type="button" onClick={()=>setConfirmFile("")}>Cancel</button>
        </div>:null}
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

export default function GithubSources({active,onUpdated,onOpenRepo,focusRepo,onCloseRepo}) {
  const [rows,setRows]=useState([]);
  const [tokenConfigured,setTokenConfigured]=useState(null);
  const [token,setToken]=useState("");
  const [tokenState,setTokenState]=useState({});
  const [blockedUntil,setBlockedUntil]=useState("");
  const [quota,setQuota]=useState(null);
  const [repo,setRepo]=useState("");
  const [root,setRoot]=useState("");
  const [branch,setBranch]=useState("main");
  const [names,setNames]=useState("");
  const [busy,setBusy]=useState("");
  const [drafts,setDrafts]=useState({});
  const [detailTab,setDetailTab]=useState("overview");
  const [removeArmed,setRemoveArmed]=useState(false);
  const [removeText,setRemoveText]=useState("");
  const [newOpts,setNewOpts]=useState({file_types:["script","test"],path_filter:"",max_kb:750,adopt:false,update_mode:"safe"});
  const draftOf=(r)=>drafts[r.id]||{file_types:r.file_types||["script","test"],root:r.root||"",path_filter:r.path_filter||"",max_kb:r.max_kb!==undefined && r.max_kb!==null && r.max_kb!==""?r.max_kb:750,adopt:!!r.adopt,update_mode:r.update_mode||"safe"};
  const setDraft=(r,patch)=>setDrafts(d=>({...d,[r.id]:{...draftOf(r),...patch}}));
  const [message,setMessage]=useState("");
  const load=()=>skillRepos.info().then(({repositories,token_configured,blocked_until,quota:q,...tokenInfo})=>{setTokenState(tokenInfo);setRows(repositories);setTokenConfigured(token_configured);setBlockedUntil(blocked_until||"");setQuota(q||null);return repositories;}).catch(e=>setMessage(e.message));
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
    try{const result=await work();if(result.error)throw Error(result.error);await load();onUpdated?.();setMessage(result.unchanged?(result.free?"Already up to date. This check did not use your GitHub quota.":"Already up to date."):result.running?`Paused at ${result.done} of ${result.total} files. It continues on Cloudflare every couple of minutes.`:result.complete?summaryText(result.summary):"Saved.");return true;}
    catch(e){setMessage(e.message);return false;}finally{setBusy("")}
  }
  const selected = focusRepo ? rows.find(r=>r.id===focusRepo) : null;
  if(focusRepo){
    if(!selected)return <section className="repo-workspace stack" aria-live="polite">
      <button type="button" className="repo-back" onClick={onCloseRepo}><Icon name="chev" size={17}/> Back to repositories</button>
      <div className="card"><p className="muted">{rows.length ? "This repository is no longer tracked." : "Loading repository…"}</p></div>
    </section>;
    const filesTotal=Object.values(selected.file_counts||{}).reduce((n,v)=>n+Number(v||0),0);
    return <section className="repo-workspace stack" aria-label={`Repository ${selected.repo}`}>
      <button type="button" className="repo-back" onClick={onCloseRepo}><span aria-hidden="true">←</span> All repositories</button>
      <header className="repo-detail-hero">
        <span className="dash-eyebrow">SKILLS / REPOSITORY</span>
        <div className="repo-detail-title"><span className="repo-card-icon"><Icon name="skills" size={24}/></span><div>
          <h1>{selected.repo}</h1><p>{selected.owner} · {selected.branch || "main"}</p>
        </div></div>
        <div className="repo-meta"><span className={`repo-pill ${selected.last_error?"problem":"up"}`}><i/>{selected.last_error?"Needs review":selected.sync_status==='running'?"Sync in progress":selected.last_sha?"Connected":"Not checked"}</span>
          <span className="repo-pill">{selected.skill_count} imported skills</span><span className="repo-pill">{filesTotal} resources</span></div>
      </header>
      <div className="repo-detail-tabs" role="tablist" aria-label="Repository sections">
        {[["overview","Overview"],["files","Files"],["settings","Settings"]].map(([key,label])=><button key={key} type="button" role="tab" aria-selected={detailTab===key} className={detailTab===key?"active":""} onClick={()=>setDetailTab(key)}>{label}</button>)}
      </div>
      {detailTab==="overview"?<div className="repo-detail-panel" role="tabpanel">
        <div className="repo-stats"><div><small>Imported skills</small><b>{selected.skill_count}</b></div><div><small>Resource files</small><b>{filesTotal}</b></div><div><small>Sync mode</small><b>{selected.enabled?"Active":"Paused"}</b></div></div>
        {selected.last_error?<p className="repo-inline-alert" role="alert">{selected.last_error}</p>:null}
        <div className="card repo-info-card"><h3>Sync activity</h3>
          <p className="muted small">{selected.last_checked?`Last checked ${selected.last_checked} UTC`:"Not checked yet"}</p>
          {selected.sync_status==='running'&&selected.sync_total>0?<div className="repo-progress"><div className="row"><span>Checking files</span><b>{selected.sync_done}/{selected.sync_total}</b></div><progress max={selected.sync_total} value={selected.sync_done}/></div>:null}
          {selected.sync_note?<p className="muted small">{selected.sync_note.split(" | ").join(" · ")}</p>:null}
          {selected.summary?<SyncSummary s={selected.summary} when={selected.summary.at}/>:null}
          <div className="repo-actions"><button className="btn" disabled={!!busy} onClick={()=>perform(selected.id,()=>syncAll(selected.id))}>{busy===selected.id?"Syncing…":"Sync now"}</button>
            <button className="btn ghost" disabled={!!busy} onClick={()=>perform(selected.id,()=>syncAll(selected.id,true))}>Full re-check</button></div>
        </div>
        <div className="card repo-info-card"><div className="repo-card-heading"><div className="grow"><h3>Automatic sync</h3><p className="muted small">Keep this source up to date</p></div>
          <Switch checked={selected.enabled} disabled={!!busy} title="Enable automatic repository sync" onChange={next=>perform(selected.id,()=>skillRepos.toggle(selected.id,next))}/></div></div>
      </div>:null}
      {detailTab==="files"?<div className="card repo-detail-panel" role="tabpanel"><h3>Imported resources</h3><p className="muted small">Browse, preview, exclude or restore files from this repository.</p><RepoFiles repoId={selected.id} onChanged={load}/></div>:null}
      {detailTab==="settings"?<div className="repo-detail-panel" role="tabpanel">
        <div className="card stack"><h3>Import preferences</h3><p className="muted small">Control which files this repository can import. Existing memories and skills are not deleted.</p>
          <FileOptions showRoot value={draftOf(selected)} onChange={patch=>setDraft(selected,patch)} disabled={!!busy}/>
          <div className="repo-actions"><button className="btn" disabled={!!busy} onClick={()=>perform(selected.id,async()=>{const saved=await skillRepos.filter(selected.id,draftOf(selected));if(saved.error)throw Error(saved.error);return syncAll(selected.id);})}>Save & sync</button></div>
        </div>
        <div className="card repo-danger-zone"><h3>Disconnect repository</h3><p className="muted small">Stop syncing this source. Previously installed skills will remain.</p>
          {!removeArmed?<button className="btn danger" type="button" onClick={()=>setRemoveArmed(true)}>Disconnect repository</button>:
          <div className="stack"><label className="small">Type <strong>{selected.repo}</strong> to confirm<input className="fld" autoComplete="off" value={removeText} onChange={e=>setRemoveText(e.target.value)}/></label>
            <div className="repo-actions"><button className="btn danger" type="button" disabled={!!busy||removeText!==selected.repo} onClick={async()=>{if(await perform(selected.id,()=>skillRepos.remove(selected.id)))onCloseRepo?.();}}>Confirm disconnect</button><button className="btn ghost" type="button" onClick={()=>{setRemoveArmed(false);setRemoveText("");}}>Cancel</button></div>
          </div>}</div>
      </div>:null}
      {message?<p className="small repo-action-message" role="status">{message}</p>:null}
    </section>;
  }
  return <section className="card stack" aria-label="GitHub skill repositories">
    <div className="chead"><div className="grow"><span className="dash-eyebrow">SOURCES & INTEGRATIONS</span><h3>Connected repositories</h3>
      <div className="sub">Bring in trusted skills, scripts and reference material. Sync when you choose or automatically.</div>
    </div></div>
    {quota?<p className="muted small" role="status">GitHub requests left this hour: <b>{quota.remaining}</b> of {quota.limit}{quota.reset?` · resets ${new Date(quota.reset).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}`:""}{quota.token?"":" · no token"}{quota.estimated?" (estimated)":""}
      {typeof quota.used_by_this_worker==="number"?<span> · this app sent {quota.used_by_this_worker} in the last hour{!quota.token&&quota.limit-quota.remaining-quota.used_by_this_worker>0?`, other apps sharing this address used ${quota.limit-quota.remaining-quota.used_by_this_worker}`:""}</span>:null}</p>:null}
    {blockedUntil?<p className="small" role="alert" style={{color:"var(--danger, #b92a44)"}}>GitHub is limiting requests. Syncing is paused until {new Date(blockedUntil).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}.{tokenConfigured?"":" Save a GitHub token below to use an authenticated quota."}</p>:null}
    <details className="repo-guide"><summary>GitHub token</summary>
      <p className="muted small">{tokenState.token_saved ? (tokenState.token_encrypted ? "A token is saved encrypted in the database." : "A token is saved unencrypted in the database.") : tokenState.token_source === "worker" ? "Using the GITHUB_TOKEN Worker secret. A token saved here takes priority." : "Save a personal access token to increase your GitHub quota and sync private repositories."}</p>
      {tokenState.token_locked?<p className="small" role="alert">The saved token cannot be decrypted. Restore KEY_SECRET on the Worker, or replace the token.</p>:null}
      {!tokenState.token_encryption_enabled?<p className="small" role="status">Encryption is off. Tokens saved here will be stored unencrypted in the database. Set KEY_SECRET in your Worker secrets to enable encryption.</p>:null}
      <form className="row" style={{gap:8,flexWrap:"wrap"}} onSubmit={e=>{e.preventDefault();perform("token",async()=>{const result=await skillRepos.saveToken(token);setToken("");return result;});}}>
        <label className="small">GitHub personal access token
          <input className="fld" type="password" autoComplete="new-password" spellCheck={false} value={token} onChange={e=>setToken(e.target.value)} placeholder={tokenState.token_saved?"Enter a replacement token":"ghp_… or github_pat_…"} disabled={!!busy}/>
        </label>
        <button className="btn" type="submit" disabled={!!busy||!token.trim()}>{busy==="token"?"Saving…":tokenState.token_saved?"Replace token":"Save token"}</button>
        {tokenState.token_saved?<button className="btn" type="button" disabled={!!busy} onClick={()=>perform("remove-token",()=>skillRepos.removeToken())}>Remove saved token</button>:null}
      </form>
      <p className="muted small">Classic and fine-grained tokens are supported. For a fine-grained token, grant Contents: Read-only for the repositories you want to sync. The token is checked before saving. Encryption at rest is optional, as with the app’s other API keys. Removing it falls back to the Worker secret, if configured.</p>
      <p className="muted small"><a href="https://github.com/settings/tokens" target="_blank" rel="noopener noreferrer">Manage GitHub tokens</a></p>
    </details>
    <div className="repo-list-scroll" role="region" aria-label="Tracked skill repositories" tabIndex={0}>
    {rows.map(r=><div key={r.id} className="repo-list-item stack">
      <div className="repo-card-heading">
        <div className="repo-card-icon" aria-hidden="true"><Icon name="skills" size={21}/></div>
        <div className="repo-card-name grow"><strong>{r.repo}</strong><span className="repo-location">{r.owner} · {r.root || "Auto-discover"}</span></div>
        <Switch checked={r.enabled} disabled={!!busy} title={`Automatic sync for ${r.repo}`} onChange={v=>perform(r.id,()=>skillRepos.toggle(r.id,v))}/>
      </div>
      <div className="repo-meta">
        <span className={`repo-pill ${r.last_error?"problem":"up"}`}><i/>{r.last_error?"Needs review":r.sync_status==='running'?"Syncing":r.last_sha?"Tracked":"Not checked"}</span>
        <span className="repo-pill">{r.skill_count} skills</span>
        <span className="repo-pill">{Object.values(r.file_counts||{}).reduce((n,v)=>n+Number(v||0),0)} files</span>
      </div>
      <button className="repo-card-open" type="button" onClick={()=>onOpenRepo?.(r.id)}>
        <span>Open repository</span><span aria-hidden="true">→</span>
      </button>
    </div>)}
    </div>
    {rows.length>3?<p className="repo-scroll-hint">↓ Scroll to explore all {rows.length} repositories</p>:null}
    <details className="repo-add"><summary><strong>+ Connect another repository</strong></summary>
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
