import {useEffect,useState} from "react";
import {skillRepos} from "../../api/endpoints.js";
import Switch from "../../components/Switch.jsx";

export default function GithubSources({active,onUpdated}) {
  const [rows,setRows]=useState([]);
  const [tokenConfigured,setTokenConfigured]=useState(null);
  const [blockedUntil,setBlockedUntil]=useState("");
  const [repo,setRepo]=useState("");
  const [root,setRoot]=useState("skills");
  const [branch,setBranch]=useState("main");
  const [names,setNames]=useState("");
  const [busy,setBusy]=useState("");
  const [message,setMessage]=useState("");
  const load=()=>skillRepos.info().then(({repositories,token_configured,blocked_until})=>{setRows(repositories);setTokenConfigured(token_configured);setBlockedUntil(blocked_until||"");return repositories;}).catch(e=>setMessage(e.message));
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
  async function syncAll(id){
    let result={};
    for(let i=0;i<80;i++){
      result=await skillRepos.sync(id);
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
    try{const result=await work();if(result.error)throw Error(result.error);await load();onUpdated?.();setMessage(result.unchanged?"Already up to date.":result.running?`Paused at ${result.done} of ${result.total} files. It continues on Cloudflare every couple of minutes.`:result.complete?`Sync complete: ${result.total} files checked.`:"Saved.");}
    catch(e){setMessage(e.message)}finally{setBusy("")}
  }
  return <section className="card stack" aria-label="GitHub skill repositories">
    <div className="chead"><div className="grow"><h3>GitHub skill sync</h3>
      <div className="sub">Sync skills and their scripts daily or on demand. GitHub access: {tokenConfigured===null?'Checking…':tokenConfigured?'Token configured':'No token configured'}.</div>
    </div></div>
    {blockedUntil?<p className="small" role="alert" style={{color:"var(--danger, #b92a44)"}}>GitHub is limiting requests. Syncing is paused until {new Date(blockedUntil).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}.{tokenConfigured?"":" Adding a GITHUB_TOKEN secret removes this limit."}</p>:null}
    <details className="repo-guide"><summary>GitHub token setup</summary>
      <p className="muted small">Create a <a href="https://github.com/settings/personal-access-tokens/new?name=MemoryRelay%20Skill%20Sync&amp;contents=read&amp;expires_in=90" target="_blank" rel="noopener noreferrer">fine-grained personal access token</a> in GitHub with <strong>Contents: Read-only</strong> and <strong>Metadata: Read-only</strong> (automatic). Use 90-day expiry or your preferred rotation. Public repositories are readable; select private repositories only if necessary.</p>
      <p className="muted small">Cloudflare → Workers &amp; Pages → MemoryRelay Worker → Settings → Variables and Secrets → Add. Name <code>GITHUB_TOKEN</code>, type <strong>Secret</strong>, paste your token, then deploy the setting. Never paste a token here or commit it to GitHub. Authenticated GitHub API calls have a higher rate limit.</p>
    </details>
    {rows.map(r=><div key={r.id} className="stack" style={{borderTop:"1px solid var(--line)",paddingTop:12,gap:6}}>
      <div className="row" style={{justifyContent:"space-between",alignItems:"center"}}>
        <div className="grow"><strong>{r.owner}/{r.repo}</strong> <small className="muted">/ {r.root}</small>
          <div className="muted small">{r.names.length?`${r.names.length} selected skills`:'All skills'} · {r.last_sha?r.last_sha.slice(0,12):'Not checked'} · Auto sync {r.enabled?'on':'off'}</div>
        </div>
        <Switch checked={r.enabled} disabled={!!busy} title="Enable automatic GitHub sync" onChange={v=>perform(r.id,()=>skillRepos.toggle(r.id,v))}/>
      </div>
      {r.sync_status==='running'&&r.sync_total>0?<div className="repo-progress" aria-live="polite"><div className="row" style={{justifyContent:'space-between'}}><span className="muted small">Syncing on Cloudflare</span><b className="small">{r.sync_done} / {r.sync_total} files</b></div><progress max={r.sync_total} value={r.sync_done} style={{width:'100%'}}/><p className="muted small">{blockedUntil?`Waiting for GitHub until ${new Date(blockedUntil).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}, then continues by itself.`:"Continues on Cloudflare every couple of minutes, even when the app is closed."}</p></div>:null}
      {r.sync_note?<div className="muted small" role="status">{r.sync_note.split(" | ").map((n,i)=><div key={i}>• {n}</div>)}</div>:null}
      {r.last_error?<div className="small" role="alert" style={{color:"var(--danger, #b92a44)"}}>Last check failed: {r.last_error}</div>:null}
      {r.sync_status==='complete'||r.sync_status==='up-to-date'?<p className="muted small">{r.sync_status==='complete'?'Sync completed':'Up to date'}{r.last_checked?' · '+r.last_checked+' UTC':''}</p>:null}
      <div className="row" style={{gap:8}}>
        <button className="fld" type="button" disabled={!!busy} onClick={()=>perform(r.id,()=>syncAll(r.id))}>{busy===r.id?"Checking…":"Sync now"}</button>
        <button className="fld" type="button" disabled={!!busy} onClick={()=>{if(window.confirm(`Stop tracking ${r.id}? Installed skills will remain.`))perform(r.id,()=>skillRepos.remove(r.id));}}>Remove repo</button>
      </div>
    </div>)}
    <details><summary><strong>Add GitHub skill set</strong></summary>
      <div className="stack" style={{marginTop:10,gap:8}}>
        <input className="fld" aria-label="GitHub repository" placeholder="owner/repo or GitHub URL" value={repo} onChange={e=>setRepo(e.target.value)}/>
        <div className="row" style={{gap:8}}>
          <input className="fld" aria-label="Skills folder" placeholder="skills" value={root} onChange={e=>setRoot(e.target.value)}/>
          <input className="fld" aria-label="Git branch" placeholder="main" value={branch} onChange={e=>setBranch(e.target.value)}/>
        </div>
        <input className="fld" aria-label="Skill names (optional)" placeholder="Skill names, comma-separated (blank = all)" value={names} onChange={e=>setNames(e.target.value)}/>
        <button className="fld" disabled={!!busy||!repo.trim()} onClick={()=>perform('add',()=>skillRepos.add(repo,root,branch,names).then(r=>{setRepo('');return r;}))}>Add repository</button>
      </div>
    </details>
    {message?<p className="small" role="status">{message}</p>:null}
  </section>;
}
