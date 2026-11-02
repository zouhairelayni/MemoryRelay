// Owner-only aggregated activity. Never log prompts, memory contents, or API keys.
const LIMIT = 240;
export async function activity(env, {service='',category,action,detail='',provider='',model='',tin=0,tout=0,ok=true,code='',message=''}) {
  await env.DB.prepare('INSERT INTO activity_events (ts,service_id,category,action,detail,provider,model,tokens_in,tokens_out,ok,error_code,error_message) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(Date.now(),String(service).slice(0,64),String(category).slice(0,40),String(action).slice(0,110),String(detail).slice(0,LIMIT),String(provider).slice(0,60),String(model).slice(0,120),Number(tin)||0,Number(tout)||0,ok?1:0,String(code).slice(0,60),String(message).slice(0,LIMIT)).run();
}

const PERIODS = {
  '1h': {duration:3600000,step:300000,label:'1 hour'},
  '1d': {duration:86400000,step:3600000,label:'1 day'},
  '7': {duration:7*86400000,step:86400000,label:'7 days'},
  '30': {duration:30*86400000,step:86400000,label:'30 days'},
  '90': {duration:90*86400000,step:86400000,label:'90 days'},
};
export async function monitor(env,period='30') {
  const key=String(period??'30');
  const {duration,step,label}=PERIODS[key]||PERIODS['30'];
  const start=Date.now()-duration;
  const events=(await env.DB.prepare('SELECT category,action,detail,provider,model,tokens_in,tokens_out,ok,error_code,error_message,ts,service_id FROM activity_events WHERE ts >= ? ORDER BY id DESC LIMIT 75').bind(start).all()).results;
  const daily=(await env.DB.prepare("SELECT strftime('%Y-%m-%d',ts/1000,'unixepoch') day,category,COUNT(*) n,SUM(tokens_in) tin,SUM(tokens_out) tout FROM activity_events WHERE ts >= ? GROUP BY day,category ORDER BY day").bind(start).all()).results;
  const hourly=(await env.DB.prepare("SELECT strftime('%w',ts/1000,'unixepoch') weekday,strftime('%H',ts/1000,'unixepoch') hour,COUNT(*) n FROM activity_events WHERE ts >= ? GROUP BY weekday,hour").bind(start).all()).results;
  const totals=(await env.DB.prepare('SELECT category,action,COUNT(*) n,SUM(tokens_in) tin,SUM(tokens_out) tout,SUM(CASE WHEN ok=0 THEN 1 ELSE 0 END) errors FROM activity_events WHERE ts >= ? GROUP BY category,action ORDER BY n DESC').bind(start).all()).results;
  // One aggregate query provides trends for every logged function, rather than querying each widget separately.
  const series=(await env.DB.prepare('SELECT CAST(ts / ? AS INTEGER) * ? bucket,category,action,COUNT(*) n,SUM(tokens_in) tin,SUM(tokens_out) tout,SUM(CASE WHEN ok=0 THEN 1 ELSE 0 END) errors FROM activity_events WHERE ts >= ? GROUP BY bucket,category,action ORDER BY bucket').bind(step,step,start).all()).results;
  const jobs=(await env.DB.prepare("SELECT d.id,d.service_id,COALESCE(s.name,'Dashboard') agent,d.task_summary,d.state,d.provider,d.model,d.kind,d.tokens_in,d.tokens_out,d.ms,d.ok,d.error,d.ts FROM delegations d LEFT JOIN services s ON s.id=d.service_id ORDER BY CASE WHEN d.state='running' THEN 0 ELSE 1 END, d.id DESC LIMIT 40").all()).results;
  const activeCount=await env.DB.prepare("SELECT COUNT(*) n FROM delegations WHERE state='running'").first();
  const recentErrors=events.filter(e=>!e.ok);
  return {period:key in PERIODS?key:'30',label,step,start,series,totals,daily,hourly,events:events.slice(0,35),errors:recentErrors.slice(0,15),jobs,
    counts:{requests:totals.reduce((n,x)=>n+Number(x.n),0),tokens_in:totals.filter(x=>x.category==='provider').reduce((n,x)=>n+Number(x.tin),0),tokens_out:totals.filter(x=>x.category==='provider').reduce((n,x)=>n+Number(x.tout),0),skills:totals.filter(x=>x.category==='skill').reduce((n,x)=>n+Number(x.n),0),delegations:totals.filter(x=>x.category==='mcp'&&x.action==='delegate').reduce((n,x)=>n+Number(x.n),0),active:activeCount.n}};
}
