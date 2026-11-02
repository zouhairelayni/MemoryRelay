import {useEffect,useMemo,useState} from 'react';
import {monitoring} from '../../api/endpoints.js';
import Icon from '../../components/Icon.jsx';
const time=(ts)=>new Date(ts).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
const fmt=n=>Intl.NumberFormat().format(Number(n)||0);
const elapsed=ms=>{const sec=Math.max(0,Math.floor(ms/1000));return sec>=3600?`${Math.floor(sec/3600)}h ${Math.floor(sec%3600/60)}m`:sec>=60?`${Math.floor(sec/60)}m ${sec%60}s`:`${sec}s`;};
function RunningElapsed({start}){const [clock,setClock]=useState(Date.now());useEffect(()=>{const id=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(id);},[]);return <span>{elapsed(clock-start)} elapsed{clock-start>20*60e3?' · Check for stalled task':''}</span>;}

function Timeline({daily,days}){
  const entries=new Map();for(const d of daily)entries.set(d.day,(entries.get(d.day)||0)+d.n);
  const values=Array.from({length:days},(_,i)=>{const d=new Date(Date.now()-(days-1-i)*864e5);return entries.get(d.toISOString().slice(0,10))||0;});
  const max=Math.max(1,...values);
  const pts=values.map((n,i)=>[12+i*316/Math.max(1,days-1),84-68*n/max]);
  const path=pts.map(([x,y],i)=>(i?'L':'M')+x.toFixed(1)+' '+y.toFixed(1)).join(' ');
  return <div className="monitor-chart"><svg viewBox="0 0 340 104" role="img" aria-label={`Request volume over the last ${days} days`} preserveAspectRatio="none">
    <path d="M12 84H328" stroke="var(--line)" fill="none"/>
    <path d={path} stroke="var(--cobalt)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    {pts.map(([x,y],i)=><circle key={i} cx={x} cy={y} r={i===pts.length-1?3.5:0} fill="var(--cobalt)"/>)}
  </svg><div className="monitor-chart-ends"><span>{days} days ago</span><span>Today</span></div></div>;
}
function Heat({hourly}){
  const counts=new Map(hourly.map(x=>[x.weekday+'-'+x.hour,Number(x.n)]));
  const max=Math.max(1,...counts.values());
  const labels=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  return <div className="heat-wrap"><div className="heat-grid" role="img" aria-label="Usage by weekday and hour, UTC">
    {labels.map((d,i)=><div className="heat-row" key={d}><span>{d}</span>{Array.from({length:24},(_,j)=>{
      const n=counts.get(i+'-'+String(j).padStart(2,'0'))||0;
      return <i key={j} title={`${d} ${String(j).padStart(2,'0')}:00 UTC — ${n} calls`} style={{background:n?`color-mix(in srgb,var(--cobalt) ${Math.max(18,Math.round(100*n/max))}%,var(--paper2))`:'var(--paper2)'}}/>;
    })}</div>)}
    <div className="heat-hours"><span>00</span><span>06</span><span>12</span><span>18</span><span>23 UTC</span></div>
  </div></div>;
}
export default function MonitorPanel({active}){
  const [days,setDays]=useState(30),[data,setData]=useState(null),[error,setError]=useState('');
  useEffect(()=>{if(!active)return;let alive=true;
    const load=()=>monitoring.get(days).then(d=>{if(alive){setData(d);setError('');}}).catch(e=>{if(alive)setError(e.message)});
    load();const id=setInterval(load,8000);return()=>{alive=false;clearInterval(id)};
  },[active,days]);
  const by=useMemo(()=>new Map((data?.totals||[]).map(x=>[x.category+':'+x.action,x])),[data]);
  const sum=(category,action)=>[...by.entries()].reduce((n,[k,v])=>n+(k.startsWith(category+':')&&(!action||k===category+':'+action)?v.n:0),0);
  const jobs=data?.jobs||[];
  const activeJobs=jobs.filter(j=>j.state==='running');
  return <section className="monitor-root" aria-label="Activity monitoring">
    <div className="monitor-header"><div><h3>Activity</h3><p className="muted small">Usage recorded by MemoryRelay. Token counts are estimates, not billing totals.</p></div>
      <select className="fld" aria-label="Activity period" value={days} onChange={e=>setDays(Number(e.target.value))}><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option></select></div>
    {error?<p className="small" role="alert">Unable to load monitoring: {error}</p>:null}
    {!data?<p className="muted small">Loading activity…</p>:<>
      <div className="monitor-metrics">
        <div><b>{fmt(sum('mcp'))}</b><span>MCP calls</span></div>
        <div><b>{fmt(sum('skill','selected'))}</b><span>Skills selected</span></div>
        <div><b>{fmt(sum('mcp','delegate'))}</b><span>Delegations</span></div>
        <div><b>{fmt(sum('mcp','remember')+sum('mcp','update_memory')+sum('mcp','forget'))}</b><span>Memory edits</span></div>
        <div><b>{fmt(sum('provider','api_call'))}</b><span>AI API calls</span></div>
        <div><b>{fmt(data.counts.tokens_in+data.counts.tokens_out)}</b><span>Estimated AI tokens</span></div>
      </div>
      <div className="card monitor-figure"><h4>Requests over time</h4><Timeline daily={data.daily} days={days}/><h4>Usage by hour</h4><Heat hourly={data.hourly}/></div>
      <div className="card monitor-figure" aria-live="polite"><div className="row" style={{justifyContent:'space-between',alignItems:'baseline'}}><h4>Subagent tasks</h4><span className="muted small">{activeJobs.length} running</span></div>
        {activeJobs.map(j=><div key={j.id} className="job-row"><div className="row" style={{alignItems:'center',gap:8}}><span className="job-dot"/><b>{j.agent}</b><span className="muted small">{j.provider||'Finding a model'} {j.model}</span></div><p>{j.task_summary||'Task summary unavailable'}</p><small className="muted">{j.kind} · Started {time(j.ts)} · <RunningElapsed start={j.ts}/></small></div>)}
        {!activeJobs.length?<p className="muted small">No subagents currently running.</p>:null}
        <details className="monitor-details"><summary>Completed and failed tasks ({jobs.length-activeJobs.length})</summary>
          {jobs.filter(j=>!activeJobs.includes(j)).slice(0,25).map(j=><div className="job-row" key={j.id}><b>{j.agent} · {j.state||'Completed'}</b><p>{j.task_summary||'Task summary was not recorded'}</p><small className="muted">{j.provider} {j.model} · {j.kind} · {time(j.ts)} · {elapsed(j.ms)} duration · {fmt(j.tokens_in+j.tokens_out)} estimated tokens</small>{j.error?<p className="small" role="alert">{j.error}</p>:null}</div>)}
        </details>
      </div>
      <div className="card monitor-figure"><h4>Activity by type</h4>
        {data.totals.slice(0,14).map(x=><div key={x.category+':'+x.action} className="monitor-breakdown"><span>{x.category} / {x.action}</span><b>{fmt(x.n)}</b></div>)}
        <details className="monitor-details"><summary>Errors ({data.errors.length} recent)</summary>
          {data.errors.length?data.errors.map((e,i)=><div key={i} className="job-row"><b>{e.error_code||'ERROR'} · {e.action}</b><p>{e.error_message||'Request failed'}</p><small className="muted">{time(e.ts)}</small></div>):<p className="muted small">No recorded errors in the recent event window.</p>}
        </details>
        <details className="monitor-details"><summary>Recent API and agent calls</summary>{data.events.map((e,i)=><div className="monitor-breakdown" key={i}><span>{e.category}: {e.action}{e.detail?' · '+e.detail:''}</span><small>{time(e.ts)}</small></div>)}</details>
      </div>
    </>}
  </section>;
}
