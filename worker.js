const MAX_LEN = 500;
const FALLBACK_MODELS = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash"];
const SESSION_DAYS = 30;
const PBKDF2_ITER = 100000;
const MAX_CALLS = 8; // Workers subrequest budget per request
const RETRYABLE = new Set([0, 500, 502, 503, 504]); // 0 = could not reach Gemini at all
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BUILD = "2026-10-23.5";

const TOOLS = [
  { name: "remember", description: "Save ONE short, self-contained fact, preference, or decision (max 500 chars). Never paste whole conversations. Skips duplicates.",
    inputSchema: { type: "object", properties: { text: { type: "string" }, tags: { type: "string" } }, required: ["text"] } },
  { name: "search", description: "Find memories containing all the query words (max 20 short results). Use before answering questions about the user.",
    inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "integer" } }, required: ["query"] } },
  { name: "recent", description: "Show the most recent memories (max 20). Use only when the user asks what was saved recently.",
    inputSchema: { type: "object", properties: { n: { type: "integer" } } } },
  { name: "update_memory", description: "Change an existing memory by id. Pass only the fields to change. The old text is kept in history.",
    inputSchema: { type: "object", properties: { memory_id: { type: "string" }, text: { type: "string" }, tags: { type: "string" } }, required: ["memory_id"] } },
  { name: "forget", description: "Delete one memory by id.",
    inputSchema: { type: "object", properties: { memory_id: { type: "string" } }, required: ["memory_id"] } },
  { name: "housekeep", description: "Ask Gemini to find duplicate or conflicting memories. Dry run unless apply=true. Only apply after the user approves.",
    inputSchema: { type: "object", properties: { apply: { type: "boolean" } } } }
];

const json = (obj, status = 200, cookie = null) => {
  const h = { "content-type": "application/json; charset=utf-8" };
  if (cookie) h["set-cookie"] = cookie;
  return new Response(JSON.stringify(obj), { status, headers: h });
};
const now = () => new Date().toISOString().slice(0, 16).replace("T", " ");
const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 8);
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (h) => Uint8Array.from(h.match(/../g).map((x) => parseInt(x, 16)));
const randomHex = (n) => toHex(crypto.getRandomValues(new Uint8Array(n)));
const norm = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

function similar(a, b) {
  const na = norm(a), nb = norm(b);
  if (na === nb) return true;
  const A = new Set(na.split(" ").filter(Boolean)), B = new Set(nb.split(" ").filter(Boolean));
  if (!A.size || !B.size) return false;
  let common = 0;
  for (const w of A) if (B.has(w)) common++;
  return common / (A.size + B.size - common) >= 0.8;
}

const brief = (m) => ({ id: m.id, text: m.text.slice(0, 300), tags: m.tags || "", time: m.created });
const isProtected = (tags) => String(tags || "").split(",").map((t) => t.trim().toLowerCase()).includes("rules");

async function runAll(env, stmts) {
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
}

async function getConfig(env, key) {
  const row = await env.DB.prepare("SELECT value FROM config WHERE key = ?").bind(key).first();
  return row ? row.value : null;
}

async function setConfig(env, key, value) {
  await env.DB.prepare(
    "INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).bind(key, value).run();
}

// Schema check runs once per Worker instance. It creates the services table and,
// on first run, a default "Claude" service that keeps your current connector address.
// It also creates the Gemini key/model pool and migrates the old single key and model.
let schemaReady = false;
async function ensureSchema(env) {
  if (schemaReady) return;
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

async function serviceBySecret(env, secret) {
  return env.DB.prepare("SELECT * FROM services WHERE secret = ? AND revoked = 0").bind(secret).first();
}

async function activeServices(env) {
  const { results } = await env.DB.prepare("SELECT * FROM services WHERE revoked = 0 ORDER BY created").all();
  return results;
}

async function hashPassword(pw, saltHex) {
  const salt = saltHex ? fromHex(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: PBKDF2_ITER, hash: "SHA-256" }, key, 256);
  return { hash: toHex(bits), salt: toHex(salt) };
}

async function userCount(env) {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first();
  return r.n;
}

function cookieFrom(request, name) {
  const c = request.headers.get("cookie") || "";
  const m = c.match(new RegExp("(?:^|; )" + name + "=([^;]+)"));
  return m ? m[1] : null;
}

async function currentUser(env, request) {
  const token = cookieFrom(request, "sid");
  if (!token) return null;
  return env.DB.prepare(
    "SELECT u.id, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires > ?"
  ).bind(token, Date.now()).first();
}

const sessionCookie = (token, maxAge) =>
  "sid=" + token + "; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=" + maxAge;

async function startSession(env, userId) {
  const token = randomHex(32);
  await env.DB.prepare("INSERT INTO sessions (token, user_id, expires) VALUES (?, ?, ?)")
    .bind(token, userId, Date.now() + SESSION_DAYS * 86400000).run();
  return token;
}

async function readCreds(request) {
  const b = await request.json().catch(() => ({}));
  const email = String(b.email || "").trim().toLowerCase();
  const password = String(b.password || "");
  if (!email.includes("@")) return { error: "enter a valid email" };
  if (password.length < 8) return { error: "password must be at least 8 characters" };
  return { email, password };
}

async function authSetup(env, request) {
  if ((await userCount(env)) > 0) return json({ error: "account already exists, log in instead" }, 403);
  const c = await readCreds(request);
  if (c.error) return json({ error: c.error }, 400);
  const { hash, salt } = await hashPassword(c.password);
  const r = await env.DB.prepare("INSERT INTO users (email, pass_hash, salt, created) VALUES (?, ?, ?, ?)")
    .bind(c.email, hash, salt, now()).run();
  const token = await startSession(env, r.meta.last_row_id);
  return json({ ok: true }, 200, sessionCookie(token, SESSION_DAYS * 86400));
}

async function authLogin(env, request) {
  const c = await readCreds(request);
  if (c.error) return json({ error: c.error }, 400);
  const u = await env.DB.prepare("SELECT id, pass_hash, salt FROM users WHERE email = ?").bind(c.email).first();
  if (!u) return json({ error: "wrong email or password" }, 401);
  const { hash } = await hashPassword(c.password, u.salt);
  if (hash !== u.pass_hash) return json({ error: "wrong email or password" }, 401);
  const token = await startSession(env, u.id);
  return json({ ok: true }, 200, sessionCookie(token, SESSION_DAYS * 86400));
}

async function auth(request, env, url) {
  const p = url.pathname, m = request.method;
  if (p === "/auth/status" && m === "GET") {
    const user = await currentUser(env, request);
    return json({ setup: (await userCount(env)) === 0, loggedIn: !!user, email: user ? user.email : "" });
  }
  if (p === "/auth/setup" && m === "POST") return authSetup(env, request);
  if (p === "/auth/login" && m === "POST") return authLogin(env, request);
  if (p === "/auth/logout" && m === "POST") {
    const token = cookieFrom(request, "sid");
    if (token) await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
    return json({ ok: true }, 200, sessionCookie("", 0));
  }
  return json({ error: "no such route" }, 404);
}

async function remember(env, a) {
  const text = String(a.text || "").trim();
  if (!text) return "nothing saved: empty text";
  if (text.length > MAX_LEN) return `not saved: over ${MAX_LEN} chars, split it into smaller facts`;
  if (isProtected(a.tags)) return "not saved: the tag rules is reserved for owner rules";
  const { results } = await env.DB.prepare("SELECT id, text FROM memories").all();
  const dup = results.find((m) => similar(m.text, text));
  if (dup) return `duplicate of ${dup.id}, not saved`;
  const id = newId(), t = now();
  await env.DB.prepare(
    "INSERT INTO memories (id, text, tags, source, created, updated, history) VALUES (?, ?, ?, ?, ?, ?, '[]')"
  ).bind(id, text, String(a.tags || "").trim().toLowerCase(), String(a.source || "claude"), t, t).run();
  return `saved ${id}`;
}

async function search(env, a) {
  const limit = Math.min(Math.max(Number(a.limit) || 5, 1), 20);
  const words = String(a.query || "").toLowerCase().split(" ").filter(Boolean);
  const where = words.length ? "WHERE " + words.map(() => "(text || ' ' || tags) LIKE ?").join(" AND ") : "";
  const params = words.map((w) => `%${w}%`);
  const total = await env.DB.prepare(`SELECT COUNT(*) AS n FROM memories ${where}`).bind(...params).first();
  const { results } = await env.DB.prepare(
    `SELECT id, text, tags, created FROM memories ${where} ORDER BY created DESC, rowid DESC LIMIT ?`
  ).bind(...params, limit).all();
  return { total: total.n, results: results.map(brief) };
}

async function recent(env, a) {
  const n = Math.min(Math.max(Number(a.n) || 5, 1), 20);
  const total = await env.DB.prepare("SELECT COUNT(*) AS n FROM memories").first();
  const { results } = await env.DB.prepare(
    "SELECT id, text, tags, created FROM memories ORDER BY created DESC, rowid DESC LIMIT ?"
  ).bind(n).all();
  return { total: total.n, results: results.map(brief) };
}

async function updateMemory(env, a) {
  const row = await env.DB.prepare("SELECT * FROM memories WHERE id = ?").bind(String(a.memory_id)).first();
  if (!row) return "not found";
  if (isProtected(row.tags)) return "protected: rules memories cannot be changed through the connector";
  let text = row.text, tags = row.tags;
  const history = JSON.parse(row.history || "[]");
  const newText = String(a.text || "").trim();
  if (newText) {
    if (newText.length > MAX_LEN) return `not updated: over ${MAX_LEN} chars`;
    history.push({ text: row.text, time: row.updated });
    text = newText;
  }
  if (a.tags && String(a.tags).trim()) tags = String(a.tags).trim().toLowerCase();
  await env.DB.prepare("UPDATE memories SET text = ?, tags = ?, updated = ?, history = ? WHERE id = ?")
    .bind(text, tags, now(), JSON.stringify(history), row.id).run();
  return `updated ${row.id}`;
}

const cleanTags = (s) => String(s || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean).join(",");

// Dashboard only (the owner). Rule toggle on: the tag is exactly "rules", which agents can never
// change or delete. Rule toggle off: free tags, never "rules", at most 3.
function ownerTags(rule, rawTags) {
  if (rule) return { tags: "rules" };
  const tags = cleanTags(rawTags);
  if (isProtected(tags)) return { error: "the tag rules is only set with the Rule toggle" };
  if (tags && tags.split(",").length > 3) return { error: "use at most 3 tags" };
  return { tags };
}

async function addMemory(env, b) {
  const text = String(b.text || "").trim();
  if (!text) return { error: "write the memory first" };
  if (text.length > MAX_LEN) return { error: `over ${MAX_LEN} characters` };
  const rule = b.rule === true;
  const t = ownerTags(rule, b.tags);
  if (t.error) return t;
  const { results } = await env.DB.prepare("SELECT id, text FROM memories").all();
  const dup = results.find((m) => similar(m.text, text));
  if (dup) return { error: `a similar memory already exists (${dup.id})` };
  const id = newId(), when = now();
  await env.DB.prepare(
    "INSERT INTO memories (id, text, tags, source, created, updated, history) VALUES (?, ?, ?, ?, ?, ?, '[]')"
  ).bind(id, text, t.tags, rule ? "owner" : "dashboard", when, when).run();
  return { ok: true, id, rule };
}

async function editMemory(env, id, b) {
  const row = await env.DB.prepare("SELECT * FROM memories WHERE id = ?").bind(String(id)).first();
  if (!row) return { error: "memory not found" };
  const text = String(b.text || "").trim();
  if (!text) return { error: "text cannot be empty" };
  if (text.length > MAX_LEN) return { error: `over ${MAX_LEN} characters` };
  const rule = typeof b.rule === "boolean" ? b.rule : isProtected(row.tags);
  let tags = row.tags;
  if (rule || typeof b.tags === "string") {
    const t = ownerTags(rule, b.tags);
    if (t.error) return t;
    tags = t.tags;
  }
  if (!rule && isProtected(tags)) tags = "";
  const history = JSON.parse(row.history || "[]");
  if (text !== row.text) history.push({ text: row.text, time: row.updated });
  await env.DB.prepare("UPDATE memories SET text = ?, tags = ?, updated = ?, history = ? WHERE id = ?")
    .bind(text, tags, now(), JSON.stringify(history), row.id).run();
  return { ok: true, id: row.id, rule };
}

async function forget(env, a) {
  const row = await env.DB.prepare("SELECT tags FROM memories WHERE id = ?").bind(String(a.memory_id)).first();
  if (!row) return "not found";
  if (isProtected(row.tags)) return "protected: rules memories cannot be deleted through the connector";
  await env.DB.prepare("DELETE FROM memories WHERE id = ?").bind(String(a.memory_id)).run();
  return "deleted";
}

async function listGeminiModels(key) {
  let r;
  try {
    r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=100", {
      headers: { "x-goog-api-key": key },
    });
  } catch {
    return { error: "could not reach Gemini (network error)" };
  }
  if (!r.ok) return { error: "Gemini returned HTTP " + r.status + " (check the key)" };
  const d = await r.json();
  const models = (d.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent") && /gemini/.test(m.name))
    .map((m) => m.name.replace(/^models\//, ""));
  return { models };
}

async function callGemini(key, model, prompt) {
  try {
    return await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json" } }),
    });
  } catch (e) {
    // Network failure: report it like a failed response so rotation carries on to the next key or model.
    return { ok: false, status: 0, json: async () => ({}), text: async () => String((e && e.message) || e) };
  }
}

async function setCooldown(env, keyId, model, ms) {
  await env.DB.prepare(
    "INSERT INTO gemini_cooldowns (key_id, model, until) VALUES (?, ?, ?) ON CONFLICT(key_id, model) DO UPDATE SET until = excluded.until"
  ).bind(keyId, model, Date.now() + ms).run();
}

// Tries every enabled model in order; for each model, tries every enabled key
// (starting from a round-robin position). Handles 429 (cooldown), 503/5xx (one retry),
// and 401/403 (disables the key).
async function gemini(env, prompt) {
  const keys = (await env.DB.prepare("SELECT id, label, key FROM gemini_keys WHERE enabled = 1 ORDER BY created").all()).results;
  const models = (await env.DB.prepare("SELECT name FROM gemini_models WHERE enabled = 1 ORDER BY pos, name").all()).results.map((m) => m.name);
  if (!keys.length) return { error: "no enabled Gemini key (add one in the dashboard)" };
  if (!models.length) return { error: "no enabled Gemini model (add one in the dashboard)" };

  const cool = await env.DB.prepare("SELECT key_id, model FROM gemini_cooldowns WHERE until > ?").bind(Date.now()).all();
  const cooling = new Set(cool.results.map((c) => c.key_id + "|" + c.model));

  const rr = Number(await getConfig(env, "gemini_rr")) || 0;
  await setConfig(env, "gemini_rr", String(rr + 1));
  const rotated = keys.map((_, i) => keys[(rr + i) % keys.length]);

  const log = [];
  let calls = 0;
  for (const model of models) {
    for (const k of rotated) {
      const tag = `${k.label}/${model}`;
      if (cooling.has(k.id + "|" + model)) { log.push(`${tag}: cooling down`); continue; }
      if (calls >= MAX_CALLS) { log.push("attempt limit reached"); return { error: log.join("; ") }; }

      calls++;
      let r = await callGemini(k.key, model, prompt);
      if (RETRYABLE.has(r.status) && calls < MAX_CALLS) {
        await sleep(1500);
        calls++;
        r = await callGemini(k.key, model, prompt);
      }

      if (r.ok) {
        const d = await r.json();
        const text = d?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) return { text, model, key: k.label };
        log.push(`${tag}: empty reply`);
        continue;
      }

      const body = await r.text();
      if (r.status === 429) {
        const daily = /PerDay|per.?day|daily/i.test(body);
        await setCooldown(env, k.id, model, daily ? 6 * 3600e3 : 60e3);
        log.push(`${tag}: 429 rate limited${daily ? " (daily quota, cooling 6h)" : ""}`);
      } else if (r.status === 401 || r.status === 403 || /API_KEY_INVALID/.test(body)) {
        await env.DB.prepare("UPDATE gemini_keys SET enabled = 0 WHERE id = ?").bind(k.id).run();
        log.push(`${tag}: key rejected, disabled`);
      } else {
        log.push(`${tag}: ${r.status ? "HTTP " + r.status : "network error"}${RETRYABLE.has(r.status) ? " (after retry)" : ""}`);
      }
    }
  }
  return { error: log.join("; ") || "no attempt made" };
}

async function housekeep(env, a) {
  const { results } = await env.DB.prepare(
    "SELECT id, text FROM memories WHERE tags NOT LIKE '%rules%' ORDER BY created DESC, rowid DESC LIMIT 200"
  ).all();
  if (!results.length) {
    const rules = await env.DB.prepare("SELECT COUNT(*) AS n FROM memories WHERE tags LIKE '%rules%'").first();
    return { message: "no editable memories: housekeeping skips rules-tagged memories", rules_memories: rules.n };
  }
  const prompt = 'You maintain a list of memories. Find groups that duplicate or contradict each other. Reply ONLY with JSON: {"groups":[{"keep":"id","drop":["id"],"merged_text":"...","reason":"..."}]}. If none, reply {"groups":[]}.\n\nMEMORIES:\n' + JSON.stringify(results);
  const byId = new Map(results.map((m) => [m.id, m]));
  let groups, model = "", keyLabel = "";
  if (a.apply && Array.isArray(a.groups)) {
    groups = a.groups; // dashboard: apply exactly what the user saw in the preview
  } else {
    const g = await gemini(env, prompt);
    if (g.error) return { error: g.error };
    try {
      const s = g.text;
      groups = JSON.parse(s.slice(s.indexOf("{"), s.lastIndexOf("}") + 1)).groups || [];
    } catch {
      return { error: "model returned invalid JSON", model: g.model };
    }
    model = g.model;
    keyLabel = g.key;
  }
  // Keep only valid groups: ids must exist and must not be rules memories.
  groups = groups.map((grp) => {
    const keep = String(grp && grp.keep || "");
    return {
      keep,
      drop: (Array.isArray(grp && grp.drop) ? grp.drop : []).map(String).filter((d) => d !== keep && byId.has(d)),
      merged_text: String(grp && grp.merged_text || "").trim(),
      reason: String(grp && grp.reason || ""),
    };
  }).filter((grp) => byId.has(grp.keep) && grp.drop.length);
  if (!a.apply) {
    if (!groups.length) return { model, key: keyLabel, proposed: [], message: "No duplicates found." };
    return {
      model, key: keyLabel,
      proposed: groups.map((grp) => ({
        ...grp,
        keep_text: byId.get(grp.keep).text,
        drop_texts: grp.drop.map((d) => byId.get(d).text),
      })),
    };
  }
  const drop = new Set();
  const stmts = [];
  let updated = 0;
  for (const grp of groups) {
    if (!byId.has(grp.keep)) continue;
    for (const d of grp.drop || []) if (d !== grp.keep && byId.has(d)) drop.add(d);
    const merged = String(grp.merged_text || "").trim();
    if (merged && merged.length <= MAX_LEN) {
      updated++;
      stmts.push(env.DB.prepare(
        "UPDATE memories SET history = json_insert(history, '$[#]', json_object('text', text, 'time', updated)), text = ?, updated = ? WHERE id = ?"
      ).bind(merged, now(), grp.keep));
    }
  }
  for (const d of drop) stmts.push(env.DB.prepare("DELETE FROM memories WHERE id = ?").bind(d));
  await runAll(env, stmts);
  return { model, key: keyLabel, removed: drop.size, merged: updated };
}

async function geminiState(env) {
  const keys = (await env.DB.prepare("SELECT id, label, key, enabled FROM gemini_keys ORDER BY created").all()).results;
  const models = (await env.DB.prepare("SELECT name, enabled FROM gemini_models ORDER BY pos, name").all()).results;
  const cool = (await env.DB.prepare("SELECT key_id, model FROM gemini_cooldowns WHERE until > ?").bind(Date.now()).all()).results;
  return {
    keys: keys.map((k) => ({
      id: k.id, label: k.label, tail: k.key.slice(-4), enabled: !!k.enabled,
      cooling: cool.filter((c) => c.key_id === k.id).map((c) => c.model),
    })),
    models: models.map((m) => ({ name: m.name, enabled: !!m.enabled })),
  };
}

async function geminiOp(env, request) {
  const b = await request.json().catch(() => ({}));
  switch (b.op) {
    case "add_key": {
      const key = String(b.key || "").trim();
      if (!key) return { error: "paste a key" };
      await env.DB.prepare("INSERT OR IGNORE INTO gemini_keys (id, label, key, created) VALUES (?, ?, ?, ?)")
        .bind(newId(), String(b.label || "key").trim().slice(0, 40) || "key", key, now()).run();
      break;
    }
    case "delete_key":
      await env.DB.prepare("DELETE FROM gemini_keys WHERE id = ?").bind(String(b.id)).run();
      break;
    case "toggle_key":
      await env.DB.prepare("UPDATE gemini_keys SET enabled = 1 - enabled WHERE id = ?").bind(String(b.id)).run();
      break;
    case "add_model": {
      const name = String(b.name || "").trim();
      if (!name) return { error: "type a model name" };
      await env.DB.prepare(
        "INSERT OR IGNORE INTO gemini_models (name, enabled, pos) VALUES (?, 1, (SELECT COALESCE(MAX(pos), 0) + 1 FROM gemini_models))"
      ).bind(name).run();
      break;
    }
    case "delete_model":
      await env.DB.prepare("DELETE FROM gemini_models WHERE name = ?").bind(String(b.name)).run();
      break;
    case "toggle_model":
      await env.DB.prepare("UPDATE gemini_models SET enabled = 1 - enabled WHERE name = ?").bind(String(b.name)).run();
      break;
    case "move_model": {
      const { results } = await env.DB.prepare("SELECT name FROM gemini_models ORDER BY pos, name").all();
      const names = results.map((r) => r.name);
      const i = names.indexOf(String(b.name)), j = i + Number(b.dir);
      if (i < 0 || j < 0 || j >= names.length) break;
      [names[i], names[j]] = [names[j], names[i]];
      await runAll(env, names.map((n, pos) =>
        env.DB.prepare("UPDATE gemini_models SET pos = ? WHERE name = ?").bind(pos, n)));
      break;
    }
    default:
      return { error: "unknown op" };
  }
  return geminiState(env);
}

// Counts what an agent did, by outcome, for the per-connection stats.
function tally(stats, name, out) {
  const s = typeof out === "string" ? out : "";
  if (name === "search" || name === "recent") stats.n_read++;
  else if (name === "remember") { if (s.startsWith("saved")) stats.n_write++; }
  else if (name === "update_memory") { if (s.startsWith("updated")) stats.n_write++; }
  else if (name === "forget") { if (s === "deleted") stats.n_delete++; }
  else if (name === "housekeep") {
    if (out && typeof out.removed === "number") { stats.n_delete += out.removed; stats.n_write += out.merged || 0; }
    else stats.n_read++;
  }
}

async function meter(env, request, res, serviceId, stats) {
  const bin = Number(request.headers.get("content-length") || 0);
  const bout = (await res.clone().arrayBuffer()).byteLength;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO service_stats (service_id, requests, n_read, n_write, n_delete, bytes_in, bytes_out, last, app)
       VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(service_id) DO UPDATE SET requests = requests + 1, n_read = n_read + excluded.n_read,
       n_write = n_write + excluded.n_write, n_delete = n_delete + excluded.n_delete,
       bytes_in = bytes_in + excluded.bytes_in, bytes_out = bytes_out + excluded.bytes_out, last = excluded.last,
       app = CASE WHEN excluded.app <> '' THEN excluded.app ELSE app END`
    ).bind(serviceId, stats.n_read, stats.n_write, stats.n_delete, bin, bout, now(), stats.app || ""),
    env.DB.prepare("UPDATE services SET last_seen = ? WHERE id = ?").bind(now(), serviceId),
  ]);
}

async function callTool(env, name, a) {
  switch (name) {
    case "remember": return remember(env, a);
    case "search": return search(env, a);
    case "recent": return recent(env, a);
    case "update_memory": return updateMemory(env, a);
    case "forget": return forget(env, a);
    case "housekeep": return housekeep(env, { apply: !!a.apply }); // agents cannot inject groups
    default: throw new Error("unknown tool " + name);
  }
}

async function handleMcp(request, env, stats) {
  const msg = await request.json();
  const { id, method } = msg;
  const params = msg.params || {};
  if (!method) return json({ jsonrpc: "2.0", id: id ?? null, error: { code: -32600, message: "invalid request" } }, 400);
  if (id === undefined) return new Response(null, { status: 202 });
  const ok = (result) => json({ jsonrpc: "2.0", id, result });
  if (method === "initialize") {
    const ci = params.clientInfo || {};
    if (stats) stats.app = [ci.name, ci.version].filter(Boolean).map(String).join(" ").slice(0, 60);
    return ok({ protocolVersion: params.protocolVersion || "2025-06-18", capabilities: { tools: {} },
      serverInfo: { name: "my-memory", version: "2.1.0" } });
  }
  if (method === "ping") return ok({});
  if (method === "tools/list") return ok({ tools: TOOLS });
  if (method === "tools/call") {
    try {
      const out = await callTool(env, params.name, params.arguments || {});
      if (stats) tally(stats, params.name, out);
      return ok({ content: [{ type: "text", text: typeof out === "string" ? out : JSON.stringify(out, null, 2) }] });
    } catch (e) {
      return ok({ content: [{ type: "text", text: "error: " + e.message }], isError: true });
    }
  }
  return json({ jsonrpc: "2.0", id, error: { code: -32601, message: "method not found" } });
}

async function settings(env) {
  const last = await env.DB.prepare("SELECT MAX(last_seen) AS last FROM services").first();
  const mem = await env.DB.prepare(
    "SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN tags LIKE '%rules%' THEN 1 ELSE 0 END), 0) AS rules FROM memories"
  ).first();
  const svc = await env.DB.prepare("SELECT COUNT(*) AS n FROM services WHERE revoked = 0").first();
  const keys = await env.DB.prepare("SELECT COUNT(*) AS n FROM gemini_keys WHERE enabled = 1").first();
  return {
    last_call: last && last.last ? last.last : "",
    memories: mem.n, rules: mem.rules, connections: svc.n, keys: keys.n,
  };
}

async function listServices(env) {
  const { results } = await env.DB.prepare(
    "SELECT s.id, s.name, s.secret, s.created, s.last_seen, s.revoked, COALESCE(t.requests, 0) AS requests, COALESCE(t.n_read, 0) AS n_read, COALESCE(t.n_write, 0) AS n_write, COALESCE(t.n_delete, 0) AS n_delete, COALESCE(t.bytes_in, 0) AS bytes_in, COALESCE(t.bytes_out, 0) AS bytes_out, COALESCE(t.last, '') AS last, COALESCE(t.app, '') AS app FROM services s LEFT JOIN service_stats t ON t.service_id = s.id ORDER BY s.created"
  ).all();
  return results.map((s) => ({
    id: s.id, name: s.name, created: s.created, last_seen: s.last_seen, revoked: !!s.revoked, url: "/mcp/" + s.secret,
    requests: s.requests, n_read: s.n_read, n_write: s.n_write, n_delete: s.n_delete,
    bytes_in: s.bytes_in, bytes_out: s.bytes_out, last: s.last, app: s.app,
  }));
}

async function testConnector(env, request) {
  const list = await activeServices(env);
  if (!list.length) return { live: false, http: 0, ms: 0, message: "no active services" };
  const svc = list[0];
  const req = new Request(new URL("/mcp/" + svc.secret, request.url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "dashboard-test", version: "1" } } }),
  });
  const t0 = Date.now();
  const res = await handleMcp(req, env);
  const text = await res.text();
  return { live: res.status === 200 && text.includes("my-memory"), http: res.status, ms: Date.now() - t0,
    service: svc.name, checked: now() };
}

async function api(request, env, url) {
  const user = await currentUser(env, request);
  if (!user) return json({ error: "log in first" }, 401);
  const p = url.pathname, m = request.method;

  if (p === "/api/settings" && m === "GET") return json(await settings(env));
  if (p === "/api/services" && m === "GET") return json({ services: await listServices(env) });
  if (p === "/api/services" && m === "POST") {
    const b = await request.json().catch(() => ({}));
    const name = String(b.name || "").trim().slice(0, 60);
    if (!name) return json({ error: "give the service a name" }, 400);
    const id = newId(), secret = randomHex(24);
    await env.DB.prepare("INSERT INTO services (id, name, secret, created) VALUES (?, ?, ?, ?)")
      .bind(id, name, secret, now()).run();
    return json({ id, name, url: "/mcp/" + secret });
  }
  const revoke = p.match(/^\/api\/services\/([^/]+)\/revoke$/);
  if (revoke && m === "POST") {
    const r = await env.DB.prepare("UPDATE services SET revoked = 1 WHERE id = ? AND revoked = 0").bind(revoke[1]).run();
    return json({ revoked: r.meta.changes });
  }
  const svcDel = p.match(/^\/api\/services\/([^/]+)$/);
  if (svcDel && m === "DELETE") {
    const r = await env.DB.prepare("DELETE FROM services WHERE id = ? AND revoked = 1").bind(svcDel[1]).run();
    if (!r.meta.changes) return json({ error: "only revoked services can be deleted" }, 400);
    await env.DB.prepare("DELETE FROM service_stats WHERE service_id = ?").bind(svcDel[1]).run();
    return json({ deleted: r.meta.changes });
  }
  if (p === "/api/connector/test" && m === "POST") return json(await testConnector(env, request));

  if (p === "/api/gemini" && m === "GET") return json(await geminiState(env));
  if (p === "/api/gemini" && m === "POST") {
    const out = await geminiOp(env, request);
    return json(out, out.error ? 400 : 200);
  }
  if (p === "/api/gemini/models" && m === "GET") {
    const row = await env.DB.prepare("SELECT key FROM gemini_keys WHERE enabled = 1 LIMIT 1").first();
    if (!row) return json({ error: "add an enabled key first" }, 400);
    const out = await listGeminiModels(row.key);
    return json(out, out.error ? 400 : 200);
  }

  if (p === "/api/memories" && m === "POST") {
    const b = await request.json().catch(() => ({}));
    const out = await addMemory(env, b);
    return json(out, out.error ? 400 : 200);
  }
  if (p === "/api/memories" && m === "GET") {
    const words = (url.searchParams.get("q") || "").toLowerCase().split(" ").filter(Boolean);
    const where = words.length ? "WHERE " + words.map(() => "(text || ' ' || tags) LIKE ?").join(" AND ") : "";
    const { results } = await env.DB.prepare(
      `SELECT id, text, tags, created AS time FROM memories ${where} ORDER BY created DESC, rowid DESC LIMIT 500`
    ).bind(...words.map((w) => `%${w}%`)).all();
    return json({ count: results.length, items: results });
  }
  if (p.startsWith("/api/memories/") && m === "PUT") {
    const b = await request.json().catch(() => ({}));
    const out = await editMemory(env, p.split("/").pop(), b);
    return json(out, out.error ? 400 : 200);
  }
  if (p.startsWith("/api/memories/") && m === "DELETE") {
    const r = await env.DB.prepare("DELETE FROM memories WHERE id = ?").bind(p.split("/").pop()).run();
    return json({ deleted: r.meta.changes });
  }
  if (p === "/api/export" && m === "GET") {
    const { results } = await env.DB.prepare("SELECT * FROM memories ORDER BY created, rowid").all();
    return new Response(JSON.stringify(results, null, 2), { headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="memories-${now().replace(/[^0-9]/g, "")}.json"`,
    } });
  }
  if (p === "/api/import" && m === "POST") {
    const mode = url.searchParams.get("mode") || "merge";
    let incoming;
    try { incoming = await request.json(); } catch { return json({ error: "invalid JSON" }, 400); }
    if (!Array.isArray(incoming)) return json({ error: "expected a list of memories" }, 400);
    const rows = incoming.filter((x) => x && typeof x.text === "string" && x.text.trim() && !isProtected(x.tags)).map((x) => ({
      id: String(x.id || newId()),
      text: x.text.trim().slice(0, MAX_LEN),
      tags: String(x.tags || "").toLowerCase(),
      source: String(x.source || "import"),
      created: String(x.created || x.time || now()),
      updated: String(x.updated || x.time || now()),
      history: typeof x.history === "string" ? x.history : JSON.stringify(Array.isArray(x.history) ? x.history : []),
    }));
    const stmts = [];
    if (mode === "replace") stmts.push(env.DB.prepare("DELETE FROM memories WHERE tags NOT LIKE '%rules%'"));
    for (const r of rows) {
      stmts.push(env.DB.prepare(
        "INSERT OR IGNORE INTO memories (id, text, tags, source, created, updated, history) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).bind(r.id, r.text, r.tags, r.source, r.created, r.updated, r.history));
    }
    await runAll(env, stmts);
    const total = await env.DB.prepare("SELECT COUNT(*) AS n FROM memories").first();
    return json({ imported: rows.length, total: total.n });
  }
  if (p === "/api/stats" && m === "GET") {
    const { results } = await env.DB.prepare(
      "SELECT s.id, s.name, s.revoked, s.created, COALESCE(t.requests, 0) AS requests, COALESCE(t.n_read, 0) AS n_read, COALESCE(t.n_write, 0) AS n_write, COALESCE(t.n_delete, 0) AS n_delete, COALESCE(t.bytes_in, 0) AS bytes_in, COALESCE(t.bytes_out, 0) AS bytes_out, COALESCE(t.last, '') AS last, COALESCE(t.app, '') AS app FROM services s LEFT JOIN service_stats t ON t.service_id = s.id ORDER BY s.created"
    ).all();
    return json({ services: results.map((r) => ({ ...r, revoked: !!r.revoked })) });
  }
  if (p === "/api/housekeep" && m === "POST") {
    const body = await request.json().catch(() => ({}));
    return json(await housekeep(env, { apply: !!body.apply, groups: body.groups }));
  }
  return json({ error: "no such api route" }, 404);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      const pwa = pwaResponse(url.pathname);
      if (pwa) return pwa;
      await ensureSchema(env);
      if (url.pathname.startsWith("/mcp/")) {
        const svc = await serviceBySecret(env, url.pathname.slice(5));
        if (!svc) return new Response("not found", { status: 404 });
        if (request.method !== "POST") return new Response("method not allowed", { status: 405, headers: { allow: "POST" } });
        const stats = { n_read: 0, n_write: 0, n_delete: 0, app: "" };
        const res = await handleMcp(request, env, stats);
        ctx.waitUntil(meter(env, request, res, svc.id, stats));
        return res;
      }
      if (url.pathname === "/") return Response.redirect(url.origin + "/dashboard", 302);
      if (url.pathname === "/dashboard") {
        return new Response(DASHBOARD.replace("__BUILD__", BUILD), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" } });
      }
      if (url.pathname.startsWith("/auth/")) return await auth(request, env, url);
      if (url.pathname.startsWith("/api/")) return await api(request, env, url);
      return new Response("not found", { status: 404 });
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  },
};

// ---- PWA: manifest, service worker, icons (served without login) ----
const ICON_192 = "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";
const ICON_512 = "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";
const MANIFEST = JSON.stringify({
  name: "Memory Relay",
  short_name: "Memory",
  description: "Memory dashboard for your connected agents",
  id: "/dashboard",
  start_url: "/dashboard",
  scope: "/",
  display: "standalone",
  background_color: "#13161e",
  theme_color: "#13161e",
  orientation: "any",
  lang: "en",
  categories: ["productivity", "utilities"],
  prefer_related_applications: false,
  icons: [
    { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
  ]
});
// Service worker: network-first for pages, cache fallback when offline.
// API, auth and MCP requests are never cached.
const SW_JS = `const CACHE = "memory-relay-v2";
const SHELL = ["/dashboard", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];
self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener("fetch", function (e) {
  var req = e.request;
  var url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  var p = url.pathname;
  if (p.indexOf("/api/") === 0 || p.indexOf("/auth/") === 0 || p.indexOf("/mcp/") === 0) return;
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).then(function (res) {
      if (p === "/dashboard" && res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put("/dashboard", copy); }); }
      return res;
    }).catch(function () { return caches.match("/dashboard"); }));
    return;
  }
  if (SHELL.indexOf(p) !== -1) {
    e.respondWith(caches.match(req).then(function (hit) { return hit || fetch(req); }));
  }
});
`;

function b64bytes(b64) {
  const s = atob(b64);
  const a = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
  return a;
}

function pwaResponse(p) {
  if (p === "/manifest.webmanifest")
    return new Response(MANIFEST, { headers: { "content-type": "application/manifest+json; charset=utf-8", "cache-control": "no-cache" } });
  if (p === "/sw.js")
    return new Response(SW_JS, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache" } });
  if (p === "/icon-192.png")
    return new Response(b64bytes(ICON_192), { headers: { "content-type": "image/png", "cache-control": "public, max-age=86400" } });
  if (p === "/icon-512.png")
    return new Response(b64bytes(ICON_512), { headers: { "content-type": "image/png", "cache-control": "public, max-age=86400" } });
  return null;
}

const DASHBOARD = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Memory Relay</title>
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#F5F1EA" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#13161E" media="(prefers-color-scheme: dark)">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Memory">
<link rel="icon" type="image/png" href="/icon-192.png">
<link rel="apple-touch-icon" href="/icon-192.png">
<style>
:root{
  --paper:#F5F1EA; --paper2:#EDE7DC; --card:#FBF9F5; --ink:#1B2230; --ink2:#4A5263; --muted:#838896;
  --line:#DCD5C8; --teal:#1E6F68; --teal-soft:#D6EAE6; --brass:#A97E36; --brass-soft:#F2E7D2;
  --rose:#A4493F; --rose-soft:#F5DFDB; --info:#E6EDF3; --info-line:#C6D3DF; --info-ink:#40566B;
  --shadow:0 1px 2px rgba(27,34,48,.05),0 12px 32px -18px rgba(27,34,48,.25);
  --serif:"Iowan Old Style","Palatino Linotype",Palatino,"Book Antiqua",Georgia,serif;
  --sans:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  --r:18px;
}
@media (prefers-color-scheme: dark){
  :root{
    --paper:#13161E; --paper2:#1A1E28; --card:#1E2330; --ink:#EDE8DE; --ink2:#BDB8AD; --muted:#7E8594;
    --line:#333A49; --teal:#5FC2B8; --teal-soft:#1B3B39; --brass:#D9B26E; --brass-soft:#362C1C;
    --rose:#E38B81; --rose-soft:#3A221F; --info:#1D2935; --info-line:#324457; --info-ink:#B7C8D9;
    --shadow:0 1px 2px rgba(0,0,0,.3),0 16px 40px -20px rgba(0,0,0,.6);
  }
}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html{scroll-behavior:smooth}
[hidden]{display:none!important}
svg{pointer-events:none}
body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.6 var(--sans);-webkit-font-smoothing:antialiased}
.wrap{max-width:1060px;margin:0 auto;padding:0 20px}
h1,h2,h3{font-family:var(--serif);font-weight:400;margin:0;letter-spacing:-.01em}
h2{font-size:clamp(26px,4vw,34px);margin-top:10px}
h3{font-size:20px}
p{margin:0 0 12px}
code,.mono{font-family:var(--mono);font-size:.88em}
.eyebrow{font:600 12px/1 var(--sans);letter-spacing:.18em;text-transform:uppercase;color:var(--brass)}
.lede{color:var(--ink2);font-size:16px;max-width:62ch;margin:10px 0 0}
.muted{color:var(--muted)}
.small{font-size:14px}
.ok{color:var(--teal)}
.bad{color:var(--rose)}

/* nav */
nav.top{position:sticky;top:0;z-index:20;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);background:color-mix(in srgb,var(--paper) 85%,transparent);border-bottom:1px solid var(--line)}
nav.top .wrap{display:flex;gap:8px;align-items:center;overflow-x:auto;height:66px;scrollbar-width:none}
nav.top .wrap::-webkit-scrollbar{display:none}
nav.top a{color:var(--ink2);text-decoration:none;font-size:14px;font-weight:500;padding:8px 14px;border-radius:999px;white-space:nowrap;border:1px solid var(--line);background:var(--card);transition:background .2s,color .2s,border-color .2s}
nav.top a:hover{border-color:var(--teal);color:var(--ink)}
nav.top a:focus-visible{outline:2px solid var(--teal);outline-offset:2px}
nav.top a.active{background:var(--ink);border-color:var(--ink);color:var(--paper)}
nav.top .brand{font-family:var(--serif);font-size:19px;color:var(--ink);margin-right:14px;white-space:nowrap;flex:none}
nav.top .grow{flex:1;min-width:8px}
nav.top .btn{flex:none}

/* buttons */
.btn{font:600 14px/1.2 var(--sans);border:1px solid var(--ink);background:var(--ink);color:var(--paper);padding:10px 18px;border-radius:999px;cursor:pointer;transition:opacity .2s,transform .15s,border-color .2s,background .2s;display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.btn:hover{opacity:.85}
.btn:active{transform:scale(.97)}
.btn:disabled{opacity:.35;cursor:default}
.btn:focus-visible{outline:2px solid var(--teal);outline-offset:2px}
.btn.ghost{background:transparent;color:var(--ink);border-color:var(--line)}
.btn.ghost:hover{border-color:var(--teal);opacity:1}
.btn.danger{background:transparent;color:var(--rose);border-color:color-mix(in srgb,var(--rose) 45%,transparent)}
.btn.danger:hover{background:var(--rose-soft);opacity:1}
.btn.sdanger{background:var(--rose);border-color:var(--rose);color:#fff}
.btn.sm{padding:7px 13px;font-size:13px}

/* forms */
.fld{font:15px var(--sans);width:100%;color:var(--ink);background:var(--card);border:1px solid var(--line);border-radius:12px;padding:11px 14px;transition:border-color .2s,box-shadow .2s}
.fld:focus{outline:none;border-color:var(--teal);box-shadow:0 0 0 3px var(--teal-soft)}
.fld::placeholder{color:var(--muted)}
.fld:disabled{opacity:.6;background:var(--paper2)}
textarea.fld{min-height:96px;resize:vertical;line-height:1.5}
input[type=file].fld{padding:8px 10px}
input[type=file]::file-selector-button{font:600 13px var(--sans);border:1px solid var(--line);background:var(--paper2);color:var(--ink);padding:6px 12px;border-radius:999px;margin-right:10px;cursor:pointer}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:14px}
.row .grow{flex:1;min-width:140px}
.sw{display:inline-flex;align-items:center;gap:10px;cursor:pointer;font-size:15px;color:var(--ink2);user-select:none}
.sw input{-webkit-appearance:none;appearance:none;width:46px;height:26px;border-radius:13px;background:var(--line);border:0;padding:0;margin:0;position:relative;cursor:pointer;flex:none;transition:background .25s}
.sw input::after{content:"";position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:var(--card);box-shadow:0 1px 3px rgba(0,0,0,.25);transition:transform .25s cubic-bezier(.2,.8,.2,1)}
.sw input:checked{background:var(--teal)}
.sw input:checked::after{transform:translateX(20px)}
.sw input:disabled{opacity:.5;cursor:default}
.sw input:focus-visible{outline:2px solid var(--teal);outline-offset:2px}

/* segmented control */
.seg{display:inline-flex;background:var(--paper2);border-radius:999px;padding:5px;border:1px solid var(--line);max-width:100%}
.seg button{border:0;background:transparent;color:var(--ink2);font:600 14px var(--sans);padding:9px 18px;border-radius:999px;cursor:pointer;transition:background .25s,color .25s;white-space:nowrap}
.seg button[aria-pressed="true"]{background:var(--ink);color:var(--paper)}
.seg button:focus-visible{outline:2px solid var(--teal);outline-offset:2px}
.seg .n{opacity:.6;font-weight:500;margin-left:4px}

/* hero */
.hero{padding:56px 0 34px;position:relative;overflow:hidden}
.hero::before{content:"";position:absolute;inset:-40% -10% auto auto;width:640px;height:640px;border-radius:50%;background:radial-gradient(closest-side,var(--teal-soft),transparent);opacity:.7;z-index:-1}
.hero h1{font-size:clamp(40px,7vw,68px);line-height:1;margin:16px 0 18px;max-width:14ch}
.hero h1 em{font-style:italic;color:var(--teal)}
.chips{display:flex;flex-wrap:wrap;gap:10px;margin-top:24px}
.chip{background:var(--card);border:1px solid var(--line);border-radius:999px;padding:8px 16px;font-size:14px;color:var(--ink2);box-shadow:var(--shadow)}
.chip b{color:var(--ink);font-weight:600}
.live{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-top:28px}
.live-main{display:flex;align-items:center;gap:16px;min-width:0}
.live-t{font:400 22px var(--serif)}
.pulse{width:12px;height:12px;border-radius:50%;background:var(--muted);flex:none;position:relative}
.pulse.ok{background:var(--teal)}
.pulse.bad{background:var(--rose)}
.pulse.ok::after{content:"";position:absolute;inset:0;border-radius:50%;background:var(--teal);animation:ping 1.8s ease-out infinite}
@keyframes ping{from{transform:scale(1);opacity:.5}to{transform:scale(2.8);opacity:0}}
.risk{margin-top:22px;display:grid;grid-template-columns:auto 1fr;gap:16px;align-items:start;background:var(--info);border:1px solid var(--info-line);border-radius:var(--r);padding:18px 20px;font-size:15px;color:var(--ink2)}
.risk .ico{width:30px;height:30px;border-radius:50%;background:var(--info-ink);color:var(--info);display:grid;place-items:center;font:700 16px var(--serif)}

/* sections */
section.block{padding:56px 0;border-top:1px solid var(--line);scroll-margin-top:66px}
.head{margin-bottom:24px}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:22px;box-shadow:var(--shadow)}
.card+.card,.card+.tray{margin-top:14px}
.tray{background:var(--paper2);border:1px solid var(--line);border-radius:var(--r);padding:12px;max-height:440px;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;margin-top:14px;scrollbar-width:thin}
.tray:empty{display:none}
#items.tray{max-height:520px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px}
.stack{display:flex;flex-direction:column;gap:10px}
.badge{font:600 11px var(--sans);text-transform:uppercase;letter-spacing:.1em;padding:4px 9px;border-radius:999px;white-space:nowrap}
.badge.ok{background:var(--teal-soft);color:var(--teal)}
.badge.bad{background:var(--rose-soft);color:var(--rose)}
.badge.rule{background:var(--brass-soft);color:var(--brass)}
.badge.tag{background:var(--paper2);color:var(--ink2);border:1px solid var(--line);text-transform:none;letter-spacing:0;font-weight:500}

/* drawer cards */
.dcard{background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden;transition:border-color .25s,transform .25s,box-shadow .25s}
.dcard:hover{border-color:var(--ink2)}
.dhead{display:flex;align-items:center;gap:8px;padding-right:14px}
.dmain{flex:1;min-width:0;display:flex;align-items:center;gap:14px;padding:12px 8px 12px 14px;background:transparent;border:0;color:inherit;font:inherit;text-align:left;cursor:pointer;-webkit-appearance:none;appearance:none}
.dmain:focus-visible{outline:2px solid var(--ink2);outline-offset:-2px}
.ic{width:36px;height:36px;border-radius:10px;display:grid;place-items:center;flex:none}
.ic.ok{background:var(--teal-soft);color:var(--teal)}
.ic.lock{background:var(--rose-soft);color:var(--rose)}
.ic.num{background:var(--paper2);color:var(--ink2);font:600 14px var(--sans);border-radius:50%}
.tt{flex:1;min-width:0}
.tt code{display:block;font-size:14px;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tt small{display:block;color:var(--muted);font-size:13px}
.chev{color:var(--muted);display:grid;place-items:center;transition:transform .4s cubic-bezier(.2,.8,.2,1)}
.dcard.open .chev{transform:rotate(180deg)}
.drawer{display:grid;grid-template-rows:0fr;transition:grid-template-rows .45s cubic-bezier(.2,.8,.2,1)}
.drawer-inner{min-height:0;overflow:hidden;opacity:0;visibility:hidden;transform:translateY(-8px);transition:opacity .3s ease,transform .45s cubic-bezier(.2,.8,.2,1),visibility 0s linear .45s}
.dcard.open>.drawer,.drawer.open{grid-template-rows:1fr}
.dcard.open>.drawer>.drawer-inner,.drawer.open>.drawer-inner{opacity:1;visibility:visible;transform:none;transition:opacity .3s ease,transform .45s cubic-bezier(.2,.8,.2,1),visibility 0s}
.dcard .pad{padding:2px 16px 16px 64px}
.pad .row:first-child{margin-top:4px}
.drawer.open>.drawer-inner{padding:4px}

/* connection cards */
.conn .cpad{padding:18px 18px 14px}
.conn .top{display:flex;justify-content:space-between;align-items:center;gap:10px}
.conn h3{font-size:20px;overflow-wrap:anywhere}
.conn .where{font-size:13px;color:var(--muted);margin:2px 0 14px;overflow-wrap:anywhere}
.conn.off{opacity:.78}
.triple{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.triple div{background:var(--paper2);border-radius:12px;padding:10px 8px;text-align:center}
.triple b{display:block;font:400 24px var(--serif);color:var(--ink)}
.triple span{font-size:12px;color:var(--muted);letter-spacing:.06em;text-transform:uppercase}
.split{display:flex;height:8px;border-radius:999px;background:var(--paper2);border:1px solid var(--line);overflow:hidden;margin:12px 0 6px}
.split i{display:block;height:100%;transition:width .5s cubic-bezier(.2,.8,.2,1)}
.split .r{background:var(--teal)}
.split .w{background:var(--brass)}
.split .d{background:var(--rose)}
.legend{display:flex;gap:14px;font-size:12px;color:var(--muted)}
.legend span::before{content:"";display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;background:var(--teal)}
.legend .w::before{background:var(--brass)}
.legend .d::before{background:var(--rose)}
.conn .more{width:100%;display:flex;justify-content:space-between;align-items:center;background:transparent;border:0;border-top:1px solid var(--line);color:var(--ink2);font:600 13px var(--sans);padding:12px 18px;cursor:pointer;-webkit-appearance:none;appearance:none}
.conn .more:hover{color:var(--ink)}
.conn .more:focus-visible{outline:2px solid var(--ink2);outline-offset:-2px}
.conn .pad{padding:2px 18px 6px}
dl.kv{display:grid;grid-template-columns:auto 1fr;gap:8px 16px;margin:6px 0 0;font-size:14px}
dl.kv dt{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.08em;padding-top:3px}
dl.kv dd{margin:0;color:var(--ink2);overflow-wrap:anywhere}
.conn .acts{display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:4px 18px 16px}
.ask{font-size:14px;color:var(--ink2);flex:1 1 100%}

/* memories */
.mem{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px;transition:border-color .2s}
.mem:hover{border-color:var(--ink2)}
.mem.is-rule{border-left:3px solid var(--brass)}
.mem .mt{font-size:15px;color:var(--ink);overflow-wrap:anywhere;white-space:pre-wrap}
.mem .meta{display:flex;flex-wrap:wrap;gap:6px 8px;align-items:center;margin-top:10px;font-size:12px;color:var(--muted)}
.mem .acts{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:12px}
.editor .tools{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px}
.editor .tools .count{margin-left:auto;font-size:12px;color:var(--muted)}
.editor textarea{margin-bottom:12px}
.editor .tagrow{margin-top:12px}
.editor .note{min-height:20px;font-size:13px;color:var(--muted);margin-top:8px}
.suggest{background:var(--teal-soft);border-radius:14px;padding:14px 16px;margin-top:10px;color:var(--ink)}
.suggest small{display:block;color:var(--ink2);margin-top:4px}
.empty{color:var(--muted);font-size:14px;padding:6px}

footer{padding:34px 0 60px;border-top:1px solid var(--line);color:var(--muted);font-size:14px;text-align:center}

/* gate */
#gate{min-height:100vh;display:grid;align-items:center;padding:28px 0}
#gate .card{max-width:440px}
#gate h1{font-size:clamp(34px,8vw,52px);line-height:1.05;margin:14px 0 14px}
#gate h1 em{font-style:italic;color:var(--teal)}

.reveal{opacity:0;transform:translateY(14px);transition:opacity .7s ease,transform .7s ease}
.reveal.in{opacity:1;transform:none}

@media (max-width:860px){
  .grid{grid-template-columns:1fr}
  .dcard .pad{padding-left:16px}
  .hero{padding:40px 0 24px}
  section.block{padding:44px 0}
}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}.reveal{opacity:1;transform:none}}
</style>
</head>
<body>

<div id="gate" style="display:none">
  <div class="wrap">
    <div class="eyebrow">Memory Relay</div>
    <h1>One memory. <em>Every</em> agent.</h1>
    <div class="card">
      <div class="eyebrow" id="gate-title">Log in</div>
      <div class="row"><input id="email" type="email" class="fld" placeholder="Email" autocomplete="username"></div>
      <div class="row"><input id="password" type="password" class="fld" placeholder="Password (8+ characters)" autocomplete="current-password"></div>
      <div class="row"><button class="btn" id="gate-btn">Log in</button></div>
      <p class="muted small" id="gate-hint" style="margin:12px 0 0"></p>
      <p class="bad small" id="gate-err" style="margin:8px 0 0"></p>
    </div>
  </div>
</div>

<div id="app" style="display:none">
<nav class="top">
  <div class="wrap">
    <span class="brand">Memory Relay</span>
    <a href="#status">Status</a>
    <a href="#connections">Connections</a>
    <a href="#gemini">Gemini</a>
    <a href="#memories">Memories</a>
    <a href="#housekeeping">Housekeeping</a>
    <a href="#backup">Backup</a>
    <span class="grow"></span>
    <button class="btn sm ghost" id="install" hidden>Install app</button>
    <button class="btn sm ghost" id="logout">Log out</button>
  </div>
</nav>

<header class="hero" id="status">
  <div class="wrap">
    <div class="eyebrow">Memory relay &middot; one owner, many agents</div>
    <h1>One memory. <em>Every</em> agent.</h1>
    <p class="lede">Your shared memory bank, the agents connected to it, and the Gemini keys that keep it tidy.</p>
    <div class="chips">
      <span class="chip"><b id="c-mem">0</b> memories</span>
      <span class="chip"><b id="c-rules">0</b> rules</span>
      <span class="chip"><b id="c-conn">0</b> connections</span>
      <span class="chip"><b id="c-keys">0</b> Gemini keys</span>
    </div>
    <div class="card live reveal">
      <div class="live-main">
        <span class="pulse" id="status-dot"></span>
        <div>
          <div class="live-t" id="status-text">Checking...</div>
          <div class="muted small" id="status-meta"></div>
          <div class="muted small" id="last-call"></div>
        </div>
      </div>
      <button class="btn ghost" id="test">Check now</button>
    </div>
    <div class="risk" id="install-note" hidden>
      <div class="ico">i</div>
      <div>Brave on Android only adds a shortcut. For a real app install, open this page in Chrome and choose Install app.</div>
    </div>
  </div>
</header>

<section class="block" id="connections">
  <div class="wrap">
    <div class="head reveal">
      <div class="eyebrow">01 &middot; Connections</div>
      <h2>Every agent, its own address</h2>
      <p class="lede">Revoking one connection stops only that agent. Each card shows what it read, wrote and deleted.</p>
    </div>
    <div class="card reveal">
      <div class="row" style="margin-top:0"><input id="svc-name" class="fld grow" placeholder="Connection name, e.g. Claude"><button class="btn" id="svc-add">Add connection</button></div>
      <p class="muted small" id="svc-msg" style="margin:10px 0 0"></p>
    </div>
    <div id="services" class="tray grid"></div>
  </div>
</section>

<section class="block" id="gemini">
  <div class="wrap">
    <div class="head reveal">
      <div class="eyebrow">02 &middot; Gemini</div>
      <h2>Keys rotate, models fall back</h2>
      <p class="lede">Each request starts from the next key. A key that hits a rate limit cools down, and a rejected key is switched off.</p>
    </div>
    <div class="card reveal">
      <div class="seg" role="group" aria-label="Gemini settings">
        <button id="g-keys" aria-pressed="true">Keys <span class="n" id="g-keys-n"></span></button>
        <button id="g-models" aria-pressed="false">Models <span class="n" id="g-models-n"></span></button>
      </div>
      <div id="pane-keys">
        <div class="row"><input id="gk-label" class="fld" placeholder="Label" style="width:120px"><input id="gk-key" type="password" class="fld grow" placeholder="API key" autocomplete="off"><button class="btn" id="gk-add">Add key</button></div>
        <div id="gk-list" class="tray stack"></div>
      </div>
      <div id="pane-models" hidden>
        <div class="row"><input id="gm-name" list="gm-opts" class="fld grow" placeholder="Model name"><datalist id="gm-opts"></datalist><button class="btn" id="gm-add">Add</button><button class="btn ghost" id="gm-load">Browse</button></div>
        <div id="gm-list" class="tray stack"></div>
      </div>
      <p class="muted small" id="gm-msg" style="margin:12px 0 0"></p>
    </div>
  </div>
</section>

<section class="block" id="memories">
  <div class="wrap">
    <div class="head reveal">
      <div class="eyebrow">03 &middot; Memories</div>
      <h2>What your agents remember</h2>
      <p class="lede">Search, add, edit and delete. Memories you mark as rules stay under your control.</p>
    </div>
    <div class="risk reveal" style="margin:0 0 14px">
      <div class="ico">i</div>
      <div><strong>Rules are yours alone.</strong> A memory with the Rule switch on can only be edited or deleted here, by you. Agents can read it but never change or remove it.</div>
    </div>
    <div class="card reveal">
      <div class="row" style="margin-top:0"><input id="q" class="fld grow" placeholder="Search memories"><button class="btn ghost" id="go">Search</button></div>
      <div class="row">
        <div class="seg" role="group" aria-label="Filter">
          <button id="f-all" data-filter="all" aria-pressed="true">All</button>
          <button id="f-rules" data-filter="rules" aria-pressed="false">Rules</button>
          <button id="f-other" data-filter="other" aria-pressed="false">Other</button>
        </div>
        <button class="btn" id="add-open">Add memory</button>
      </div>
      <div class="drawer" id="add-drawer"><div class="drawer-inner"><div id="add-box" style="padding-top:14px"></div></div></div>
      <p class="muted small" id="count" style="margin:14px 0 0"></p>
    </div>
    <div id="items" class="tray stack"></div>
  </div>
</section>

<section class="block" id="housekeeping">
  <div class="wrap">
    <div class="head reveal">
      <div class="eyebrow">04 &middot; Housekeeping</div>
      <h2>Let Gemini tidy up</h2>
      <p class="lede">Gemini looks for duplicate or conflicting memories and suggests a fix. Nothing changes until you approve it. Rules are never touched.</p>
    </div>
    <div class="card reveal">
      <div class="row" style="margin-top:0"><button class="btn" id="check">Check duplicates</button></div>
      <div id="hk"></div>
    </div>
  </div>
</section>

<section class="block" id="backup">
  <div class="wrap">
    <div class="head reveal">
      <div class="eyebrow">05 &middot; Backup</div>
      <h2>Keep a way back</h2>
      <p class="lede">Download everything as a file, or bring a backup in. Rules are never replaced by an import.</p>
    </div>
    <div class="card reveal">
      <div class="row" style="margin-top:0"><button class="btn ghost" id="exp">Download backup</button></div>
      <div class="row"><input type="file" id="file" accept="application/json" class="fld grow"></div>
      <div class="row">
        <div class="seg" role="group" aria-label="Import mode">
          <button id="m-merge" data-mode="merge" aria-pressed="true">Merge (add new)</button>
          <button id="m-replace" data-mode="replace" aria-pressed="false">Replace all</button>
        </div>
        <span id="imp-wrap"><button class="btn" id="imp">Import</button></span>
      </div>
      <p class="muted small" id="msg" style="margin:12px 0 0"></p>
    </div>
  </div>
</section>

<footer><div class="wrap">Memory Relay &middot; Build __BUILD__</div></footer>
</div>

<script>
var gateMode = "login";
var refreshTimer = null;
var openDrawers = {};
var memFilter = "all";
var importMode = "merge";
var savedTags = {};
var memItems = [];
var editingId = null;
var installEvt = null;
var addToken = 0;

function $(id) { return document.getElementById(id); }
function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]; }); }
function fmt(n) { return n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(1) + " KB" : (n / 1048576).toFixed(2) + " MB"; }
function svgI(p, s) {
  s = s || 16;
  return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>';
}
var ICONS = {
  check: svgI('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  lock: svgI('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11"/>'),
  chev: svgI('<path d="M6 9l6 6 6-6"/>', 18),
  up: svgI('<path d="M12 19V5M5 12l7-7 7 7"/>', 14),
  down: svgI('<path d="M12 5v14M19 12l-7 7-7-7"/>', 14),
  plus: svgI('<path d="M12 5v14M5 12h14"/>', 15),
  pencil: svgI('<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>', 14),
  trash: svgI('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>', 14),
  copy: svgI('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>', 14),
  download: svgI('<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>', 15)
};
function api(path, opts) {
  opts = opts || {};
  opts.headers = Object.assign({"content-type": "application/json"}, opts.headers || {});
  return fetch(path, opts).then(function (r) {
    return r.json().catch(function () { return {}; }).then(function (d) {
      if (r.status === 401) { showGate(false); throw new Error("please log in"); }
      if (!r.ok) throw new Error(d.error || ("HTTP " + r.status));
      return d;
    });
  });
}
function copyText(text) {
  var t = document.createElement("textarea");
  t.value = text; t.setAttribute("readonly", ""); t.style.position = "fixed"; t.style.opacity = "0";
  document.body.appendChild(t); t.select();
  var ok = false;
  try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
  document.body.removeChild(t);
  return ok;
}
function clip(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return copyText(text); });
  }
  return Promise.resolve(copyText(text));
}

/* inline confirmation: swaps the button row for a question with two buttons */
function askInline(btn, text, yesLabel, onYes) {
  var holder = btn.parentNode;
  var saved = holder.innerHTML;
  var done = false;
  holder.classList.add("confirming");
  holder.innerHTML = '<span class="ask">' + esc(text) + '</span><button class="btn sm sdanger" data-yes="1">' + esc(yesLabel) + '</button><button class="btn sm ghost" data-no="1">Cancel</button>';
  function finish(restore) {
    if (done) return;
    done = true;
    holder.classList.remove("confirming");
    holder.onclick = null;
    if (restore) holder.innerHTML = saved;
  }
  holder.onclick = function (e) {
    var t = e.target.closest ? e.target.closest("button") : null;
    if (!t) return;
    if (t.getAttribute("data-no")) { finish(true); }
    else if (t.getAttribute("data-yes")) { finish(false); onYes(); }
  };
}

/* drawers (open state survives re-renders) */
document.addEventListener("click", function (e) {
  var b = e.target.closest ? e.target.closest("[data-drawer]") : null;
  if (!b) return;
  var card = b.closest(".dcard");
  var key = b.getAttribute("data-drawer");
  var on = !card.classList.contains("open");
  card.classList.toggle("open", on);
  b.setAttribute("aria-expanded", String(on));
  if (on) openDrawers[key] = true; else delete openDrawers[key];
});

/* gate and app shell */
function showGate(setup) {
  stopAutoRefresh();
  gateMode = setup ? "setup" : "login";
  $("app").style.display = "none";
  $("gate").style.display = "";
  $("gate-title").textContent = setup ? "Create your account" : "Log in";
  $("gate-btn").textContent = setup ? "Create account" : "Log in";
  $("gate-hint").textContent = setup ? "First visit: this account owns your memory relay." : "";
}
function showApp() {
  $("gate").style.display = "none";
  $("app").style.display = "";
  refreshAll();
  loadItems();
  startAutoRefresh();
}
function refreshAll() { loadStatus(); loadServices(); loadSettings(); loadGemini(); }
function startAutoRefresh() {
  stopAutoRefresh();
  refreshTimer = setInterval(function () {
    loadStatus(); loadSettings();
    if (!document.querySelector(".confirming")) { loadServices(); loadGemini(); }
  }, 20000);
}
function stopAutoRefresh() { if (refreshTimer) clearInterval(refreshTimer); refreshTimer = null; }

$("gate-btn").onclick = function () {
  $("gate-err").textContent = "";
  fetch("/auth/" + gateMode, {method: "POST", headers: {"content-type": "application/json"},
    body: JSON.stringify({email: $("email").value, password: $("password").value})})
    .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || r.status); return d; }); })
    .then(function () { $("password").value = ""; showApp(); })
    .catch(function (e) { $("gate-err").textContent = e.message; });
};
$("logout").onclick = function () {
  fetch("/auth/logout", {method: "POST"}).then(function () { return fetch("/auth/status"); })
    .then(function (r) { return r.json(); }).then(function (s) { showGate(s.setup); });
};

/* status and counts */
function loadStatus() {
  return api("/api/connector/test", {method: "POST"}).then(function (d) {
    $("status-dot").className = "pulse " + (d.live ? "ok" : "bad");
    if (d.message) {
      $("status-text").textContent = "Not live: " + d.message;
    } else {
      $("status-text").textContent = d.live ? "Live" : "Not responding (HTTP " + d.http + ")";
    }
    $("status-meta").textContent = (d.service ? "Tested via " + d.service + ". " : "") +
      (d.checked ? "Checked " + d.checked + " (auto-refresh every 20 s)." : "");
  }).catch(function (e) { $("status-text").textContent = e.message; });
}
function loadSettings() {
  return api("/api/settings").then(function (s) {
    $("last-call").textContent = s.last_call ? "Last request from a client: " + s.last_call : "No client has connected yet";
    $("c-mem").textContent = s.memories;
    $("c-rules").textContent = s.rules;
    $("c-conn").textContent = s.connections;
    $("c-keys").textContent = s.keys;
  }).catch(function () {});
}
$("test").onclick = function () { loadStatus(); };

/* connections */
function pct(n, tot) { return tot ? Math.round(n / tot * 100) : 0; }
function connCard(s) {
  var key = "svc:" + s.id;
  var open = openDrawers[key];
  var tot = s.n_read + s.n_write + s.n_delete;
  var acts = s.revoked ?
    '<button class="btn sm danger" data-delete="' + esc(s.id) + '">' + ICONS.trash + 'Delete</button>' :
    '<button class="btn sm ghost" data-copy="' + esc(location.origin + s.url) + '">' + ICONS.copy + 'Copy address</button>' +
    '<button class="btn sm danger" data-revoke="' + esc(s.id) + '" data-name="' + esc(s.name) + '">Revoke</button>';
  return '<article class="dcard conn' + (s.revoked ? " off" : "") + (open ? " open" : "") + '">' +
    '<div class="cpad"><div class="top"><h3>' + esc(s.name) + '</h3><span class="badge ' + (s.revoked ? "bad" : "ok") + '">' + (s.revoked ? "Revoked" : "Active") + '</span></div>' +
    '<div class="where">MCP ID ' + esc(s.id) + (s.app ? " &middot; " + esc(s.app) : "") + '</div>' +
    '<div class="triple"><div><b>' + s.n_read + '</b><span>Reads</span></div><div><b>' + s.n_write + '</b><span>Writes</span></div><div><b>' + s.n_delete + '</b><span>Deletes</span></div></div>' +
    '<div class="split" aria-hidden="true"><i class="r" style="width:' + pct(s.n_read, tot) + '%"></i><i class="w" style="width:' + pct(s.n_write, tot) + '%"></i><i class="d" style="width:' + pct(s.n_delete, tot) + '%"></i></div>' +
    '<div class="legend"><span>Read</span><span class="w">Write</span><span class="d">Delete</span></div></div>' +
    '<button class="more" data-drawer="' + esc(key) + '" aria-expanded="' + (open ? "true" : "false") + '"><span>Details</span><span class="chev">' + ICONS.chev + '</span></button>' +
    '<div class="drawer"><div class="drawer-inner"><div class="pad"><dl class="kv">' +
      '<dt>MCP ID</dt><dd class="mono">' + esc(s.id) + '</dd>' +
      '<dt>App</dt><dd>' + (s.app ? esc(s.app) : "Not reported yet") + '</dd>' +
      '<dt>Requests</dt><dd>' + s.requests + '</dd>' +
      '<dt>Data in</dt><dd>' + fmt(s.bytes_in) + '</dd>' +
      '<dt>Data out</dt><dd>' + fmt(s.bytes_out) + '</dd>' +
      '<dt>Last used</dt><dd>' + (s.last ? esc(s.last) : "Never used") + '</dd>' +
      '<dt>Created</dt><dd>' + esc(s.created) + '</dd></dl></div></div></div>' +
    '<div class="acts">' + acts + '</div></article>';
}
function loadServices() {
  return api("/api/services").then(function (d) {
    if (!d.services.length) { $("services").innerHTML = '<p class="empty">No connections yet. Add one above.</p>'; return; }
    $("services").innerHTML = d.services.map(connCard).join("");
  }).catch(function (e) { $("services").textContent = "Error: " + e.message; });
}
$("services").addEventListener("click", function (e) {
  var b = e.target.closest ? e.target.closest("button") : null;
  if (!b) return;
  var copy = b.getAttribute("data-copy"), rev = b.getAttribute("data-revoke"), del = b.getAttribute("data-delete");
  if (copy) {
    $("svc-msg").textContent = copyText(copy) ? "Address copied." : "Could not copy. Long-press the address to copy it manually.";
    return;
  }
  if (rev) {
    askInline(b, "Revoke " + b.getAttribute("data-name") + "? Its address will stop working.", "Yes, revoke", function () {
      api("/api/services/" + rev + "/revoke", {method: "POST"}).then(function () {
        $("svc-msg").textContent = "Revoked.";
        loadServices(); loadStatus(); loadSettings();
      }).catch(function (err) { $("svc-msg").textContent = err.message; loadServices(); });
    });
    return;
  }
  if (del) {
    askInline(b, "Delete this connection for good?", "Yes, delete", function () {
      api("/api/services/" + del, {method: "DELETE"}).then(function () {
        $("svc-msg").textContent = "Deleted.";
        loadServices(); loadSettings();
      }).catch(function (err) { $("svc-msg").textContent = err.message; loadServices(); });
    });
  }
});
$("svc-add").onclick = function () {
  var name = $("svc-name").value.trim();
  if (!name) { $("svc-msg").textContent = "Type a name first."; return; }
  api("/api/services", {method: "POST", body: JSON.stringify({name: name})}).then(function (d) {
    $("svc-name").value = "";
    var addr = location.origin + d.url;
    var ok = copyText(addr);
    $("svc-msg").textContent = "Added " + d.name + " (ID " + d.id + "). Address " + (ok ? "copied" : "shown below") + ": " + addr;
    loadServices(); loadStatus(); loadSettings();
  }).catch(function (e) { $("svc-msg").textContent = e.message; });
};

/* gemini */
function setPane(p) {
  $("g-keys").setAttribute("aria-pressed", String(p === "keys"));
  $("g-models").setAttribute("aria-pressed", String(p === "models"));
  $("pane-keys").hidden = p !== "keys";
  $("pane-models").hidden = p !== "models";
}
$("g-keys").onclick = function () { setPane("keys"); };
$("g-models").onclick = function () { setPane("models"); };
function renderGemini(s) {
  $("g-keys-n").textContent = s.keys.length;
  $("g-models-n").textContent = s.models.length;
  $("gk-list").innerHTML = s.keys.map(function (k) {
    var key = "key:" + k.id, open = openDrawers[key];
    return '<div class="dcard' + (open ? " open" : "") + '"><div class="dhead">' +
      '<button class="dmain" data-drawer="' + esc(key) + '" aria-expanded="' + (open ? "true" : "false") + '">' +
      '<span class="ic ' + (k.enabled ? "ok" : "lock") + '">' + (k.enabled ? ICONS.check : ICONS.lock) + '</span>' +
      '<span class="tt"><code>' + esc(k.label) + '</code><small>....' + esc(k.tail) + (k.cooling.length ? " &middot; cooling" : "") + '</small></span>' +
      '<span class="chev">' + ICONS.chev + '</span></button>' +
      '<label class="sw" title="Enable or disable"><input type="checkbox" data-op="toggle_key" data-id="' + esc(k.id) + '"' + (k.enabled ? " checked" : "") + '></label></div>' +
      '<div class="drawer"><div class="drawer-inner"><div class="pad">' +
      '<p class="small muted" style="margin:0">' + (k.enabled ? "Used in rotation." : "Switched off. It is skipped until you turn it back on.") + (k.cooling.length ? " Cooling down for: " + k.cooling.map(esc).join(", ") + "." : "") + '</p>' +
      '<div class="row"><button class="btn sm danger" data-op="delete_key" data-id="' + esc(k.id) + '">' + ICONS.trash + 'Delete key</button></div>' +
      '</div></div></div></div>';
  }).join("") || '<p class="empty">No keys yet.</p>';
  $("gm-list").innerHTML = s.models.map(function (m, i) {
    var n = esc(m.name), key = "model:" + m.name, open = openDrawers[key];
    return '<div class="dcard' + (open ? " open" : "") + '"><div class="dhead">' +
      '<button class="dmain" data-drawer="' + esc(key) + '" aria-expanded="' + (open ? "true" : "false") + '">' +
      '<span class="ic num">' + (i + 1) + '</span>' +
      '<span class="tt"><code>' + n + '</code><small>' + (m.enabled ? "On" : "Off") + '</small></span>' +
      '<span class="chev">' + ICONS.chev + '</span></button>' +
      '<label class="sw" title="Enable or disable"><input type="checkbox" data-op="toggle_model" data-name="' + n + '"' + (m.enabled ? " checked" : "") + '></label></div>' +
      '<div class="drawer"><div class="drawer-inner"><div class="pad">' +
      '<div class="row"><button class="btn sm ghost" data-op="move_model" data-name="' + n + '" data-dir="-1">' + ICONS.up + 'Move up</button>' +
      '<button class="btn sm ghost" data-op="move_model" data-name="' + n + '" data-dir="1">' + ICONS.down + 'Move down</button>' +
      '<button class="btn sm danger" data-op="delete_model" data-name="' + n + '">' + ICONS.trash + 'Delete</button></div>' +
      '</div></div></div></div>';
  }).join("") || '<p class="empty">No models yet.</p>';
}
function loadGemini() {
  return api("/api/gemini").then(renderGemini).catch(function (e) { $("gm-msg").textContent = e.message; });
}
function gop(body) {
  return api("/api/gemini", {method: "POST", body: JSON.stringify(body)}).then(function (s) {
    $("gm-msg").textContent = "";
    renderGemini(s);
    loadSettings();
  }).catch(function (e) { $("gm-msg").textContent = e.message; loadGemini(); });
}
function opBody(el) {
  return {op: el.getAttribute("data-op"), id: el.getAttribute("data-id"), name: el.getAttribute("data-name"), dir: el.getAttribute("data-dir")};
}
document.addEventListener("click", function (e) {
  var b = e.target.closest ? e.target.closest("button[data-op]") : null;
  if (!b) return;
  var body = opBody(b);
  if (body.op.indexOf("delete") === 0) {
    askInline(b, "Delete this?", "Yes, delete", function () { gop(body); });
    return;
  }
  gop(body);
});
document.addEventListener("change", function (e) {
  var t = e.target;
  if (t.type === "checkbox" && t.getAttribute("data-op")) gop(opBody(t));
});
$("gk-add").onclick = function () {
  gop({op: "add_key", label: $("gk-label").value, key: $("gk-key").value}).then(function () { $("gk-key").value = ""; });
};
$("gm-add").onclick = function () {
  gop({op: "add_model", name: $("gm-name").value.trim()}).then(function () { $("gm-name").value = ""; });
};
$("gm-load").onclick = function () {
  $("gm-msg").textContent = "Loading models...";
  api("/api/gemini/models").then(function (d) {
    $("gm-opts").innerHTML = d.models.map(function (n) { return '<option value="' + esc(n) + '">'; }).join("");
    $("gm-msg").textContent = d.models.length + " models available. Type or pick one, then Add.";
  }).catch(function (e) { $("gm-msg").textContent = e.message; });
};

/* memories: editor */
function hasRule(tags) {
  return ("," + String(tags || "").toLowerCase().replace(/ /g, "") + ",").indexOf(",rules,") !== -1;
}
function editorHtml(p, o) {
  var b = function (a, label) { return '<button type="button" class="btn sm ghost" data-ed="' + a + '" data-p="' + p + '">' + label + '</button>'; };
  return '<div class="editor">' +
    '<div class="tools">' + b("selectall", "Select all") + b("copy", "Copy") + b("paste", "Paste") + '<span class="count" id="' + p + '-count"></span></div>' +
    '<textarea id="' + p + '-text" class="fld" maxlength="500" placeholder="One short, self-contained fact">' + esc(o.text || "") + '</textarea>' +
    '<label class="sw"><input type="checkbox" id="' + p + '-rule"' + (o.rule ? " checked" : "") + '><span>Rule (only you can edit or delete)</span></label>' +
    '<div class="tagrow"><input id="' + p + '-tags" class="fld" placeholder="Tags, comma separated (max 3)" value="' + esc(o.rule ? "rules" : (o.tags || "")) + '"' + (o.rule ? " disabled" : "") + '></div>' +
    '<div class="note" id="' + p + '-note"></div></div>';
}
function updateCount(p) {
  var ta = $(p + "-text"), c = $(p + "-count");
  if (ta && c) c.textContent = ta.value.length + "/500";
}
document.addEventListener("click", function (e) {
  var btn = e.target.closest ? e.target.closest("[data-ed]") : null;
  if (!btn) return;
  var a = btn.getAttribute("data-ed");
  var p = btn.getAttribute("data-p");
  var ta = $(p + "-text"), note = $(p + "-note");
  if (!ta) return;
  if (a === "selectall") {
    ta.focus();
    ta.select();
    try { ta.setSelectionRange(0, ta.value.length); } catch (x) {}
    note.textContent = "";
    return;
  }
  if (a === "copy") {
    var sel = ta.selectionStart !== ta.selectionEnd ? ta.value.slice(ta.selectionStart, ta.selectionEnd) : ta.value;
    if (!sel) { note.textContent = "Nothing to copy."; return; }
    clip(sel).then(function (ok) { note.textContent = ok ? "Copied." : "The browser blocked copying."; });
    return;
  }
  if (a === "paste") {
    if (!navigator.clipboard || !navigator.clipboard.readText) { note.textContent = "Paste is not available here. Long-press the box and choose Paste."; return; }
    navigator.clipboard.readText().then(function (t) {
      if (!t) { note.textContent = "The clipboard is empty."; return; }
      ta.setRangeText(t, ta.selectionStart, ta.selectionEnd, "end");
      var cut = ta.value.length > 500;
      if (cut) ta.value = ta.value.slice(0, 500);
      note.textContent = cut ? "Pasted and trimmed to 500 characters." : "Pasted.";
      ta.focus();
      updateCount(p);
    }, function () { note.textContent = "The browser blocked pasting. Long-press the box and choose Paste."; });
  }
});
document.addEventListener("input", function (e) {
  if (e.target.tagName === "TEXTAREA" && e.target.id.slice(-5) === "-text") updateCount(e.target.id.slice(0, -5));
});
document.addEventListener("change", function (e) {
  var id = e.target.id || "";
  if (id.slice(-5) !== "-rule") return;
  var p = id.slice(0, -5), tags = $(p + "-tags");
  if (!tags) return;
  if (e.target.checked) { savedTags[p] = tags.value; tags.value = "rules"; tags.disabled = true; }
  else { tags.disabled = false; tags.value = savedTags[p] && savedTags[p] !== "rules" ? savedTags[p] : ""; }
});

/* memories: list */
function memCard(m) {
  var rule = hasRule(m.tags);
  var tagBadges = String(m.tags || "").split(",").map(function (t) { return t.trim(); }).filter(function (t) { return t && t.toLowerCase() !== "rules"; })
    .map(function (t) { return '<span class="badge tag">' + esc(t) + '</span>'; }).join("");
  var meta = '<div class="meta">' + (rule ? '<span class="badge rule">Rule</span>' : "") + tagBadges + '<span>' + esc(m.time) + '</span><span class="mono">' + esc(m.id) + '</span></div>';
  if (m.id === editingId) {
    return '<div class="mem' + (rule ? " is-rule" : "") + '">' + editorHtml("edit", {text: m.text, tags: rule ? "" : m.tags, rule: rule}) +
      '<div class="row"><button class="btn" data-save="' + esc(m.id) + '">Save</button><button class="btn ghost" data-cancel="1">Cancel</button></div>' +
      '<div class="bad small" id="edit-err" style="margin-top:8px"></div>' + meta + '</div>';
  }
  return '<div class="mem' + (rule ? " is-rule" : "") + '"><div class="mt">' + esc(m.text) + '</div>' + meta +
    '<div class="acts"><button class="btn sm ghost" data-edit="' + esc(m.id) + '">' + ICONS.pencil + 'Edit</button>' +
    '<button class="btn sm danger" data-del="' + esc(m.id) + '">' + ICONS.trash + 'Delete</button></div></div>';
}
function renderItems() {
  var list = memItems.filter(function (m) { return memFilter === "all" || (memFilter === "rules") === hasRule(m.tags); });
  $("count").textContent = memFilter === "all" ? memItems.length + " memories" : list.length + " of " + memItems.length + " memories";
  $("items").innerHTML = list.length ? list.map(memCard).join("") : '<p class="empty">Nothing to show here.</p>';
  if (editingId) updateCount("edit");
}
function loadItems() {
  return api("/api/memories?q=" + encodeURIComponent($("q").value)).then(function (d) {
    memItems = d.items;
    if (!memItems.some(function (m) { return m.id === editingId; })) editingId = null;
    renderItems();
  }).catch(function (e) { $("items").textContent = "Error: " + e.message; });
}
$("items").addEventListener("click", function (e) {
  var t = e.target.closest ? e.target.closest("button") : null;
  if (!t) return;
  var ed = t.getAttribute("data-edit"), sv = t.getAttribute("data-save"), del = t.getAttribute("data-del");
  if (ed) {
    var cur = memItems.filter(function (x) { return x.id === ed; })[0];
    editingId = ed;
    savedTags.edit = cur && !hasRule(cur.tags) ? cur.tags : "";
    renderItems();
    var ta = $("edit-text");
    if (ta) ta.focus();
    return;
  }
  if (t.getAttribute("data-cancel")) { editingId = null; renderItems(); return; }
  if (sv) {
    t.disabled = true;
    api("/api/memories/" + sv, {method: "PUT", body: JSON.stringify({text: $("edit-text").value, tags: $("edit-tags").value, rule: $("edit-rule").checked})}).then(function () {
      editingId = null;
      loadItems().then(loadSettings);
    }).catch(function (err) { t.disabled = false; $("edit-err").textContent = err.message; });
    return;
  }
  if (del) {
    var m = memItems.filter(function (x) { return x.id === del; })[0];
    askInline(t, m && hasRule(m.tags) ? "Delete this rule?" : "Delete this memory?", "Yes, delete", function () {
      api("/api/memories/" + del, {method: "DELETE"}).then(function () { return loadItems(); }).then(loadSettings)
        .catch(function (err) { $("count").textContent = err.message; });
    });
  }
});
$("go").onclick = loadItems;
$("q").addEventListener("keydown", function (e) { if (e.key === "Enter") loadItems(); });
document.querySelectorAll("[data-filter]").forEach(function (b) {
  b.onclick = function () {
    memFilter = b.getAttribute("data-filter");
    document.querySelectorAll("[data-filter]").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
    renderItems();
  };
});

/* memories: add (animated drawer) */
function openAdd() {
  addToken++;
  savedTags.add = "";
  $("add-box").innerHTML = editorHtml("add", {text: "", tags: "", rule: false}) +
    '<div class="row"><button class="btn" id="add-save">Save memory</button><button class="btn ghost" id="add-cancel">Cancel</button></div><div class="bad small" id="add-err" style="margin-top:8px"></div>';
  updateCount("add");
  requestAnimationFrame(function () { requestAnimationFrame(function () { $("add-drawer").classList.add("open"); }); });
  setTimeout(function () { var t = $("add-text"); if (t) t.focus(); }, 160);
}
function closeAdd() {
  var tok = ++addToken;
  $("add-drawer").classList.remove("open");
  setTimeout(function () { if (tok === addToken) $("add-box").innerHTML = ""; }, 500);
}
$("add-open").onclick = function () {
  if ($("add-drawer").classList.contains("open")) { var t = $("add-text"); if (t) t.focus(); } else { openAdd(); }
};
$("add-box").addEventListener("click", function (e) {
  var b = e.target.closest ? e.target.closest("button") : null;
  if (!b) return;
  if (b.id === "add-cancel") { closeAdd(); return; }
  if (b.id === "add-save") {
    b.disabled = true;
    api("/api/memories", {method: "POST", body: JSON.stringify({text: $("add-text").value, tags: $("add-tags").value, rule: $("add-rule").checked})}).then(function () {
      closeAdd();
      loadItems().then(loadSettings);
    }).catch(function (err) { b.disabled = false; $("add-err").textContent = err.message; });
  }
});

/* housekeeping */
var hkGroups = [];
function hkBox(html) { $("hk").innerHTML = html; }
function hkCheck() {
  hkGroups = [];
  hkBox('<p class="muted small" style="margin:14px 0 0">Checking...</p>');
  api("/api/housekeep", {method: "POST", body: JSON.stringify({apply: false})}).then(function (d) {
    loadGemini();
    if (d.error) { hkBox('<p class="bad small" style="margin:14px 0 0">' + esc(d.error) + '</p>'); return; }
    if (!d.proposed || !d.proposed.length) { hkBox('<p class="muted small" style="margin:14px 0 0">' + esc(d.message || "No duplicates found.") + '</p>'); return; }
    hkGroups = d.proposed;
    hkBox(d.proposed.map(function (g) {
      var text = g.merged_text || g.keep_text;
      return '<div class="suggest"><b>' + esc(text) + '</b><small>Merges ' + (g.drop.length + 1) + ' memories into this one</small></div>';
    }).join("") +
    '<div class="row"><button class="btn" id="hk-fix">Fix Duplicate</button><button class="btn ghost" id="hk-cancel">Cancel</button></div>');
  }).catch(function (e) { hkBox('<p class="bad small" style="margin:14px 0 0">Error: ' + esc(e.message) + '</p>'); });
}
$("hk").addEventListener("click", function (e) {
  var b = e.target.closest ? e.target.closest("button") : null;
  if (!b) return;
  if (b.id === "hk-cancel") { hkGroups = []; hkBox(""); return; }
  if (b.id === "hk-fix") {
    b.disabled = true;
    api("/api/housekeep", {method: "POST", body: JSON.stringify({apply: true, groups: hkGroups})}).then(function (d) {
      hkGroups = [];
      if (d.error) { hkBox('<p class="bad small" style="margin:14px 0 0">' + esc(d.error) + '</p>'); return; }
      hkBox('<p class="ok small" style="margin:14px 0 0">Fixed. Removed ' + d.removed + ' duplicate' + (d.removed === 1 ? "" : "s") + '.</p>');
      loadItems().then(loadSettings);
    }).catch(function (err) { hkBox('<p class="bad small" style="margin:14px 0 0">Error: ' + esc(err.message) + '</p>'); });
  }
});
$("check").onclick = hkCheck;

/* backup */
document.querySelectorAll("[data-mode]").forEach(function (b) {
  b.onclick = function () {
    importMode = b.getAttribute("data-mode");
    document.querySelectorAll("[data-mode]").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
  };
});
$("exp").onclick = function () {
  fetch("/api/export").then(function (r) {
    if (!r.ok) throw new Error(r.status);
    return r.blob();
  }).then(function (b) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(b); a.download = "memories-backup.json"; a.click();
  }).catch(function (e) { $("msg").textContent = "Export failed: " + e.message; });
};
function doImport() {
  var f = $("file").files[0];
  if (!f) { $("msg").textContent = "Choose a JSON file first"; return; }
  f.text().then(function (t) {
    return fetch("/api/import?mode=" + importMode, {method: "POST", headers: {"content-type": "application/json"}, body: t});
  }).then(function (r) { return r.json(); }).then(function (d) {
    if (d.error) throw new Error(d.error);
    $("msg").textContent = "Imported " + d.imported + ". Total " + d.total + ".";
    loadItems().then(loadSettings);
  }).catch(function (e) { $("msg").textContent = "Import failed: " + e.message; });
}
/* delegated: the inline confirmation rebuilds the button, so a direct handler would be lost */
$("imp-wrap").addEventListener("click", function (e) {
  var b = e.target.closest ? e.target.closest("button") : null;
  if (!b || b.id !== "imp") return;
  if (!$("file").files[0]) { $("msg").textContent = "Choose a JSON file first"; return; }
  if (importMode === "replace") {
    askInline(b, "Replace all memories with this file? Rules are kept.", "Yes, replace", doImport);
  } else {
    doImport();
  }
});

/* install and service worker */
if (navigator.brave && /Android/i.test(navigator.userAgent)) { $("install-note").hidden = false; }
window.addEventListener("beforeinstallprompt", function (e) {
  e.preventDefault();
  installEvt = e;
  $("install").hidden = false;
});
window.addEventListener("appinstalled", function () {
  installEvt = null;
  $("install").hidden = true;
});
$("install").onclick = function () {
  if (!installEvt) return;
  installEvt.prompt();
  installEvt.userChoice.then(function () {}, function () {}).then(function () {
    installEvt = null;
    $("install").hidden = true;
  });
};
if ("serviceWorker" in navigator) {
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("/sw.js").catch(function () {});
  });
}

/* reveal on scroll and nav highlight */
var io = null;
if ("IntersectionObserver" in window) {
  io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); } });
  }, {threshold: 0.12});
  document.querySelectorAll(".reveal").forEach(function (el) { io.observe(el); });
} else {
  document.querySelectorAll(".reveal").forEach(function (el) { el.classList.add("in"); });
}
var navLinks = Array.prototype.slice.call(document.querySelectorAll("nav.top a"));
if ("IntersectionObserver" in window) {
  var spy = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (en.isIntersecting) navLinks.forEach(function (a) { a.classList.toggle("active", a.getAttribute("href") === "#" + en.target.id); });
    });
  }, {rootMargin: "-45% 0px -50% 0px"});
  document.querySelectorAll("#app header[id], #app section[id]").forEach(function (s) { spy.observe(s); });
}

fetch("/auth/status").then(function (r) { return r.json(); }).then(function (s) {
  if (s.loggedIn) showApp(); else showGate(s.setup);
});
</script>
</body>
</html>
`;

