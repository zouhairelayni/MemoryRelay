import {useEffect,useState} from "react";
import {skillRepos} from "../../api/endpoints.js";
import Switch from "../../components/Switch.jsx";

export default function GithubSources({active,onUpdated}) {
  const [rows,setRows]=useState([]);
  const [repo,setRepo]=useState("");
  const [root,setRoot]=useState("skills");
  const [branch,setBranch]=useState("main");
  const [names,setNames]=useState("");
  const [busy,setBusy]=useState("");
  const [message,setMessage]=useState("");
  const load=()=>skillRepos.list().then(setRows).catch(e=>setMessage(e.message));
  useEffect(()=>{if(active)load();},[active]);
  async function perform(key,work){
    setBusy(key);setMessage("");
    try{const result=await work(); await load();onUpdated?.();setMessage(result.unchanged?"Already up to date.":result.sha?`Synced: ${result.added} added, ${result.updated} updated, ${result.skipped} skipped.`:"Saved.");}
    catch(e){setMessage(e.message)}finally{setBusy("")}
  }
  return <section className="card stack" aria-label="GitHub skill repositories">
    <div className="chead"><div className="grow"><h3>GitHub skill sync</h3>
      <div className="sub">Enable automatic daily updates for each skill set, or sync manually. Scripts and references update with the skill.</div>
    </div></div>
    {rows.map(r=><div key={r.id} className="stack" style={{borderTop:"1px solid var(--line)",paddingTop:12,gap:6}}>
      <div className="row" style={{justifyContent:"space-between",alignItems:"center"}}>
        <div className="grow"><strong>{r.owner}/{r.repo}</strong> <small className="muted">/ {r.root}</small>
          <div className="muted small">{r.names.length?`${r.names.length} selected skills`:'All skills'} · {r.last_sha?r.last_sha.slice(0,12):'Not checked'} · Auto sync {r.enabled?'on':'off'}</div>
        </div>
        <Switch checked={r.enabled} disabled={!!busy} title="Enable automatic GitHub sync" onChange={v=>perform(r.id,()=>skillRepos.toggle(r.id,v))}/>
      </div>
      {r.last_error?<div className="small" style={{color:"var(--danger, #b92a44)"}}>Last check: {r.last_error}</div>:null}
      <div className="row" style={{gap:8}}>
        <button className="fld" type="button" disabled={!!busy} onClick={()=>perform(r.id,()=>skillRepos.sync(r.id))}>Sync now</button>
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
