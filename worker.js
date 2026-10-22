const MAX_LEN = 500;
const FALLBACK_MODELS = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash"];
const SESSION_DAYS = 30;
const PBKDF2_ITER = 100000;

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

async function gemini(env, prompt) {
  const key = await getConfig(env, "gemini_key");
  if (!key) return { error: "no Gemini key saved yet (Settings)" };
  const selected = await getConfig(env, "gemini_model");
  const order = [...new Set([selected, ...FALLBACK_MODELS].filter(Boolean))];
  let last = "no model tried";
  for (const model of order) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json" } }),
    });
    if (r.ok) {
      const d = await r.json();
      const text = d?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) return { text, model };
    }
    last = `${model}: HTTP ${r.status}`;
  }
  return { error: last };
}

async function housekeep(env, a) {
  const { results } = await env.DB.prepare(
    "SELECT id, text FROM memories WHERE tags NOT LIKE '%rules%' ORDER BY created DESC, rowid DESC LIMIT 200"
  ).all();
  if (!results.length) return { message: "no memories" };
  const prompt = 'You maintain a list of memories. Find groups that duplicate or contradict each other. Reply ONLY with JSON: {"groups":[{"keep":"id","drop":["id"],"merged_text":"...","reason":"..."}]}. If none, reply {"groups":[]}.\n\nMEMORIES:\n' + JSON.stringify(results);
  const g = await gemini(env, prompt);
  if (g.error) return { error: g.error };
  let groups;
  try {
    const s = g.text;
    groups = JSON.parse(s.slice(s.indexOf("{"), s.lastIndexOf("}") + 1)).groups || [];
  } catch {
    return { error: "model returned invalid JSON", model: g.model };
  }
  if (!a.apply) return { model: g.model, proposed: groups };
  const byId = new Map(results.map((m) => [m.id, m]));
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
  return { model: g.model, removed: drop.size };
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
    case "housekeep": return housekeep(env, a);
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
      serverInfo: { name: "my-memory", version: "2.0.0" } });
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
  const key = await getConfig(env, "gemini_key");
  const model = await getConfig(env, "gemini_model");
  const last = await env.DB.prepare("SELECT MAX(last) AS last FROM client_stats").first();
  return {
    gemini_key_set: !!key,
    gemini_key_tail: key ? key.slice(-4) : "",
    gemini_model: model || "",
    last_call: last && last.last ? last.last : "",
  };
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
  if (p === "/api/settings" && m === "POST") {
    const b = await request.json().catch(() => ({}));
    if (typeof b.gemini_key === "string" && b.gemini_key.trim()) await setConfig(env, "gemini_key", b.gemini_key.trim());
    if (typeof b.gemini_model === "string" && b.gemini_model.trim()) await setConfig(env, "gemini_model", b.gemini_model.trim());
    return json(await settings(env));
  }
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
  if (p === "/api/gemini/models" && m === "GET") {
    const key = await getConfig(env, "gemini_key");
    if (!key) return json({ error: "save your Gemini key first" }, 400);
    return json(await listGeminiModels(key));
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
    return json(await housekeep(env, { apply: !!body.apply }));
  }
  return json({ error: "no such api route" }, 404);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
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

const DASHBOARD = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Memory dashboard</title>
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
  <h2>Gemini</h2>
  <div class="row"><input id="gem-key" type="password" placeholder="Paste Gemini API key" class="wide"><button id="gem-save">Save key</button></div>
  <p class="muted" id="gem-state"></p>
  <div class="row"><select id="model" class="wide"><option value="">(load models first)</option></select><button id="gem-models">Load models</button><button id="gem-model-save">Save model</button></div>
  <p class="muted" id="gem-msg"></p>
</section>

<section>
  <h2>Memories</h2>
  <div class="row"><input id="q" placeholder="Search" class="wide"><button id="go">Search</button></div>
  <p class="muted" id="count"></p><div id="items"></div>
</section>

<section>
  <h2>Housekeeping (Gemini)</h2>
  <div class="row"><button id="check">Check duplicates</button><button id="apply">Apply proposed changes</button></div>
  <pre id="hk" class="muted"></pre>
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
function refreshAll() { loadStatus(); loadServices(); loadSettings(); loadStats(); }
function startAutoRefresh() {
  stopAutoRefresh();
  refreshTimer = setInterval(function () { loadStatus(); loadServices(); loadSettings(); }, 20000);
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
    $("gem-state").textContent = s.gemini_key_set ? "Saved key ends in " + s.gemini_key_tail : "No Gemini key saved yet";
    setModelOption(s.gemini_model);
    $("last-call").textContent = s.last_call ? "Last request from a client: " + s.last_call : "No client has connected yet";
  }).catch(function (e) { $("gem-msg").textContent = e.message; });
}
function setModelOption(name) {
  var sel = $("model");
  if (!name) return;
  if (!sel.querySelector('option[value="' + name + '"]')) {
    var o = document.createElement("option"); o.value = name; o.textContent = name; sel.appendChild(o);
  }
  sel.value = name;
}
$("test").onclick = function () { loadStatus(); };
$("gem-save").onclick = function () {
  var k = $("gem-key").value.trim();
  if (!k) { $("gem-msg").textContent = "Paste a key first."; return; }
  api("/api/settings", {method: "POST", body: JSON.stringify({gemini_key: k})}).then(function () {
    $("gem-key").value = ""; $("gem-msg").textContent = "Key saved."; loadSettings();
  }).catch(function (e) { $("gem-msg").textContent = e.message; });
};
$("gem-models").onclick = function () {
  $("gem-msg").textContent = "Loading models...";
  api("/api/gemini/models").then(function (d) {
    var sel = $("model"), cur = sel.value;
    sel.innerHTML = "";
    d.models.forEach(function (n) { var o = document.createElement("option"); o.value = n; o.textContent = n; sel.appendChild(o); });
    if (cur) sel.value = cur;
    $("gem-msg").textContent = d.models.length + " models loaded.";
  }).catch(function (e) { $("gem-msg").textContent = e.message; });
};
$("gem-model-save").onclick = function () {
  var v = $("model").value;
  if (!v) { $("gem-msg").textContent = "Load models and pick one first."; return; }
  api("/api/settings", {method: "POST", body: JSON.stringify({gemini_model: v})}).then(function () {
    $("gem-msg").textContent = "Model saved: " + v;
  }).catch(function (e) { $("gem-msg").textContent = e.message; });
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
function hk(apply) {
  $("hk").textContent = "Working...";
  api("/api/housekeep", {method: "POST", body: JSON.stringify({apply: apply})})
    .then(function (d) { $("hk").textContent = JSON.stringify(d, null, 2); loadItems(); loadStats(); })
    .catch(function (e) { $("hk").textContent = "Error: " + e.message; });
}
$("items").addEventListener("click", function (e) {
  var id = e.target.getAttribute("data-id");
  if (!id || !confirm("Delete this memory?")) return;
  api("/api/memories/" + id, {method: "DELETE"}).then(loadItems).then(loadStats);
});
$("go").onclick = loadItems;
$("check").onclick = function () { hk(false); };
$("apply").onclick = function () { if (confirm("Apply the proposed changes? This edits and deletes memories.")) hk(true); };
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

fetch("/auth/status").then(function (r) { return r.json(); }).then(function (s) {
  if (s.loggedIn) showApp(); else showGate(s.setup);
});
</script></body></html>`;
