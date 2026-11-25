// O(1) dashboard totals.
//
// A COUNT over a table is a scan: every memory row read once per refresh, even
// though the screen shows one number. These counters are kept by database
// triggers (created in db.js), so a write updates one small row and a refresh
// reads one small row. The triggers cover every code path: dashboard, MCP tools,
// imports, housekeeping and cron.
import { RULES_SQL } from "./util.js";

const DAY = 86400000;
const utcDay = (ts) => new Date(ts).toISOString().slice(0, 10);

// Keep in sync with the trigger list in db.js.
export const COUNTER_KEYS = Object.freeze([
  "memories_total",
  "memories_rules",
  "services_active",
  "api_keys_active",
  "skills_total",
  "skills_pending",
  "delegations_running",
  "errors_total_7d",
]);

// The 7-day error counter is refreshed from the grouped day rows, so it uses the
// same calendar-day window that retention keeps. An error older than this is out.
export const errorWindowStart = () => utcDay(Date.now() - 7 * DAY);

// A single counter, or null when this database predates the counters table.
export async function readCounter(env, key) {
  const row = await env.DB.prepare("SELECT value FROM counters WHERE key = ?").bind(key).first();
  return row ? Number(row.value) || 0 : null;
}

// Several counters in one query.
export async function readCounters(env, keys) {
  const list = [...new Set(keys)];
  if (!list.length) return {};
  const { results } = await env.DB.prepare(
    `SELECT key, value FROM counters WHERE key IN (${list.map(() => "?").join(",")})`
  ).bind(...list).all();
  const out = {};
  for (const key of list) out[key] = null;
  for (const row of results) out[row.key] = Number(row.value) || 0;
  return out;
}

// Counter value, with a one-off COUNT as a safety net for a database that has
// not run the counter migration yet. Normal reads never execute the fallback.
export async function counterOr(env, key, sql, params = []) {
  const value = await readCounter(env, key);
  if (value !== null) return value;
  const row = await env.DB.prepare(sql).bind(...params).first();
  return Number(row?.n) || 0;
}

// Resolve a group of counters in one read, falling back only for missing rows.
export async function resolveCounters(env, spec) {
  const found = await readCounters(env, Object.keys(spec));
  for (const [key, { sql, params = [] }] of Object.entries(spec)) {
    if (found[key] !== null) continue;
    const row = await env.DB.prepare(sql).bind(...params).first();
    found[key] = Number(row?.n) || 0;
  }
  return found;
}

const absolute = (env, key, sql, params = []) =>
  env.DB.prepare(
    `INSERT INTO counters (key, value) VALUES (?, (${sql})) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).bind(key, ...params);

// One-time (per schema version) repair job: make every counter match its source
// table. Also called after a migration that seeds rows without triggers.
export async function recomputeCounters(env) {
  await env.DB.batch([
    absolute(env, "memories_total", "SELECT COUNT(*) FROM memories"),
    absolute(env, "memories_rules", `SELECT COUNT(*) FROM memories WHERE ${RULES_SQL}`),
    absolute(env, "services_active", "SELECT COUNT(*) FROM services WHERE revoked = 0"),
    absolute(
      env,
      "api_keys_active",
      "SELECT (SELECT COUNT(*) FROM gemini_keys WHERE enabled = 1)" +
        " + (SELECT COUNT(*) FROM openrouter_keys WHERE enabled = 1)" +
        " + (SELECT COUNT(*) FROM openai_keys WHERE enabled = 1)" +
        " + (SELECT COUNT(*) FROM nvidia_keys WHERE enabled = 1)"
    ),
    absolute(env, "skills_total", "SELECT COUNT(*) FROM skills"),
    absolute(env, "skills_pending", "SELECT COUNT(*) FROM skills WHERE enabled = 0 AND source LIKE 'agent%'"),
    absolute(env, "delegations_running", "SELECT COUNT(*) FROM delegations WHERE state = 'running'"),
    absolute(env, "errors_total_7d", "SELECT COALESCE(SUM(errors), 0) FROM activity_daily WHERE day > ?", [
      errorWindowStart(),
    ]),
  ]);
}
