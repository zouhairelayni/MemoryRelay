const MAX_LEN = 500;
const FALLBACK_MODELS = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash"];
const SESSION_DAYS = 30;
const PBKDF2_ITER = 100000;
const MAX_CALLS = 8; // Workers subrequest budget per request
const RETRYABLE = new Set([500, 502, 503, 504]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM services").first();
  if (!count.n) {
    const legacy = await getConfig(env, "connector_secret");
    await env.DB.prepare("INSERT INTO services (id, name, secret, created) VALUES (?, ?, ?, ?)")
      .bind(newId(), "Claude", legacy || randomHex(24), now()).run();
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

async function forget(env, a) {
  const row = await env.DB.prepare("SELECT tags FROM memories WHERE id = ?").bind(String(a.memory_id)).first();
  if (!row) return "not found";
  if (isProtected(row.tags)) return "protected: rules memories cannot be deleted through the connector";
  await env.DB.prepare("DELETE FROM memories WHERE id = ?").bind(String(a.memory_id)).run();
  return "deleted";
}

async function listGeminiModels(key) {
  const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=100", {
    headers: { "x-goog-api-key": key },
  });
  if (!r.ok) return { error: "Gemini returned HTTP " + r.status + " (check the key)" };
  const d = await r.json();
  const models = (d.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent") && /gemini/.test(m.name))
    .map((m) => m.name.replace(/^models\//, ""));
  return { models };
}

async function callGemini(key, model, prompt) {
  return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json" } }),
  });
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
        log.push(`${tag}: HTTP ${r.status}${RETRYABLE.has(r.status) ? " (after retry)" : ""}`);
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
  for (const grp of groups) {
    if (!byId.has(grp.keep)) continue;
    for (const d of grp.drop || []) if (d !== grp.keep && byId.has(d)) drop.add(d);
    const merged = String(grp.merged_text || "").trim();
    if (merged && merged.length <= MAX_LEN) {
      stmts.push(env.DB.prepare(
        "UPDATE memories SET history = json_insert(history, '$[#]', json_object('text', text, 'time', updated)), text = ?, updated = ? WHERE id = ?"
      ).bind(merged, now(), grp.keep));
    }
  }
  for (const d of drop) stmts.push(env.DB.prepare("DELETE FROM memories WHERE id = ?").bind(d));
  await runAll(env, stmts);
  return { model, key: keyLabel, removed: drop.size };
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

function classify(ua) {
  const u = ua.toLowerCase();
  if (u.includes("claude") || u.includes("anthropic")) return "Claude";
  if (u.includes("openai") || u.includes("chatgpt")) return "ChatGPT";
  if (u.includes("cursor")) return "Cursor";
  if (u.includes("opencode")) return "OpenCode";
  if (u.includes("curl")) return "curl";
  return ua.slice(0, 40) || "unknown";
}

async function meter(env, request, res, serviceId) {
  const client = classify(request.headers.get("user-agent") || "");
  const bin = Number(request.headers.get("content-length") || 0);
  const bout = (await res.clone().arrayBuffer()).byteLength;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO client_stats (client, requests, bytes_in, bytes_out, last) VALUES (?, 1, ?, ?, ?)
       ON CONFLICT(client) DO UPDATE SET requests = requests + 1, bytes_in = bytes_in + excluded.bytes_in,
       bytes_out = bytes_out + excluded.bytes_out, last = excluded.last`
    ).bind(client, bin, bout, now()),
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

async function handleMcp(request, env) {
  const msg = await request.json();
  const { id, method } = msg;
  const params = msg.params || {};
  if (!method) return json({ jsonrpc: "2.0", id: id ?? null, error: { code: -32600, message: "invalid request" } }, 400);
  if (id === undefined) return new Response(null, { status: 202 });
  const ok = (result) => json({ jsonrpc: "2.0", id, result });
  if (method === "initialize") {
    return ok({ protocolVersion: params.protocolVersion || "2025-06-18", capabilities: { tools: {} },
      serverInfo: { name: "my-memory", version: "2.1.0" } });
  }
  if (method === "ping") return ok({});
  if (method === "tools/list") return ok({ tools: TOOLS });
  if (method === "tools/call") {
    try {
      const out = await callTool(env, params.name, params.arguments || {});
      return ok({ content: [{ type: "text", text: typeof out === "string" ? out : JSON.stringify(out, null, 2) }] });
    } catch (e) {
      return ok({ content: [{ type: "text", text: "error: " + e.message }], isError: true });
    }
  }
  return json({ jsonrpc: "2.0", id, error: { code: -32601, message: "method not found" } });
}

async function settings(env) {
  const last = await env.DB.prepare("SELECT MAX(last) AS last FROM client_stats").first();
  return { last_call: last && last.last ? last.last : "" };
}

async function listServices(env) {
  const { results } = await env.DB.prepare("SELECT * FROM services ORDER BY created").all();
  return results.map((s) => ({
    id: s.id, name: s.name, created: s.created, last_seen: s.last_seen,
    revoked: !!s.revoked, url: "/mcp/" + s.secret,
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
  if (p === "/api/connector/test" && m === "POST") return json(await testConnector(env, request));

  if (p === "/api/gemini" && m === "GET") return json(await geminiState(env));
  if (p === "/api/gemini" && m === "POST") {
    const out = await geminiOp(env, request);
    return json(out, out.error ? 400 : 200);
  }
  if (p === "/api/gemini/models" && m === "GET") {
    const row = await env.DB.prepare("SELECT key FROM gemini_keys WHERE enabled = 1 LIMIT 1").first();
    if (!row) return json({ error: "add an enabled key first" }, 400);
    return json(await listGeminiModels(row.key));
  }

  if (p === "/api/memories" && m === "GET") {
    const words = (url.searchParams.get("q") || "").toLowerCase().split(" ").filter(Boolean);
    const where = words.length ? "WHERE " + words.map(() => "(text || ' ' || tags) LIKE ?").join(" AND ") : "";
    const { results } = await env.DB.prepare(
      `SELECT id, text, tags, created AS time FROM memories ${where} ORDER BY created DESC, rowid DESC LIMIT 500`
    ).bind(...words.map((w) => `%${w}%`)).all();
    return json({ count: results.length, items: results });
  }
  if (p.startsWith("/api/memories/") && m === "DELETE") {
    const r = await env.DB.prepare("DELETE FROM memories WHERE id = ? AND tags NOT LIKE '%rules%'").bind(p.split("/").pop()).run();
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
    const { results } = await env.DB.prepare("SELECT * FROM client_stats ORDER BY requests DESC").all();
    return json({ clients: results });
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
        const res = await handleMcp(request, env);
        ctx.waitUntil(meter(env, request, res, svc.id));
        return res;
      }
      if (url.pathname === "/") return Response.redirect(url.origin + "/dashboard", 302);
      if (url.pathname === "/dashboard") {
        return new Response(DASHBOARD, { headers: { "content-type": "text/html; charset=utf-8" } });
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
  icons: [
    { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
  ]
});
// Service worker: network-first for pages, cache fallback when offline.
// API, auth and MCP requests are never cached.
const SW_JS = `const CACHE = "memory-relay-v1";
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

const DASHBOARD = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Memory dashboard</title>
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#13161e">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Memory">
<link rel="icon" type="image/png" href="/icon-192.png">
<link rel="apple-touch-icon" href="/icon-192.png">
<style>
body{margin:0;font:15px system-ui,sans-serif;background:#13161e;color:#ece7dc;padding:18px}
h1{font:400 26px Georgia,serif;margin:0 0 14px}
section{background:#1d2230;border:1px solid #333a49;border-radius:14px;padding:16px;margin-bottom:14px}
h2{font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#d9b26e;margin:0 0 10px}
input,select,button{font:inherit;border-radius:10px;border:1px solid #333a49;background:#262d3d;color:#ece7dc;padding:9px 12px}
button{cursor:pointer}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px}
.item{border-top:1px solid #333a49;padding:10px 0}
.muted{color:#9aa3b5;font-size:13px}
.ok{color:#8fd3a8}.bad{color:#e38b81}
table{width:100%;border-collapse:collapse;font-size:14px}
td,th{padding:6px;text-align:left;border-bottom:1px solid #333a49;vertical-align:top}
.del{background:none;border:0;color:#e38b81;padding:0 4px}
.svc{border-top:1px solid #333a49;padding:12px 0}
.svc small{display:block;color:#9aa3b5;font-size:12px;word-break:break-all}
pre{white-space:pre-wrap;font-size:13px;color:#c9d1df}
.wide{flex:1;min-width:0}
#gate{max-width:420px;margin:40px auto}
</style></head><body>
<h1>Memory dashboard</h1>
<div id="install-row" class="row" style="display:none;margin:0 0 14px"><button id="install">Install app</button></div>

<section id="gate" style="display:none">
  <h2 id="gate-title">Log in</h2>
  <div class="row"><input id="email" type="email" placeholder="Email" class="wide"></div>
  <div class="row"><input id="password" type="password" placeholder="Password (8+ characters)" class="wide"></div>
  <div class="row"><button id="gate-btn">Log in</button></div>
  <p class="muted" id="gate-hint"></p>
  <p class="bad" id="gate-err"></p>
</section>

<div id="app" style="display:none">
<section>
  <div class="row" style="justify-content:space-between"><h2 style="margin:0">Live status</h2><button id="logout">Log out</button></div>
  <div class="row"><span id="status-dot" class="bad">&#9679;</span><span id="status-text">Checking...</span></div>
  <p class="muted" id="status-meta"></p>
  <p class="muted" id="last-call"></p>
  <div class="row"><button id="test">Check now</button></div>
</section>

<section>
  <h2>Connected services</h2>
  <p class="muted">Each service has its own address. Revoking one stops only that service.</p>
  <div class="row"><input id="svc-name" placeholder="Service name, e.g. Claude" class="wide"><button id="svc-add">Add service</button></div>
  <p class="muted" id="svc-msg"></p>
  <div id="services" style="margin-top:8px"></div>
</section>

<section>
  <h2>Gemini keys (rotated)</h2>
  <p class="muted">Each request starts from the next key. A key that hits 429 cools down; a rejected key is disabled.</p>
  <div class="row"><input id="gk-label" placeholder="Label" style="width:90px"><input id="gk-key" type="password" placeholder="API key" class="wide"><button id="gk-add">Add key</button></div>
  <div id="gk-list"></div>
</section>

<section>
  <h2>Gemini models (tried in order)</h2>
  <div class="row"><input id="gm-name" list="gm-opts" placeholder="Model name" class="wide"><datalist id="gm-opts"></datalist><button id="gm-add">Add</button><button id="gm-load">Browse</button></div>
  <div id="gm-list"></div>
  <p class="muted" id="gm-msg"></p>
</section>

<section>
  <h2>Memories</h2>
  <div class="row"><input id="q" placeholder="Search" class="wide"><button id="go">Search</button></div>
  <p class="muted" id="count"></p><div id="items"></div>
</section>

<section>
  <h2>Housekeeping (Gemini)</h2>
  <div class="row"><button id="check">Check duplicates</button></div>
  <div id="hk"></div>
</section>

<section>
  <h2>Transfers by client</h2>
  <div id="stats" class="muted">Loading...</div>
</section>

<section>
  <h2>Backup and import</h2>
  <div class="row"><button id="exp">Download backup</button></div>
  <div class="row"><input type="file" id="file" accept="application/json"><select id="mode"><option value="merge">Merge (add new)</option><option value="replace">Replace all</option></select><button id="imp">Import</button></div>
  <p class="muted" id="msg"></p>
</section>
</div>

<script>
var gateMode = "login";
var refreshTimer = null;
function $(id) { return document.getElementById(id); }
function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]; }); }
function fmt(n) { return n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(1) + " KB" : (n / 1048576).toFixed(2) + " MB"; }
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
function refreshAll() { loadStatus(); loadServices(); loadSettings(); loadGemini(); loadStats(); }
function startAutoRefresh() {
  stopAutoRefresh();
  refreshTimer = setInterval(function () { loadStatus(); loadServices(); loadSettings(); loadGemini(); }, 20000);
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

function loadStatus() {
  return api("/api/connector/test", {method: "POST"}).then(function (d) {
    $("status-dot").className = d.live ? "ok" : "bad";
    if (d.message) {
      $("status-text").textContent = "Not live: " + d.message;
    } else {
      $("status-text").textContent = d.live ? "Live" : "Not responding (HTTP " + d.http + ")";
    }
    $("status-meta").textContent = (d.service ? "Tested via " + d.service + ". " : "") +
      (d.checked ? "Checked " + d.checked + " (auto-refresh every 20 s)." : "");
  }).catch(function (e) { $("status-text").textContent = e.message; });
}

function loadServices() {
  return api("/api/services").then(function (d) {
    var base = location.origin;
    if (!d.services.length) { $("services").innerHTML = '<p class="muted">No services yet.</p>'; return; }
    $("services").innerHTML = d.services.map(function (s) {
      var state = s.revoked ? '<span class="bad">Revoked</span>' : '<span class="ok">Active</span>';
      var seen = s.last_seen ? "Last seen " + esc(s.last_seen) : "Never used";
      var controls = s.revoked ? "" :
        '<div class="row"><button data-copy="' + esc(base + s.url) + '">Copy address</button>' +
        '<button class="del" data-revoke="' + esc(s.id) + '" data-name="' + esc(s.name) + '">Revoke</button></div>';
      return '<div class="svc"><div><b>' + esc(s.name) + '</b> &middot; ' + state + '</div>' +
        '<small>ID: ' + esc(s.id) + ' &middot; ' + seen + ' &middot; Created ' + esc(s.created) + '</small>' + controls + '</div>';
    }).join("");
  }).catch(function (e) { $("services").textContent = "Error: " + e.message; });
}
$("services").addEventListener("click", function (e) {
  var copy = e.target.getAttribute("data-copy");
  var rev = e.target.getAttribute("data-revoke");
  if (copy) {
    $("svc-msg").textContent = copyText(copy) ? "Address copied." : "Could not copy. Long-press the address to copy it manually.";
    return;
  }
  if (rev) {
    if (!confirm("Revoke " + e.target.getAttribute("data-name") + "? Its address will stop working.")) return;
    api("/api/services/" + rev + "/revoke", {method: "POST"}).then(function () {
      $("svc-msg").textContent = "Revoked.";
      loadServices(); loadStatus();
    }).catch(function (err) { $("svc-msg").textContent = err.message; });
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
    loadServices(); loadStatus();
  }).catch(function (e) { $("svc-msg").textContent = e.message; });
};

function loadSettings() {
  return api("/api/settings").then(function (s) {
    $("last-call").textContent = s.last_call ? "Last request from a client: " + s.last_call : "No client has connected yet";
  }).catch(function () {});
}
$("test").onclick = function () { loadStatus(); };

function renderGemini(s) {
  $("gk-list").innerHTML = s.keys.map(function (k) {
    return '<div class="item">' + esc(k.label) + ' ....' + esc(k.tail) + ' <span class="' + (k.enabled ? "ok" : "bad") + '">' + (k.enabled ? "enabled" : "disabled") + '</span> ' +
      '<div class="row"><button data-op="toggle_key" data-id="' + esc(k.id) + '">Toggle</button>' +
      '<button class="del" data-op="delete_key" data-id="' + esc(k.id) + '">Delete</button></div>' +
      (k.cooling.length ? '<div class="muted">cooling: ' + k.cooling.map(esc).join(", ") + '</div>' : "") + "</div>";
  }).join("") || '<p class="muted">No keys yet.</p>';
  $("gm-list").innerHTML = s.models.map(function (m, i) {
    var n = esc(m.name);
    return '<div class="item">' + (i + 1) + '. ' + n + ' <span class="' + (m.enabled ? "ok" : "bad") + '">' + (m.enabled ? "on" : "off") + '</span>' +
      '<div class="row"><button data-op="move_model" data-name="' + n + '" data-dir="-1">Up</button>' +
      '<button data-op="move_model" data-name="' + n + '" data-dir="1">Down</button>' +
      '<button data-op="toggle_model" data-name="' + n + '">Toggle</button>' +
      '<button class="del" data-op="delete_model" data-name="' + n + '">Delete</button></div></div>';
  }).join("") || '<p class="muted">No models yet.</p>';
}
function loadGemini() {
  return api("/api/gemini").then(renderGemini).catch(function (e) { $("gm-msg").textContent = e.message; });
}
function gop(body) {
  return api("/api/gemini", {method: "POST", body: JSON.stringify(body)}).then(function (s) {
    $("gm-msg").textContent = "";
    renderGemini(s);
  }).catch(function (e) { $("gm-msg").textContent = e.message; });
}
document.addEventListener("click", function (e) {
  var op = e.target.getAttribute("data-op");
  if (!op) return;
  if (op.indexOf("delete") === 0 && !confirm("Delete this?")) return;
  gop({op: op, id: e.target.getAttribute("data-id"), name: e.target.getAttribute("data-name"), dir: e.target.getAttribute("data-dir")});
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

function loadItems() {
  api("/api/memories?q=" + encodeURIComponent($("q").value)).then(function (d) {
    $("count").textContent = d.count + " memories";
    $("items").innerHTML = d.items.map(function (m) {
      return '<div class="item"><div>' + esc(m.text) + '</div><small class="muted">' + esc(m.time) + " · " + esc(m.tags) + " · " + esc(m.id) +
        '</small> <button class="del" data-id="' + esc(m.id) + '">delete</button></div>';
    }).join("");
  }).catch(function (e) { $("items").textContent = "Error: " + e.message; });
}
function loadStats() {
  api("/api/stats").then(function (d) {
    if (!d.clients.length) { $("stats").textContent = "No requests yet."; return; }
    $("stats").innerHTML = "<table><tr><th>Client</th><th>Requests</th><th>In</th><th>Out</th><th>Last</th></tr>" +
      d.clients.map(function (c) {
        return "<tr><td>" + esc(c.client) + "</td><td>" + c.requests + "</td><td>" + fmt(c.bytes_in) + "</td><td>" + fmt(c.bytes_out) + "</td><td>" + esc(c.last) + "</td></tr>";
      }).join("") + "</table>";
  }).catch(function (e) { $("stats").textContent = "Error: " + e.message; });
}
var hkGroups = [];
function hkBox(html) { $("hk").innerHTML = html; }
function hkCheck() {
  hkGroups = [];
  hkBox('<p class="muted">Checking...</p>');
  api("/api/housekeep", {method: "POST", body: JSON.stringify({apply: false})}).then(function (d) {
    loadStats(); loadGemini();
    if (d.error) { hkBox('<p class="bad">' + esc(d.error) + '</p>'); return; }
    if (!d.proposed || !d.proposed.length) { hkBox('<p class="muted">' + esc(d.message || "No duplicates found.") + '</p>'); return; }
    hkGroups = d.proposed;
    hkBox(d.proposed.map(function (g) {
      var text = g.merged_text || g.keep_text;
      return '<div class="item"><div>' + esc(text) + '</div><small class="muted">Merges ' + (g.drop.length + 1) + ' memories into this one</small></div>';
    }).join("") +
    '<div class="row"><button id="hk-fix">Fix Duplicate</button><button id="hk-cancel">Cancel</button></div>');
  }).catch(function (e) { hkBox('<p class="bad">Error: ' + esc(e.message) + '</p>'); });
}
$("hk").addEventListener("click", function (e) {
  if (e.target.id === "hk-cancel") { hkGroups = []; hkBox(""); return; }
  if (e.target.id === "hk-fix") {
    e.target.disabled = true;
    api("/api/housekeep", {method: "POST", body: JSON.stringify({apply: true, groups: hkGroups})}).then(function (d) {
      hkGroups = [];
      if (d.error) { hkBox('<p class="bad">' + esc(d.error) + '</p>'); return; }
      hkBox('<p class="ok">Fixed. Removed ' + d.removed + ' duplicate' + (d.removed === 1 ? "" : "s") + '.</p>');
      loadItems(); loadStats();
    }).catch(function (err) { hkBox('<p class="bad">Error: ' + esc(err.message) + '</p>'); });
  }
});
$("items").addEventListener("click", function (e) {
  var id = e.target.getAttribute("data-id");
  if (!id || !confirm("Delete this memory?")) return;
  api("/api/memories/" + id, {method: "DELETE"}).then(loadItems).then(loadStats);
});
$("go").onclick = loadItems;
$("check").onclick = hkCheck;
$("exp").onclick = function () {
  fetch("/api/export").then(function (r) {
    if (!r.ok) throw new Error(r.status);
    return r.blob();
  }).then(function (b) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(b); a.download = "memories-backup.json"; a.click();
  }).catch(function (e) { $("msg").textContent = "Export failed: " + e.message; });
};
$("imp").onclick = function () {
  var f = $("file").files[0];
  if (!f) { $("msg").textContent = "Choose a JSON file first"; return; }
  if ($("mode").value === "replace" && !confirm("Replace ALL memories with this file?")) return;
  f.text().then(function (t) {
    return fetch("/api/import?mode=" + $("mode").value, {method: "POST", headers: {"content-type": "application/json"}, body: t});
  }).then(function (r) { return r.json(); }).then(function (d) {
    if (d.error) throw new Error(d.error);
    $("msg").textContent = "Imported " + d.imported + ". Total " + d.total + ".";
    loadItems();
  }).catch(function (e) { $("msg").textContent = "Import failed: " + e.message; });
};

var installEvt = null;
window.addEventListener("beforeinstallprompt", function (e) {
  e.preventDefault();
  installEvt = e;
  $("install-row").style.display = "";
});
window.addEventListener("appinstalled", function () {
  installEvt = null;
  $("install-row").style.display = "none";
});
$("install").onclick = function () {
  if (!installEvt) return;
  installEvt.prompt();
  installEvt.userChoice.then(function () {}, function () {}).then(function () {
    installEvt = null;
    $("install-row").style.display = "none";
  });
};
if ("serviceWorker" in navigator) {
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("/sw.js").catch(function () {});
  });
}

fetch("/auth/status").then(function (r) { return r.json(); }).then(function (s) {
  if (s.loggedIn) showApp(); else showGate(s.setup);
});
</script></body></html>`;
