import {useEffect,useMemo,useState} from 'react';
import {monitoring} from '../../api/endpoints.js';
import ActivityChart from './ActivityChart.jsx';
import MetricDropdown from './MetricDropdown.jsx';
import { colorForMetric } from './metricColors.js';
import { useApp } from '../../shell/AppContext.js';
import Icon from '../../components/Icon.jsx';

const fmt=n=>Intl.NumberFormat().format(Number(n)||0);
const time=ts=>new Date(ts).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
const humanizeFunction=(category,action)=>{
  const a=String(action||'').toLowerCase().replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim();
  const known={'connector test':'Test connection','connector status':'Check connection status','memory list':'Read memories','memory search':'Search memories','memory get':'Read a memory','memory remember':'Save memory','memory update':'Update memory','memory forget':'Delete memory','skill list':'List skills','skill select':'Select skills','skill sync':'Sync skills','github sync':'Sync repository','provider call':'Call AI provider','monitor get':'Load usage analytics'};
  if(known[a])return known[a];
  const route=String(action||'').replace(/^(GET|POST|PUT|PATCH|DELETE)\s+/i,'').split(/[?#]/)[0].replace(/:[a-z]+/gi,':id');
  const routeLabels={'/api/connector/test':'Test agent connection','/api/services':'Manage agent connections','/api/memories':'Manage memories','/api/memory-settings':'Configure memory limits','/api/skills':'Manage skills','/api/skill-repos':'Manage skill repositories','/api/monitor':'Load usage analytics','/api/errors':'View diagnostics','/api/settings':'Load workspace settings','/api/gemini':'Configure Gemini','/api/openrouter':'Configure OpenRouter','/api/openai':'Configure OpenAI','/api/nvidia':'Configure NVIDIA','/api/export':'Export workspace data','/api/import':'Import workspace data','/api/delegation':'Configure sub-agents'};
  if(routeLabels[route])return routeLabels[route];
  const clean=a.replace(/\b(api|mcp|http|post|get|put|patch|delete)\b/g,'').trim();
  const words=clean.split(' ').filter(Boolean).map(w=>w.charAt(0).toUpperCase()+w.slice(1));
  const categoryLabel=({api:'Dashboard',mcp:'Agent tool',provider:'AI provider',skill:'Skill',client:'App',worker:'Server',system:'System'})[category]||'Operation';
  return words.length?`${categoryLabel}: ${words.join(' ')}`:categoryLabel;
};
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
  const { go } = useApp();
  const [period,setPeriod]=useState('7'),[metric,setMetric]=useState('mcp'),[data,setData]=useState(null),[error,setError]=useState(''),[reload,setReload]=useState(0);
  useEffect(()=>{if(!active)return;let alive=true;setData(null);
    // This endpoint aggregates activity rows, so it is the most expensive poll in the
    // app. Poll once a minute, and never from a hidden tab: background tabs used to
    // keep re-scanning the log all day and could exhaust the D1 daily read limit.
    const load=()=>{if(document.visibilityState!=="visible")return;monitoring.get(period).then(d=>{if(alive){setData(d);setError('');}}).catch(e=>{if(alive)setError(e.message)})};
    load();const id=setInterval(load,60000);
    const wake=()=>{if(document.visibilityState==="visible")load();};
    document.addEventListener("visibilitychange",wake);
    return()=>{alive=false;clearInterval(id);document.removeEventListener("visibilitychange",wake)};
  },[active,period,reload]);
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
  const primaryMetrics=useMemo(()=>["mcp","tokens","skill","errors"].map(id=>totals.find(x=>x.id===id)).filter(Boolean),[totals]);
  const supportingMetrics=useMemo(()=>totals.filter(x=>!["mcp","tokens","skill","errors"].includes(x.id)),[totals]);
  const metricCard=({id,label,count})=>id === 'errors' ? <button key={id} type="button" className={`monitor-metric metric-${id} monitor-metric-action`} title="Open error diagnostics" aria-label={`Open error diagnostics. ${fmt(count)} errors in ${data.label}`} onClick={()=>go('errors')}><span className="monitor-metric-label">{label} <Icon name="chev" size={15}/></span><b>{fmt(count)}</b><span className="monitor-metric-meta">{data.label} · View diagnostics</span></button> : <div key={id} className={`monitor-metric metric-${id}`}><span className="monitor-metric-label">{label}</span><b>{fmt(count)}</b><span className="monitor-metric-meta">{data.label}</span></div>;
  const timeLabels=useMemo(()=>timeline.buckets.map(t=>new Date(t).toLocaleString(undefined,
    period==='1h'||period==='1d'?{hour:'2-digit',minute:'2-digit'}:{month:'short',day:'numeric'})),[timeline.buckets,period]);
  const functionRows=useMemo(()=>(data?.totals||[]).filter(x=>Number(x.n)>0).map(x=>({...x,displayLabel:humanizeFunction(x.category,x.action)})),[data]);
  const topFunctions=useMemo(()=>functionRows.slice(0,8),[functionRows]);
  const functionNames=useMemo(()=>topFunctions.map(x=>x.displayLabel),[topFunctions]);
  const functionCounts=useMemo(()=>topFunctions.map(x=>Number(x.n)),[topFunctions]);
  const plotValues=metric==='all'?timeline.totals:metric.startsWith('fn:')?
    timeline.byAction.get(metric.slice(3))||[]:timeline.byMetric[metric]||[];
  const selectedLabel=metric==='all'?'All recorded events':metric.startsWith('fn:')?
    functionRows.find(x=>`fn:${x.category}:${x.action}`===metric)?.displayLabel||'Function activity':METRICS.find(([id])=>id===metric)?.[1]||'MCP calls';
  return <section className="monitor-root" aria-label="Activity monitoring">
    <div className="monitor-header"><div><span className="dash-eyebrow">PERFORMANCE</span><h3>Usage at a glance</h3><p className="muted small">All figures reflect recorded activity, not billing totals.</p></div></div>
    {error?<div className="monitor-load-error" role="alert"><strong>Activity data is unavailable</strong><span>{error}</span><button type="button" className="btn sm ghost" onClick={()=>setReload(n=>n+1)}>Try again</button></div>:null}
    {!data?<div className="monitor-loading" aria-label="Loading usage data">
      <div className="monitor-metrics">{[0,1,2,3].map(i=><div className="monitor-metric" key={i}><span className="monitor-shimmer monitor-shimmer-label"/><span className="monitor-shimmer monitor-shimmer-number"/><span className="monitor-shimmer monitor-shimmer-foot"/></div>)}</div>
      <div className="monitor-period-row"><span>Time range</span><div className="monitor-period" role="group" aria-label="Activity period">{[["1h","1h"],["1d","24h"],["7","7d"]].map(([value,label])=><button key={value} type="button" className={period===value?"on":""} aria-pressed={period===value} onClick={()=>setPeriod(value)}>{label}</button>)}</div></div>
      <div className="monitor-shimmer monitor-shimmer-graph"/>
    </div>:<>
      <div className="monitor-metrics">
        {primaryMetrics.map(metricCard)}
      </div>
      <div className="monitor-period-row"><span>Time range</span><div className="monitor-period" role="group" aria-label="Activity period">{[["1h","1h"],["1d","24h"],["7","7d"]].map(([value,label])=><button key={value} type="button" className={period===value?"on":""} aria-pressed={period===value} onClick={()=>setPeriod(value)}>{label}</button>)}</div></div>
      <div className="card monitor-figure monitor-figure-primary">
        <div className="monitor-chart-title"><div><span className="dash-eyebrow">ACTIVITY INSIGHTS</span><h4>Activity trend</h4><p className="muted small">{data.label} · Recorded data, not cumulative totals</p></div>
          <MetricDropdown value={metric} onChange={setMetric} metrics={METRICS} functions={functionRows}/>
        </div>
        <div className="monitor-plot-key" style={{"--plot-color":colorForMetric(metric)}}><span className="monitor-plot-swatch"/>{selectedLabel}<span className="monitor-plot-count">{fmt(plotValues.reduce((a,b)=>a+(Number(b)||0),0))}</span></div>
        <ActivityChart type="line" color={colorForMetric(metric)} labels={timeLabels} values={plotValues} label={`${selectedLabel} over ${data.label}`} unit={metric==='tokens'?'tokens':metric==='skill'?'selections':metric==='delegate'?'tasks':metric==='errors'?'errors':'calls'}/>
        {period==='1h'||period==='1d'?null:<><h4>Hourly activity (UTC)</h4><Heat hourly={data.hourly}/></>}
      </div>
      <div className="monitor-supporting"><div className="monitor-secondary-label"><span className="dash-eyebrow">MORE USAGE SIGNALS</span></div><div className="monitor-metrics monitor-metrics-secondary">{supportingMetrics.map(metricCard)}</div></div>
      <div className="card monitor-figure monitor-functions"><div className="monitor-chart-title"><h4>Most used functions</h4><span className="muted small">Top {topFunctions.length} in {data.label}</span></div>
        {topFunctions.length?<ActivityChart type="bar" color={colorForMetric("functions")} labels={functionNames} values={functionCounts} label="Most used functions"/>:<p className="muted small">No functions recorded for this period.</p>}
        <details className="monitor-details"><summary>All recorded functions ({functionRows.length})</summary>
          <div className="monitor-function-list">{functionRows.map(x=><div key={`${x.category}:${x.action}`} className="monitor-breakdown"><span>{x.displayLabel}</span><b>{fmt(x.n)}</b></div>)}</div>
        </details>
      </div>
    </>}
  </section>;
}
