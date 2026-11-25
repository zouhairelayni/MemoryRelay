// D1 access helpers and the one-time schema check.
import { FALLBACK_MODELS } from "./constants.js";
import { COUNTER_KEYS, recomputeCounters } from "./counters.js";
import { backfillActivityRollups } from "./monitor.js";
import { newId, now, randomHex, runAll } from "./util.js";

export async function getConfig(env, key) {
  const row = await env.DB.prepare("SELECT value FROM config WHERE key = ?").bind(key).first();
  return row ? row.value : null;
}

export async function setConfig(env, key, value) {
  await env.DB.prepare(
    "INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).bind(key, value).run();
}

// Schema check runs once per Worker instance. It creates the services table and,
// on first run, a default "Claude" service that keeps your current connector address.
// It also creates the Gemini key/model pool and migrates the old single key and model.
let schemaReady = false;
// Bump this whenever a table, column or index below is added or changed. Once the
// marker is stored, a cold Worker instance costs ONE small indexed read instead of
// re-running the whole ~40-statement migration on every cold start and every cron
// tick. That migration was responsible for tens of thousands of D1 queries a day.
const SCHEMA_VERSION = "2026-11-24.5";
// Tests create a fresh database per case, so they need to reset the once-per-instance flag.
export const resetSchemaCache = () => { schemaReady = false; };
export async function ensureSchema(env) {
  if (schemaReady) return;
  // Fast path for an already migrated database. A fresh database has no config
  // table yet, so the error is expected and the full migration below creates it.
  try {
    const marker = await env.DB.prepare("SELECT value FROM config WHERE key = 'schema_version'").first();
    if (marker && marker.value === SCHEMA_VERSION) { schemaReady = true; return; }
  } catch { /* first run: no config table yet */ }
  // Core tables (no-ops when they already exist, so a fresh database also works).
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL, salt TEXT NOT NULL, created TEXT NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS login_fails (key TEXT PRIMARY KEY, fails INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires INTEGER NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS openrouter_keys (id TEXT PRIMARY KEY, label TEXT NOT NULL, key TEXT NOT NULL UNIQUE, enabled INTEGER NOT NULL DEFAULT 1, created TEXT NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS openrouter_models (name TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1, pos INTEGER NOT NULL DEFAULT 0)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS openrouter_cooldowns (key_id TEXT NOT NULL, model TEXT NOT NULL, until INTEGER NOT NULL, PRIMARY KEY (key_id, model))"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS skills (name TEXT PRIMARY KEY, description TEXT NOT NULL, body TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, core INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL DEFAULT '', created TEXT NOT NULL, updated TEXT NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS skill_scripts (name TEXT PRIMARY KEY, skill TEXT NOT NULL, description TEXT NOT NULL, code TEXT NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS skill_resources (skill TEXT NOT NULL, path TEXT NOT NULL, kind TEXT NOT NULL, content TEXT, url TEXT NOT NULL, PRIMARY KEY (skill, path))"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS skill_repos (id TEXT PRIMARY KEY, owner TEXT NOT NULL, repo TEXT NOT NULL, root TEXT NOT NULL, ref TEXT NOT NULL, names TEXT NOT NULL DEFAULT '[]', enabled INTEGER NOT NULL DEFAULT 0, last_sha TEXT NOT NULL DEFAULT '', last_checked TEXT NOT NULL DEFAULT '', last_error TEXT NOT NULL DEFAULT '')"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS skill_repo_stage (repo_id TEXT NOT NULL, skill TEXT NOT NULL, path TEXT NOT NULL, kind TEXT NOT NULL, content TEXT, url TEXT NOT NULL, PRIMARY KEY (repo_id,skill,path))"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS activity_events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, service_id TEXT NOT NULL DEFAULT '', category TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', provider TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '', tokens_in INTEGER NOT NULL DEFAULT 0, tokens_out INTEGER NOT NULL DEFAULT 0, ok INTEGER NOT NULL DEFAULT 1, error_code TEXT NOT NULL DEFAULT '', error_message TEXT NOT NULL DEFAULT '')"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_activity_ts ON activity_events (ts)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_activity_cat ON activity_events (category, action, detail)"), // one-time skill-usage backfill
    // Grouped activity: the home screen reads these instead of scanning every raw event.
    env.DB.prepare("CREATE TABLE IF NOT EXISTS activity_daily (day TEXT NOT NULL, category TEXT NOT NULL, action TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, tin INTEGER NOT NULL DEFAULT 0, tout INTEGER NOT NULL DEFAULT 0, errors INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, category, action))"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_activity_daily_day ON activity_daily (day)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS activity_hourly (hour INTEGER NOT NULL, category TEXT NOT NULL, action TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, tin INTEGER NOT NULL DEFAULT 0, tout INTEGER NOT NULL DEFAULT 0, errors INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (hour, category, action))"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_activity_hourly_hour ON activity_hourly (hour)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS activity_heat (day TEXT NOT NULL, weekday TEXT NOT NULL, hour TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, weekday, hour))"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_activity_heat_day ON activity_heat (day)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS memories (id TEXT PRIMARY KEY, text TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT '', created TEXT NOT NULL, updated TEXT NOT NULL, history TEXT NOT NULL DEFAULT '[]')"),
    // Dashboard totals. Triggers below keep these in step with their tables, so a
    // refresh reads a few rows instead of counting every memory, skill or error.
    env.DB.prepare("CREATE TABLE IF NOT EXISTS counters (key TEXT PRIMARY KEY, value INTEGER NOT NULL DEFAULT 0)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS skill_uses (skill TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0)"),
  ]);
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS services (id TEXT PRIMARY KEY, name TEXT NOT NULL, secret TEXT NOT NULL UNIQUE, created TEXT NOT NULL, last_seen TEXT NOT NULL DEFAULT '', revoked INTEGER NOT NULL DEFAULT 0)"
  ).run();
  // Seed the default service only once, so deleting every service never brings one back.
  if (!(await getConfig(env, "services_seeded"))) {
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM services").first();
    if (!count.n) {
      const legacy = await getConfig(env, "connector_secret");
      await env.DB.prepare("INSERT INTO services (id, name, secret, created) VALUES (?, ?, ?, ?)")
        .bind(newId(), "Claude", legacy || randomHex(24), now()).run();
    }
    await setConfig(env, "services_seeded", "1");
  }

  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, n INTEGER NOT NULL, expires INTEGER NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS skill_history (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, text TEXT NOT NULL, saved TEXT NOT NULL, by TEXT NOT NULL DEFAULT '')"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_skill_history_name ON skill_history (name, id)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_memories_created ON memories (created)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS oauth_clients (id TEXT PRIMARY KEY, name TEXT NOT NULL, redirect_uris TEXT NOT NULL, secret_hash TEXT NOT NULL DEFAULT '', created TEXT NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS oauth_codes (code_hash TEXT PRIMARY KEY, client_id TEXT NOT NULL, service_id TEXT NOT NULL, redirect_uri TEXT NOT NULL, challenge TEXT NOT NULL, expires INTEGER NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS oauth_tokens (token_hash TEXT PRIMARY KEY, kind TEXT NOT NULL, client_id TEXT NOT NULL, service_id TEXT NOT NULL, family TEXT NOT NULL, expires INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_oauth_tokens_service ON oauth_tokens (service_id, family)"),
    // OpenAI and NVIDIA key/model pools (same shape as the OpenRouter ones)
    ...["openai", "nvidia"].flatMap((p) => [
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS ${p}_keys (id TEXT PRIMARY KEY, label TEXT NOT NULL, key TEXT NOT NULL UNIQUE, enabled INTEGER NOT NULL DEFAULT 1, created TEXT NOT NULL)`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS ${p}_models (name TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1, pos INTEGER NOT NULL DEFAULT 0)`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS ${p}_cooldowns (key_id TEXT NOT NULL, model TEXT NOT NULL, until INTEGER NOT NULL, PRIMARY KEY (key_id, model))`),
    ]),
    // Sub-agent calls: what was asked of which provider and how big, never the text itself.
    env.DB.prepare("CREATE TABLE IF NOT EXISTS delegations (id INTEGER PRIMARY KEY AUTOINCREMENT, service_id TEXT NOT NULL, provider TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT '', tokens_in INTEGER NOT NULL DEFAULT 0, tokens_out INTEGER NOT NULL DEFAULT 0, ms INTEGER NOT NULL DEFAULT 0, ok INTEGER NOT NULL DEFAULT 0, error TEXT NOT NULL DEFAULT '', ts INTEGER NOT NULL)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_delegations_ts ON delegations (ts)"),
  ]);
  // Columns added after the first release. Older databases get them here; "already exists" from a racing instance is fine.
  // Non-destructive, idempotent migration: source text and context tags remain untouched.
  const memoryColumns = new Set((await env.DB.prepare("SELECT name FROM pragma_table_info('memories')").all()).results.map((c) => c.name));
  for (const [key, ddl] of [
    ["description", "description TEXT NOT NULL DEFAULT ''"],
    ["metadata", "metadata TEXT NOT NULL DEFAULT '{\"app\":\"\",\"platforms\":[],\"feature\":\"\",\"version\":\"\",\"languages\":[],\"stack\":[]}'"],
  ]) {
    if (memoryColumns.has(key)) continue;
    try { await env.DB.prepare("ALTER TABLE memories ADD COLUMN " + ddl).run(); }
    catch (e) { if (!/duplicate column/i.test(String(e))) throw e; }
  }
  const have = new Set((await env.DB.prepare("SELECT name FROM pragma_table_info('services')").all()).results.map((c) => c.name));
  for (const [col, ddl] of [
    ["access", "access TEXT NOT NULL DEFAULT 'full'"],   // read / write / full (older connections keep full)
    ["oauth_key", "oauth_key TEXT NOT NULL DEFAULT ''"], // which app signed in with OAuth, to recognise a reconnect
  ]) {
    if (have.has(col)) continue;
    try { await env.DB.prepare("ALTER TABLE services ADD COLUMN " + ddl).run(); }
    catch (e) { if (!/duplicate column/i.test(String(e && e.message))) throw e; }
  }
  const delegationCols=new Set((await env.DB.prepare("SELECT name FROM pragma_table_info('delegations')").all()).results.map(r=>r.name));
  for(const [col,ddl] of [['state',"state TEXT NOT NULL DEFAULT 'completed'"],['task_summary',"task_summary TEXT NOT NULL DEFAULT ''"]])
    if(!delegationCols.has(col))try{await env.DB.prepare('ALTER TABLE delegations ADD COLUMN '+ddl).run();}catch(e){if(!/duplicate column/i.test(String(e))){throw e;}}
  const repoCols = new Set((await env.DB.prepare("SELECT name FROM pragma_table_info('skill_repos')").all()).results.map(r=>r.name));
  for (const [key,ddl] of [
    ['sync_sha',"sync_sha TEXT NOT NULL DEFAULT ''"], ['sync_todo',"sync_todo TEXT NOT NULL DEFAULT ''"],
    ['sync_done',"sync_done INTEGER NOT NULL DEFAULT 0"], ['sync_total',"sync_total INTEGER NOT NULL DEFAULT 0"],
    ['sync_status',"sync_status TEXT NOT NULL DEFAULT ''"],
    ['etag',"etag TEXT NOT NULL DEFAULT ''"],            // ETag of the last fully synced commit (304 replies do not use GitHub quota)
    ['sync_etag',"sync_etag TEXT NOT NULL DEFAULT ''"],
    ['sync_note',"sync_note TEXT NOT NULL DEFAULT ''"],  // skipped / held back skills from the last sync, shown to the owner
    ['sync_manual',"sync_manual INTEGER NOT NULL DEFAULT 0"],
    ['sync_lock',"sync_lock INTEGER NOT NULL DEFAULT 0"], // lease so cron and the dashboard never run one repo at the same time
    ['file_types',"file_types TEXT NOT NULL DEFAULT '[\"script\",\"test\"]'"], // which kinds of files besides SKILL.md are imported
    ['path_filter',"path_filter TEXT NOT NULL DEFAULT ''"],   // glob include/exclude lines, relative to each skill folder
    ['max_kb',"max_kb INTEGER NOT NULL DEFAULT 750"],         // largest single file imported
    ['adopt',"adopt INTEGER NOT NULL DEFAULT 0"],             // let this repo take over pasted skills with the same name
    ['sync_summary',"sync_summary TEXT NOT NULL DEFAULT ''"], // outcome being collected while a sync runs
    ['last_summary',"last_summary TEXT NOT NULL DEFAULT ''"],  // outcome of the last finished sync, shown in the app
    ['excluded_files',"excluded_files TEXT NOT NULL DEFAULT '[]'"], // "skill/path" entries the owner removed; later syncs leave them out
    ['update_mode',"update_mode TEXT NOT NULL DEFAULT 'safe'"],      // unattended updates: safe = hold risky changes, review = hold every change, all = apply everything
    ['skill_map',"skill_map TEXT NOT NULL DEFAULT '{}'"],            // folder in the repository -> the skill name its SKILL.md declares
    ['detect_v',"detect_v INTEGER NOT NULL DEFAULT 1"]               // marks repos created or re-checked since skill folders are found automatically
  ]) if(!repoCols.has(key)) {
    try { await env.DB.prepare('ALTER TABLE skill_repos ADD COLUMN '+ddl).run(); }
    catch(e) {if(!/duplicate column/i.test(String(e)))throw e;}
  }
  // Repos added before folders were detected automatically may have found nothing in "skills/": look at them again once.
  if (repoCols.size && !repoCols.has('detect_v')) await env.DB.prepare("UPDATE skill_repos SET last_sha='', etag='', last_checked='' WHERE sync_status <> 'running'").run();
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS gemini_keys (id TEXT PRIMARY KEY, label TEXT NOT NULL, key TEXT NOT NULL UNIQUE, enabled INTEGER NOT NULL DEFAULT 1, created TEXT NOT NULL)"
  ).run();
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS gemini_models (name TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1, pos INTEGER NOT NULL DEFAULT 0)"
  ).run();
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS gemini_cooldowns (key_id TEXT NOT NULL, model TEXT NOT NULL, until INTEGER NOT NULL, PRIMARY KEY (key_id, model))"
  ).run();

  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS service_stats (service_id TEXT PRIMARY KEY, requests INTEGER NOT NULL DEFAULT 0, n_read INTEGER NOT NULL DEFAULT 0, n_write INTEGER NOT NULL DEFAULT 0, n_delete INTEGER NOT NULL DEFAULT 0, bytes_in INTEGER NOT NULL DEFAULT 0, bytes_out INTEGER NOT NULL DEFAULT 0, last TEXT NOT NULL DEFAULT '', app TEXT NOT NULL DEFAULT '')"
  ).run();

  const kc = await env.DB.prepare("SELECT COUNT(*) AS n FROM gemini_keys").first();
  if (!kc.n) {
    const old = await getConfig(env, "gemini_key");
    if (old) {
      await env.DB.prepare("INSERT INTO gemini_keys (id, label, key, created) VALUES (?, ?, ?, ?)")
        .bind(newId(), "main", old, now()).run();
    }
  }
  const mc = await env.DB.prepare("SELECT COUNT(*) AS n FROM gemini_models").first();
  if (!mc.n) {
    const seed = [...new Set([await getConfig(env, "gemini_model"), ...FALLBACK_MODELS].filter(Boolean))];
    await runAll(env, seed.map((name, i) =>
      env.DB.prepare("INSERT OR IGNORE INTO gemini_models (name, enabled, pos) VALUES (?, 1, ?)").bind(name, i)));
  }
  // ---- O(1) counters -------------------------------------------------------
  // One row per number. Triggers update the row on every insert/delete/toggle, so
  // the dashboard never scans a whole table to display a total. The definitions
  // must stay in sync with worker/counters.js (COUNTER_KEYS).
  await env.DB.prepare(
    `INSERT OR IGNORE INTO counters (key, value) VALUES ${COUNTER_KEYS.map(() => "(?, 0)").join(", ")}`
  ).bind(...COUNTER_KEYS).run();
  const ruleOf = (row) => `(',' || REPLACE(LOWER(${row}.tags), ' ', '') || ',') LIKE '%,rules,%'`;
  const pendingSkill = (row) => `${row}.enabled = 0 AND ${row}.source LIKE 'agent%'`;
  await env.DB.batch([
    // Memories: total always, rules only for rules-tagged rows (tag edits adjust the difference).
    ...[
      `CREATE TRIGGER IF NOT EXISTS trg_counters_memories_insert AFTER INSERT ON memories BEGIN
         UPDATE counters SET value = value + 1 WHERE key = 'memories_total';
         UPDATE counters SET value = value + 1 WHERE key = 'memories_rules' AND ${ruleOf("NEW")};
       END`,
      `CREATE TRIGGER IF NOT EXISTS trg_counters_memories_delete AFTER DELETE ON memories BEGIN
         UPDATE counters SET value = value - 1 WHERE key = 'memories_total';
         UPDATE counters SET value = value - 1 WHERE key = 'memories_rules' AND ${ruleOf("OLD")};
       END`,
      `CREATE TRIGGER IF NOT EXISTS trg_counters_memories_tags AFTER UPDATE OF tags ON memories BEGIN
         UPDATE counters SET value = value
           + (CASE WHEN ${ruleOf("NEW")} THEN 1 ELSE 0 END)
           - (CASE WHEN ${ruleOf("OLD")} THEN 1 ELSE 0 END)
         WHERE key = 'memories_rules';
       END`,
    ].map((sql) => env.DB.prepare(sql)),
    // Active connections (revoked = 0).
    ...[
      `CREATE TRIGGER IF NOT EXISTS trg_counters_services_insert AFTER INSERT ON services BEGIN
         UPDATE counters SET value = value + 1 WHERE key = 'services_active' AND NEW.revoked = 0;
       END`,
      `CREATE TRIGGER IF NOT EXISTS trg_counters_services_delete AFTER DELETE ON services BEGIN
         UPDATE counters SET value = value - 1 WHERE key = 'services_active' AND OLD.revoked = 0;
       END`,
      `CREATE TRIGGER IF NOT EXISTS trg_counters_services_revoked AFTER UPDATE OF revoked ON services BEGIN
         UPDATE counters SET value = value
           + (CASE WHEN NEW.revoked = 0 THEN 1 ELSE 0 END)
           - (CASE WHEN OLD.revoked = 0 THEN 1 ELSE 0 END)
         WHERE key = 'services_active';
       END`,
    ].map((sql) => env.DB.prepare(sql)),
    // Skills: total and agent uploads waiting for the owner.
    ...[
      `CREATE TRIGGER IF NOT EXISTS trg_counters_skills_insert AFTER INSERT ON skills BEGIN
         UPDATE counters SET value = value + 1 WHERE key = 'skills_total';
         UPDATE counters SET value = value + 1 WHERE key = 'skills_pending' AND ${pendingSkill("NEW")};
       END`,
      `CREATE TRIGGER IF NOT EXISTS trg_counters_skills_delete AFTER DELETE ON skills BEGIN
         UPDATE counters SET value = value - 1 WHERE key = 'skills_total';
         UPDATE counters SET value = value - 1 WHERE key = 'skills_pending' AND ${pendingSkill("OLD")};
       END`,
      `CREATE TRIGGER IF NOT EXISTS trg_counters_skills_pending AFTER UPDATE OF enabled, source ON skills BEGIN
         UPDATE counters SET value = value
           + (CASE WHEN ${pendingSkill("NEW")} THEN 1 ELSE 0 END)
           - (CASE WHEN ${pendingSkill("OLD")} THEN 1 ELSE 0 END)
         WHERE key = 'skills_pending';
       END`,
    ].map((sql) => env.DB.prepare(sql)),
    // Running sub-agent jobs.
    ...[
      `CREATE TRIGGER IF NOT EXISTS trg_counters_delegations_insert AFTER INSERT ON delegations BEGIN
         UPDATE counters SET value = value + 1 WHERE key = 'delegations_running' AND NEW.state = 'running';
       END`,
      `CREATE TRIGGER IF NOT EXISTS trg_counters_delegations_delete AFTER DELETE ON delegations BEGIN
         UPDATE counters SET value = value - 1 WHERE key = 'delegations_running' AND OLD.state = 'running';
       END`,
      `CREATE TRIGGER IF NOT EXISTS trg_counters_delegations_state AFTER UPDATE OF state ON delegations BEGIN
         UPDATE counters SET value = value
           + (CASE WHEN NEW.state = 'running' THEN 1 ELSE 0 END)
           - (CASE WHEN OLD.state = 'running' THEN 1 ELSE 0 END)
         WHERE key = 'delegations_running';
       END`,
    ].map((sql) => env.DB.prepare(sql)),
    // Enabled API keys across the four provider pools.
    ...["gemini", "openrouter", "openai", "nvidia"].flatMap((p) => [
      `CREATE TRIGGER IF NOT EXISTS trg_counters_${p}_keys_insert AFTER INSERT ON ${p}_keys BEGIN
         UPDATE counters SET value = value + 1 WHERE key = 'api_keys_active' AND NEW.enabled = 1;
       END`,
      `CREATE TRIGGER IF NOT EXISTS trg_counters_${p}_keys_delete AFTER DELETE ON ${p}_keys BEGIN
         UPDATE counters SET value = value - 1 WHERE key = 'api_keys_active' AND OLD.enabled = 1;
       END`,
      `CREATE TRIGGER IF NOT EXISTS trg_counters_${p}_keys_enabled AFTER UPDATE OF enabled ON ${p}_keys BEGIN
         UPDATE counters SET value = value
           + (CASE WHEN NEW.enabled = 1 THEN 1 ELSE 0 END)
           - (CASE WHEN OLD.enabled = 1 THEN 1 ELSE 0 END)
         WHERE key = 'api_keys_active';
       END`,
    ]).map((sql) => env.DB.prepare(sql)),
    // Errors recorded in the last seven days.
    env.DB.prepare(
      `CREATE TRIGGER IF NOT EXISTS trg_counters_errors AFTER INSERT ON activity_events
       WHEN NEW.ok = 0
       BEGIN
         UPDATE counters SET value = value + 1 WHERE key = 'errors_total_7d';
       END`
    ),
    // Lifetime skill usage, kept out of the pruned event log. Counted when the
    // event is written, not when the skills screen is opened.
    env.DB.prepare(
      `CREATE TRIGGER IF NOT EXISTS trg_skill_uses AFTER INSERT ON activity_events
       WHEN NEW.category = 'skill' AND NEW.action = 'selected'
       BEGIN
         INSERT OR REPLACE INTO skill_uses (skill, n)
         VALUES (NEW.detail, COALESCE((SELECT n FROM skill_uses WHERE skill = NEW.detail), 0) + 1);
       END`
    ),
  ]);
  // Backfill lifetime skill usage once from whatever events still exist. It is
  // absolute (replace), so a repeated run cannot inflate the counts.
  if ((await getConfig(env, "skill_uses_v1")) !== "done") {
    await env.DB.prepare(
      "INSERT OR REPLACE INTO skill_uses (skill, n) SELECT detail, COUNT(*) FROM activity_events WHERE category = 'skill' AND action = 'selected' AND detail <> '' GROUP BY detail"
    ).run();
    await setConfig(env, "skill_uses_v1", "done");
  }
  // Seed the grouped tables from the old raw log once. The insert claims the work,
  // so two cold instances cannot both run it; a failure removes the claim so the
  // next instance retries.
  if ((await getConfig(env, "activity_rollup_v1")) !== "done") {
    const claim = await env.DB.prepare(
      "INSERT INTO config (key, value) VALUES ('activity_rollup_v1', 'building') ON CONFLICT(key) DO NOTHING RETURNING value"
    ).first();
    if (claim) {
      try {
        await backfillActivityRollups(env);
        await setConfig(env, "activity_rollup_v1", "done");
      } catch (e) {
        await env.DB.prepare("DELETE FROM config WHERE key = 'activity_rollup_v1'").run().catch(() => {});
        throw e;
      }
    }
  }
  // Make every counter match its source once per schema version. Rows seeded before
  // the triggers existed (services, keys, built-ins) are included here.
  await recomputeCounters(env);
  await setConfig(env, "schema_version", SCHEMA_VERSION);
  schemaReady = true;
}
