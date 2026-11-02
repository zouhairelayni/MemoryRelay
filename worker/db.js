// D1 access helpers and the one-time schema check.
import { FALLBACK_MODELS } from "./constants.js";
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
// Tests create a fresh database per case, so they need to reset the once-per-instance flag.
export const resetSchemaCache = () => { schemaReady = false; };
export async function ensureSchema(env) {
  if (schemaReady) return;
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
    env.DB.prepare("CREATE TABLE IF NOT EXISTS memories (id TEXT PRIMARY KEY, text TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT '', created TEXT NOT NULL, updated TEXT NOT NULL, history TEXT NOT NULL DEFAULT '[]')"),
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
    ['sync_status',"sync_status TEXT NOT NULL DEFAULT ''"]
  ]) if(!repoCols.has(key)) {
    try { await env.DB.prepare('ALTER TABLE skill_repos ADD COLUMN '+ddl).run(); }
    catch(e) {if(!/duplicate column/i.test(String(e)))throw e;}
  }
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
  schemaReady = true;
}
