// Owner-only aggregated activity. Never log prompts, memory contents, or API keys.
// Raw events are kept briefly for the recent list; grouped tables keep the charts
// cheap. The longest range is seven days, so the dashboard never scans deep history.
const LIMIT = 240;
const HOUR = 3600000;
const DAY = 86400000;

const utcDay = (ts) => new Date(ts).toISOString().slice(0, 10);
const utcHour = (ts) => Math.floor(ts / HOUR) * HOUR;

// Every event also updates three small rollup tables (per day, per hour, and the
// weekday/hour heat grid). The dashboard reads grouped rows, not raw events.
export async function activity(env, {service='',category,action,detail='',provider='',model='',tin=0,tout=0,ok=true,code='',message=''}) {
  const ts = Date.now();
  const c = String(category).slice(0, 40), a = String(action).slice(0, 110);
  const nIn = Number(tin) || 0, nOut = Number(tout) || 0, errors = ok ? 0 : 1;
  const day = utcDay(ts), hour = utcHour(ts);
  const weekday = String(new Date(ts).getUTCDay()), hourOfDay = String(new Date(ts).getUTCHours()).padStart(2, "0");
  await env.DB.batch([
    env.DB.prepare('INSERT INTO activity_events (ts,service_id,category,action,detail,provider,model,tokens_in,tokens_out,ok,error_code,error_message) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(ts,String(service).slice(0,64),c,a,String(detail).slice(0,LIMIT),String(provider).slice(0,60),String(model).slice(0,120),nIn,nOut,ok?1:0,String(code).slice(0,60),String(message).slice(0,LIMIT)),
    env.DB.prepare('INSERT INTO activity_daily (day,category,action,n,tin,tout,errors) VALUES (?,?,?,1,?,?,?) ON CONFLICT(day,category,action) DO UPDATE SET n=n+1,tin=tin+excluded.tin,tout=tout+excluded.tout,errors=errors+excluded.errors')
      .bind(day,c,a,nIn,nOut,errors),
    env.DB.prepare('INSERT INTO activity_hourly (hour,category,action,n,tin,tout,errors) VALUES (?,?,?,1,?,?,?) ON CONFLICT(hour,category,action) DO UPDATE SET n=n+1,tin=tin+excluded.tin,tout=tout+excluded.tout,errors=errors+excluded.errors')
      .bind(hour,c,a,nIn,nOut,errors),
    env.DB.prepare('INSERT INTO activity_heat (day,weekday,hour,n) VALUES (?,?,?,1) ON CONFLICT(day,weekday,hour) DO UPDATE SET n=n+1')
      .bind(day,weekday,hourOfDay),
  ]);
}

// Nothing older than seven days is kept: raw events (including recorded errors) are
// needed only for the recent list, and grouped rows cover the charts.
export async function pruneActivity(env, days = 7) {
  const cutoff = Date.now() - days * DAY;
  const day = utcDay(cutoff), hour = utcHour(cutoff);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM activity_events WHERE ts < ?').bind(cutoff),
    env.DB.prepare('DELETE FROM activity_daily WHERE day <= ?').bind(day),
    env.DB.prepare('DELETE FROM activity_hourly WHERE hour < ?').bind(hour),
    env.DB.prepare('DELETE FROM activity_heat WHERE day <= ?').bind(day),
  ]);
}

// One-time migration: turn the old raw log into grouped rows. Buckets for the current
// day/hour are skipped so a live event cannot race with the backfill; inserts replace
// (not add), which makes a retried backfill safe.
export async function backfillActivityRollups(env) {
  const now = Date.now();
  const today = utcDay(now), todayStart = Date.parse(today + 'T00:00:00Z'), hourStart = utcHour(now);
  await env.DB.batch([
    env.DB.prepare("INSERT OR REPLACE INTO activity_daily (day,category,action,n,tin,tout,errors) SELECT strftime('%Y-%m-%d',ts/1000,'unixepoch'),category,action,COUNT(*),SUM(tokens_in),SUM(tokens_out),SUM(CASE WHEN ok=0 THEN 1 ELSE 0 END) FROM activity_events WHERE ts < ? GROUP BY 1,2,3").bind(todayStart),
    env.DB.prepare('INSERT OR REPLACE INTO activity_hourly (hour,category,action,n,tin,tout,errors) SELECT CAST(ts / ? AS INTEGER) * ?,category,action,COUNT(*),SUM(tokens_in),SUM(tokens_out),SUM(CASE WHEN ok=0 THEN 1 ELSE 0 END) FROM activity_events WHERE ts < ? GROUP BY 1,2,3').bind(HOUR,HOUR,hourStart),
    env.DB.prepare("INSERT OR REPLACE INTO activity_heat (day,weekday,hour,n) SELECT strftime('%Y-%m-%d',ts/1000,'unixepoch'),strftime('%w',ts/1000,'unixepoch'),strftime('%H',ts/1000,'unixepoch'),COUNT(*) FROM activity_events WHERE ts < ? GROUP BY 1,2,3").bind(todayStart),
  ]);
}

const PERIODS = {
  '1h': {duration:3600000,step:300000,label:'1 hour'},
  '1d': {duration:86400000,step:3600000,label:'1 day'},
  '7': {duration:7*86400000,step:86400000,label:'7 days'},
};
export async function monitor(env,period='7') {
  const key=String(period??'7');
  const {duration,step,label}=PERIODS[key]||PERIODS['7'];
  const start=Date.now()-duration;
  const events=(await env.DB.prepare('SELECT category,action,detail,provider,model,tokens_in,tokens_out,ok,error_code,error_message,ts,service_id FROM activity_events WHERE ts >= ? ORDER BY id DESC LIMIT 75').bind(start).all()).results;
  // Pick the smallest aggregate table that still answers the selected period.
  // 1h keeps five-minute detail; 1d uses hourly rows; the week uses daily rows.
  let rows, heatRows=null;
  if(key==='1h'){
    rows=(await env.DB.prepare('SELECT CAST(ts / ? AS INTEGER) * ? bucket,category,action,COUNT(*) n,SUM(tokens_in) tin,SUM(tokens_out) tout,SUM(CASE WHEN ok=0 THEN 1 ELSE 0 END) errors FROM activity_events WHERE ts >= ? GROUP BY bucket,category,action ORDER BY bucket').bind(step,step,start).all()).results;
  }else if(key==='1d'){
    rows=(await env.DB.prepare('SELECT hour AS bucket,category,action,n,tin,tout,errors FROM activity_hourly WHERE hour >= ? ORDER BY hour').bind(start).all()).results;
  }else{
    rows=(await env.DB.prepare('SELECT day AS bucket,category,action,n,tin,tout,errors FROM activity_daily WHERE day >= ? ORDER BY day').bind(utcDay(start)).all()).results;
    // The week view needs only the hour-of-day distribution: one grouped row per active hour.
    heatRows=(await env.DB.prepare('SELECT weekday,hour,SUM(n) n FROM activity_heat WHERE day >= ? GROUP BY weekday,hour').bind(utcDay(start)).all()).results;
  }
  const series=[], totalsMap=new Map(), dailyMap=new Map(), hourlyMap=new Map();
  for(const r of rows){
    const bucket=typeof r.bucket==='string'?Date.parse(r.bucket+'T00:00:00Z'):Number(r.bucket);
    const n=Number(r.n)||0, tin=Number(r.tin)||0, tout=Number(r.tout)||0, errors=Number(r.errors)||0;
    series.push({bucket,category:r.category,action:r.action,n,tin,tout,errors});
    const tk=r.category+'\u0000'+r.action;
    const t=totalsMap.get(tk)||{category:r.category,action:r.action,n:0,tin:0,tout:0,errors:0};
    t.n+=n;t.tin+=tin;t.tout+=tout;t.errors+=errors;totalsMap.set(tk,t);
    const dk=utcDay(bucket)+'\u0000'+r.category;
    const d=dailyMap.get(dk)||{day:utcDay(bucket),category:r.category,n:0,tin:0,tout:0};
    d.n+=n;d.tin+=tin;d.tout+=tout;dailyMap.set(dk,d);
    if(!heatRows){
      const wd=String(new Date(bucket).getUTCDay()), hh=String(new Date(bucket).getUTCHours()).padStart(2,'0');
      const hk=wd+'\u0000'+hh;
      const h=hourlyMap.get(hk)||{weekday:wd,hour:hh,n:0};
      h.n+=n;hourlyMap.set(hk,h);
    }
  }
  const totals=[...totalsMap.values()].sort((a,b)=>b.n-a.n);
  const daily=[...dailyMap.values()].sort((a,b)=>a.day<b.day?-1:a.day>b.day?1:0);
  const hourly=heatRows||[...hourlyMap.values()];
  const jobs=(await env.DB.prepare("SELECT d.id,d.service_id,COALESCE(s.name,'Dashboard') agent,d.task_summary,d.state,d.provider,d.model,d.kind,d.tokens_in,d.tokens_out,d.ms,d.ok,d.error,d.ts FROM delegations d LEFT JOIN services s ON s.id=d.service_id ORDER BY CASE WHEN d.state='running' THEN 0 ELSE 1 END, d.id DESC LIMIT 40").all()).results;
  const activeCount=await env.DB.prepare("SELECT COUNT(*) n FROM delegations WHERE state='running'").first();
  const recentErrors=events.filter(e=>!e.ok);
  return {period:key in PERIODS?key:'7',label,step,start,series,totals,daily,hourly,events:events.slice(0,35),errors:recentErrors.slice(0,15),jobs,
    counts:{requests:totals.reduce((n,x)=>n+Number(x.n),0),tokens_in:totals.filter(x=>x.category==='provider').reduce((n,x)=>n+Number(x.tin),0),tokens_out:totals.filter(x=>x.category==='provider').reduce((n,x)=>n+Number(x.tout),0),skills:totals.filter(x=>x.category==='skill').reduce((n,x)=>n+Number(x.n),0),delegations:totals.filter(x=>x.category==='mcp'&&x.action==='delegate').reduce((n,x)=>n+Number(x.n),0),active:activeCount.n}};
}
