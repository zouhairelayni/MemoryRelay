import { useEffect, useMemo, useState } from "react";
import { skills } from "../../api/endpoints.js";
const licenses=/^(?:license|licence|notice|copying)(?:\.|$)/i;
export default function ScriptBank({ active, revision }) {
  const [legacy,setLegacy]=useState([]),[resources,setResources]=useState([]),[opened,setOpened]=useState({}),[limit,setLimit]=useState({scripts:8,resources:8});
  const [filter,setFilter]=useState('');
  useEffect(() => {
    if (!active) return;
    setOpened({});
    Promise.all([skills.scripts(), skills.resources()])
      .then(([s, r]) => {
        setLegacy(s);
        setResources(r.filter(x => !licenses.test(x.path.split('/').at(-1))));
      })
      .catch(() => {});
  }, [active, revision]);
  const source=useMemo(()=>{
    const original=resources.filter(x=>x.kind==='script').map(x=>({...x,origin:'official'}));
    return [...original,...legacy.map(x=>({...x,path:x.name,kind:'script',origin:'custom',content:x.code}))];
  },[legacy,resources]);
  const references=resources.filter(x=>x.kind!=='script');
  const load=async item=>{
    const key=item.skill+'/'+item.path;
    if(opened[key]!==undefined||item.kind==='asset'||item.origin==='custom')return;
    try{const data=await skills.resource(item.skill,item.path);setOpened(prev=>({...prev,[key]:data.content??'Binary asset: '+data.url}));}
    catch(e){setOpened(prev=>({...prev,[key]:'Unable to fetch: '+e.message}));}
  };
  const section=(title,items,key)=>{
    const shown=items.filter(x=>(x.skill+' '+x.path).toLowerCase().includes(filter.toLowerCase()));
    return <details className="resource-set" key={key}>
      <summary><strong>{title}</strong><span className="muted small">{shown.length} files</span></summary>
      <div className="resource-content">{shown.slice(0,limit[key]).map(item=>{
        const k=item.skill+'/'+item.path;
        return <details className="resource-file" key={k} onToggle={e=>{if(e.currentTarget.open)load(item);}}>
          <summary><strong>{item.path}</strong><small>{item.skill}{item.origin==='custom'?' · custom':''}</small></summary>
          {item.kind==='asset'?<p><a href={item.url} target="_blank" rel="noreferrer">Open asset source</a></p>:
          <pre><code>{item.origin==='custom'?item.content:opened[k]??'Loading…'}</code></pre>}
        </details>;
      })}
      {shown.length>limit[key]?<button className="fld" onClick={()=>setLimit(p=>({...p,[key]:p[key]+12}))}>Show 12 more ({shown.length-limit[key]} remaining)</button>:null}
      {!shown.length?<p className="muted small">No matching files.</p>:null}</div>
    </details>;
  };
  if(!source.length&&!references.length)return null;
  return <section className="card stack" aria-label="Skill resource bank">
    <h3>Skill files</h3><p className="muted small">Scripts and reference files stay separate. Files are provided as source, never executed by MemoryRelay.</p>
    <input className="fld" type="search" aria-label="Filter skill files" placeholder="Find script or reference" value={filter} onChange={e=>setFilter(e.target.value)}/>
    {section('Scripts',source,'scripts')}{section('References and assets',references,'resources')}
  </section>;
}
