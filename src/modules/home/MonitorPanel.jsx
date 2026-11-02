import {useEffect,useMemo,useState} from 'react';
import {monitoring} from '../../api/endpoints.js';
import ActivityChart from './ActivityChart.jsx';

const fmt=n=>Intl.NumberFormat().format(Number(n)||0);
const time=ts=>new Date(ts).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
const elapsed=ms=>{const sec=Math.max(0,Math.floor(ms/1000));return sec>=3600?`${Math.floor(sec/3600)}h ${Math.floor(sec%3600/60)}m`:sec>=60?`${Math.floor(sec/60)}m ${sec%60}s`:`${sec}s`;};
const memoryActions=new Set(['remember','update_memory','forget']);
const measure=(row,id)=>{
  if(id==='mcp')return row.category==='mcp'?Number(row.n):0;
  if(id==='skill')return row.category==='skill'?Number(row.n):0;
  if(id==='delegate')return row.category==='mcp'&&row.action==='delegate'?Number(row.n):0;
  if(id==='memory')return row.category==='mcp'&&memoryActions.has(row.action)?Number(row.n):0;
  if(id==='provider')return row.category==='provider'?Number(row.n):0;
  if(id==='api')return row.category==='api'?Number(row.n):0;
  if(id==='tokens')return row.category==='provider'?Number(row.tin)+Number(row.tout):0;
  if(id==='errors')return Number(row.errors)||0;
  return 0;
};
const METRICS=[
  ['mcp','MCP calls'],['skill','Skills selected'],['delegate','Delegated tasks'],['memory','Memory changes'],
  ['provider','Model API calls'],['api','Dashboard API calls'],['tokens','Estimated tokens'],['errors','Errors'],
];
function RunningElapsed({start}){const [clock,setClock]=useState(Date.now());useEffect(()=>{const id=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(id);},[]);return <span>{elapsed(clock-start)} elapsed{clock-start>20*60e3?' · Check for stalled task':''}</span>;}
function Heat({hourly}){
  const counts=new Map(hourly.map(x=>[x.weekday+'-'+x.hour,Number(x.n)]));
  const max=Math.max(1,...counts.values());
  return <div className="heat-wrap"><div className="heat-grid" role="img" aria-label="Requests by day of week and hour, UTC">
    {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d,i)=><div className="heat-row" key={d}><span>{d}</span>{Array.from({length:24},(_,j)=>{
      const n=counts.get(i+'-'+String(j).padStart(2,'0'))||0;
      return <i key={j} title={`${d} ${String(j).padStart(2,'0')}:00 UTC: ${n} calls`} style={{background:n?`color-mix(in srgb,var(--cobalt) ${Math.max(18,Math.round(85*n/max))}%,var(--paper2))`:'var(--paper2)'}}/>;
    })}</div>)}
    <div className="heat-hours"><span>00</span><span>06</span><span>12</span><span>18</span><span>23 UTC</span></div>
  </div></div>;
}
export default function MonitorPanel({active}) {
  const [period,setPeriod]=useState('30'),[metric,setMetric]=useState('mcp'),[data,setData]=useState(null),[error,setError]=useState('');
  useEffect(()=>{if(!active)return;let alive=true;setData(null);
    const load=()=>monitoring.get(period).then(d=>{if(alive){setData(d);setError('');}}).catch(e=>{if(alive)setError(e.message)});
    load();const id=setInterval(load,8000);return()=>{alive=false;clearInterval(id)};
  },[active,period]);
  const timeline=useMemo(()=>{
    if(!data)return {buckets:[],totals:[],byMetric:{},byAction:new Map()};
    const {step,series}=data;
    const last=Math.floor(Date.now()/step)*step;
    const count=Math.ceil((last-data.start)/step)+1;
    const buckets=Array.from({length:Math.min(92,count)},(_,i)=>last-(Math.min(92,count)-1-i)*step);
    const at=new Map(buckets.map((b,i)=>[b,i]));
    const totals=buckets.map(()=>0),byMetric=Object.fromEntries(METRICS.map(([id])=>[id,buckets.map(()=>0)])),byAction=new Map();
    for(const row of series){const index=at.get(Number(row.bucket));if(index===undefined)continue;
      const n=Number(row.n),key=row.category+':'+row.action;totals[index]+=n;
      if(!byAction.has(key))byAction.set(key,buckets.map(()=>0));byAction.get(key)[index]+=n;
      for(const [id] of METRICS)byMetric[id][index]+=measure(row,id);
    }
    return {buckets,totals,byMetric,byAction};
  },[data]);
  const totals=useMemo(()=>METRICS.map(([id,label])=>({id,label,count:(data?.totals||[]).reduce((n,row)=>n+measure(row,id),0)})),[data]);
  const timeLabels=useMemo(()=>timeline.buckets.map(t=>new Date(t).toLocaleString(undefined,
    period==='1h'||period==='1d'?{hour:'2-digit',minute:'2-digit'}:{month:'short',day:'numeric'})),[timeline.buckets,period]);
  const functionRows=useMemo(()=>(data?.totals||[]).filter(x=>Number(x.n)>0),[data]);
  const topFunctions=useMemo(()=>functionRows.slice(0,8),[functionRows]);
  const functionNames=useMemo(()=>topFunctions.map(x=>{const name=x.category+' / '+x.action;return name.length>26?name.slice(0,25)+'…':name;}),[topFunctions]);
  const functionCounts=useMemo(()=>topFunctions.map(x=>Number(x.n)),[topFunctions]);
  const plotValues=metric==='all'?timeline.totals:metric.startsWith('fn:')?
    timeline.byAction.get(metric.slice(3))||[]:timeline.byMetric[metric]||[];
  const selectedLabel=metric==='all'?'All recorded events':metric.startsWith('fn:')?
    metric.slice(3).replace(':',' / '):METRICS.find(([id])=>id===metric)?.[1]||'MCP calls';
  const jobs=data?.jobs||[],activeJobs=jobs.filter(j=>j.state==='running');
  return <section className="monitor-root" aria-label="Activity monitoring">
    <div className="monitor-header"><div><h3>Activity</h3><p className="muted small">Recorded usage. AI token counts are estimates, not billing totals.</p></div>
      <select className="fld" aria-label="Activity period" value={period} onChange={e=>{setPeriod(e.target.value);setMetric('mcp')}}>
        <option value="1h">1 hour</option><option value="1d">1 day</option><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option>
      </select></div>
    {error?<p className="small" role="alert">Unable to load activity: {error}</p>:null}
    {!data?<p className="muted small">Loading activity…</p>:<>
      <div className="monitor-metrics">
        {totals.map(({id,label,count})=><div key={id} className="monitor-metric"><span>{label}</span><b>{fmt(count)}</b></div>)}
      </div>
      <div className="card monitor-figure">
        <div className="monitor-chart-title"><div><h4>Activity trend</h4><p className="muted small">{data.label} · Recorded data, not cumulative totals</p></div>
          <select className="fld" aria-label="Chart metric" value={metric} onChange={e=>setMetric(e.target.value)}>
            <option value="all">All recorded events</option>
            <optgroup label="Metrics">{METRICS.map(([id,name])=><option key={id} value={id}>{name}</option>)}</optgroup>
            <optgroup label="Functions">{functionRows.map(x=><option key={`${x.category}:${x.action}`} value={`fn:${x.category}:${x.action}`}>{x.category} / {x.action}</option>)}</optgroup>
          </select>
        </div>
        <ActivityChart type="line" labels={timeLabels} values={plotValues} label={`${selectedLabel} over ${data.label}`} unit={metric==='tokens'?'tokens':metric==='skill'?'selections':metric==='delegate'?'tasks':metric==='errors'?'errors':'calls'}/>
        {period==='1h'||period==='1d'?null:<><h4>Hourly activity (UTC)</h4><Heat hourly={data.hourly}/></>}
      </div>
      <div className="card monitor-figure"><div className="monitor-chart-title"><h4>Most used functions</h4><span className="muted small">Top {topFunctions.length} in {data.label}</span></div>
        {topFunctions.length?<ActivityChart type="bar" labels={functionNames} values={functionCounts} label="Most used functions"/>:<p className="muted small">No functions recorded for this period.</p>}
        <details className="monitor-details"><summary>All recorded functions ({functionRows.length})</summary>
          <div className="monitor-function-list">{functionRows.map(x=><div key={`${x.category}:${x.action}`} className="monitor-breakdown"><span>{x.category} / {x.action}</span><b>{fmt(x.n)}</b></div>)}</div>
        </details>
      </div>
      <div className="card monitor-figure" aria-live="polite"><div className="monitor-chart-title"><h4>Subagent tasks</h4><span className="muted small">{activeJobs.length} running</span></div>
        {activeJobs.map(j=><div key={j.id} className="job-row"><div className="row" style={{alignItems:'center',gap:8}}><span className="job-dot"/><b>{j.agent}</b><span className="muted small">{j.provider||'Finding a model'} {j.model}</span></div><p>{j.task_summary||'Task summary unavailable'}</p><small className="muted">{j.kind} · Started {time(j.ts)} · <RunningElapsed start={j.ts}/></small></div>)}
        {!activeJobs.length?<p className="muted small">No subagents currently running.</p>:null}
        <details className="monitor-details"><summary>Completed and failed tasks ({jobs.length-activeJobs.length})</summary>
          {jobs.filter(j=>j.state!=='running').slice(0,25).map(j=><div className="job-row" key={j.id}><b>{j.agent} · {j.state||'Completed'}</b><p>{j.task_summary||'Task summary was not recorded'}</p><small className="muted">{j.provider} {j.model} · {j.kind} · {time(j.ts)} · {elapsed(j.ms)} · {fmt(Number(j.tokens_in)+Number(j.tokens_out))} estimated tokens</small>{j.error?<p className="small" role="alert">{j.error}</p>:null}</div>)}
        </details>
      </div>
      <div className="card monitor-figure"><h4>Errors and recent calls</h4>
        <details className="monitor-details"><summary>Errors ({data.errors.length} recent)</summary>
          {data.errors.length?data.errors.map((e,i)=><div key={i} className="job-row"><b>{e.error_code||'ERROR'} · {e.action}</b><p>{e.error_message||'Request failed'}</p><small className="muted">{time(e.ts)}</small></div>):<p className="muted small">No recent recorded errors.</p>}
        </details>
        <details className="monitor-details"><summary>Recent API and agent calls</summary>{data.events.map((e,i)=><div className="monitor-breakdown" key={i}><span>{e.category}: {e.action}{e.detail?' · '+e.detail:''}</span><small>{time(e.ts)}</small></div>)}</details>
      </div>
    </>}
  </section>;
}
