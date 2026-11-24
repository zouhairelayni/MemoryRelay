// Sanitized, owner-only diagnostics. Deliberately never serialize request bodies,
// memory text, credentials, raw exception messages, or stacks.
import { activity } from './monitor.js';

const SAFE_CATEGORIES = new Set(['mcp','api','provider','skill','client','worker','system']);
const PERIOD_MS = Object.freeze({ '1h': 3600000, '1d': 86400000, '7': 604800000 });
const SCREENS = new Set(['home','memory','skills','agents','keys','settings','errors']);
const EVENTS = Object.freeze({ error:'CLIENT_JS_ERROR', unhandledrejection:'CLIENT_UNHANDLED_REJECTION' });

function wholeNumber(input, fallback, max) {
  if (input === undefined || input === null || input === '') return fallback;
  const parsed = Number(input);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? Math.min(parsed,max) : fallback;
}
function categoryOf(value) {
  return SAFE_CATEGORIES.has(String(value || '')) ? String(value) : '';
}
function codeOf(value) {
  const code = String(value || '').toUpperCase();
  return /^[A-Z][A-Z0-9_]{0,47}$/.test(code) ? code : 'UNKNOWN';
}
function safeAction(row) {
  const original = String(row.action || '');
  // Never return dynamic API route segments, query strings, or bearer tokens.
  if (row.category === 'api') {
    const match = /^(GET|POST|PUT|PATCH|DELETE) \/(api|auth)\/([a-z-]{1,32})/i.exec(original);
    return match ? `${match[1].toUpperCase()} /${match[2].toLowerCase()}/${match[3].toLowerCase()}` : 'API request';
  }
  if (row.category === 'client') {
    const screen = SCREENS.has(original.split(' ')[0]) ? original.split(' ')[0] : 'other';
    return `${screen} screen`;
  }
  return /^[a-zA-Z][a-zA-Z0-9_:-]{0,53}$/.test(original) ? original : 'operation';
}
const SUMMARY = Object.freeze({
  CLIENT_JS_ERROR: 'Browser script error', CLIENT_UNHANDLED_REJECTION: 'Unhandled browser operation',
  WORKER_UNHANDLED: 'Unexpected server exception', TOOL_FAILED:'MCP tool failed',
  TOOL_REJECTED:'MCP tool rejected an operation',UPSTREAM_ERROR:'Upstream provider failed',
});
function safeSummary(code) {
  if (SUMMARY[code]) return SUMMARY[code];
  const http = /^HTTP_(\d{3})$/.exec(code);
  return http ? `HTTP ${http[1]} request failed` : 'Recorded operation failed';
}
export function diagnosticView(row) {
  const code = codeOf(row.error_code);
  return {
    id: Number(row.id), ts: Number(row.ts), category: categoryOf(row.category) || 'system',
    action: safeAction(row), code, summary: safeSummary(code),
  };
}
function filters(opts={}) {
  const period = Object.hasOwn(PERIOD_MS,String(opts.period)) ? String(opts.period) : '7';
  const category = categoryOf(opts.category);
  const code = opts.code && /^[A-Z][A-Z0-9_]{0,47}$/.test(String(opts.code)) ? String(opts.code) : '';
  const limit = Math.max(1,wholeNumber(opts.limit,50,100));
  const offset = wholeNumber(opts.offset,0,1000000);
  const clause = ['ok = 0','ts >= ?'];
  const params = [Date.now()-PERIOD_MS[period]];
  if(category){clause.push('category = ?');params.push(category);}
  if(code){clause.push('error_code = ?');params.push(code);}
  return {period,category,code,limit,offset,where:clause.join(' AND '),params};
}
export async function listErrors(env, opts={}) {
  const f=filters(opts);
  const total=await env.DB.prepare(`SELECT COUNT(*) AS n FROM activity_events WHERE ${f.where}`).bind(...f.params).first();
  const rows=await env.DB.prepare(`SELECT id,ts,category,action,error_code FROM activity_events WHERE ${f.where} ORDER BY id DESC LIMIT ? OFFSET ?`).bind(...f.params,f.limit,f.offset).all();
  const count=Number(total?.n)||0;
  return {total:count,limit:f.limit,offset:f.offset,next_offset:f.offset+rows.results.length<count?f.offset+rows.results.length:null,
    period:f.period,category:f.category,code:f.code,retention_days:7,
    diagnostics:rows.results.map(diagnosticView)};
}
export async function recordClientError(env,input) {
  const type=String(input?.type||'');
  if(!Object.hasOwn(EVENTS,type))return {error:'unsupported diagnostic type'};
  const screen=SCREENS.has(input.screen)?input.screen:'other';
  // No user-supplied messages are read or stored.
  await activity(env,{category:'client',action:`${screen} ${type}`,ok:false,code:EVENTS[type]});
  return {recorded:true};
}
export async function recordUnexpectedError(env) {
  await activity(env,{category:'worker',action:'handler',ok:false,code:'WORKER_UNHANDLED'});
}
