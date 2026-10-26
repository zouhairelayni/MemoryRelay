// OAuth 2.1 authorization for MCP (the standard way custom connectors sign in):
//   discovery  GET /.well-known/oauth-protected-resource, /.well-known/oauth-authorization-server
//   register   POST /oauth/register           (dynamic client registration, RFC 7591)
//   sign in    GET/POST /oauth/authorize      (the owner approves with their password, PKCE S256 required)
//   tokens     POST /oauth/token              (authorization_code and refresh_token, refresh tokens rotate)
//   revoke     POST /oauth/revoke
// Every approval is tied to ONE connection, so each agent has its own access level, statistics and kill switch.
// Only SHA-256 hashes of codes and tokens are stored.
import { ACCESS, ACCESS_LABEL } from "./constants.js";
import { clearFails, hashPassword, locked, recordFail, sameText, sha256Hex } from "./auth.js";
import { rateLimit } from "./limits.js";
import { createService } from "./services.js";
import { clip, json, now, randomHex } from "./util.js";

const ACCESS_TTL = 3600, REFRESH_TTL = 30 * 86400, CODE_TTL = 300; // seconds
const MAX_CLIENTS = 100;
export const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, mcp-protocol-version, mcp-session-id",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-expose-headers": "www-authenticate",
  "access-control-max-age": "600",
};
const NOT_URI_SCHEMES = new Set(["javascript:", "data:", "vbscript:", "file:", "ftp:", "about:", "blob:", "ws:", "wss:"]);
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ip = (request) => request.headers.get("cf-connecting-ip") || "unknown";

export const isOauthPath = (p) => p.startsWith("/oauth/") || p.startsWith("/.well-known/");
const oerr = (error, description, status = 400) => json({ error, error_description: description }, status, null, { ...CORS, pragma: "no-cache" });

export function validRedirect(u) {
  if (typeof u !== "string" || u.length > 500) return false;
  let x;
  try { x = new URL(u); } catch { return false; }
  if (x.hash) return false;
  if (x.protocol === "https:") return true;
  if (x.protocol === "http:") return ["localhost", "127.0.0.1", "[::1]"].includes(x.hostname); // loopback only
  return /^[a-z][a-z0-9+.-]*:$/.test(x.protocol) && !NOT_URI_SCHEMES.has(x.protocol);       // app schemes such as claude://
}

async function readParams(request) {
  const text = await request.text();
  if (text.length > 20000) return null;
  if ((request.headers.get("content-type") || "").includes("json")) {
    try { const v = JSON.parse(text); return v && typeof v === "object" && !Array.isArray(v) ? v : null; } catch { return null; }
  }
  return Object.fromEntries(new URLSearchParams(text));
}

async function clientById(env, id) {
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(String(id || ""))) return null;
  const c = await env.DB.prepare("SELECT * FROM oauth_clients WHERE id = ?").bind(id).first();
  return c ? { ...c, uris: JSON.parse(c.redirect_uris) } : null;
}

// ---------- discovery ----------
function metadata(url, p) {
  const o = url.origin;
  if (p.startsWith("/.well-known/oauth-protected-resource")) {
    return { resource: o + "/mcp", authorization_servers: [o], bearer_methods_supported: ["header"],
      scopes_supported: ACCESS.map((a) => "memory:" + a), resource_name: "Memory Relay" };
  }
  return { issuer: o, authorization_endpoint: o + "/oauth/authorize", token_endpoint: o + "/oauth/token",
    registration_endpoint: o + "/oauth/register", revocation_endpoint: o + "/oauth/revoke",
    response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    scopes_supported: ACCESS.map((a) => "memory:" + a), authorization_response_iss_parameter_supported: true };
}

// ---------- registration ----------
async function register(request, env) {
  if (!(await rateLimit(env, "oauth-reg:" + ip(request), 20, 3600e3)).ok) return oerr("temporarily_unavailable", "too many registrations, try later", 429);
  const b = await readParams(request);
  if (!b) return oerr("invalid_client_metadata", "send a JSON object");
  const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris : [];
  if (!uris.length || uris.length > 5 || !uris.every(validRedirect)) return oerr("invalid_redirect_uri", "redirect_uris must be 1 to 5 https, loopback or app-scheme addresses without a fragment");
  let n = await env.DB.prepare("SELECT COUNT(*) AS n FROM oauth_clients").first();
  if (n.n >= MAX_CLIENTS / 2) { // drop registrations that never finished sign-in, so strangers cannot fill the table
    const old = new Date(Date.now() - 3600e3).toISOString().slice(0, 16).replace("T", " ");
    await env.DB.prepare("DELETE FROM oauth_clients WHERE created < ? AND id NOT IN (SELECT client_id FROM oauth_tokens) AND id NOT IN (SELECT client_id FROM oauth_codes)").bind(old).run();
    n = await env.DB.prepare("SELECT COUNT(*) AS n FROM oauth_clients").first();
  }
  if (n.n >= MAX_CLIENTS) return oerr("temporarily_unavailable", "too many registered apps; the owner must clear old ones", 503);
  const method = String(b.token_endpoint_auth_method || "none");
  const confidential = method === "client_secret_post" || method === "client_secret_basic";
  const secret = confidential ? "mrs_" + randomHex(24) : "";
  const id = "mrc_" + randomHex(12), name = clip(b.client_name || "MCP app", 80).replace(/[\u0000-\u001f]/g, "");
  await env.DB.prepare("INSERT INTO oauth_clients (id, name, redirect_uris, secret_hash, created) VALUES (?, ?, ?, ?, ?)")
    .bind(id, name, JSON.stringify(uris), secret ? await sha256Hex(secret) : "", now()).run();
  return json({ client_id: id, client_name: name, redirect_uris: uris, grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"], token_endpoint_auth_method: confidential ? method : "none", client_id_issued_at: Math.floor(Date.now() / 1000),
    ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}) }, 201, null, CORS);
}

// ---------- authorize (the owner approves) ----------
const PAGE_HEADERS = {
  "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-frame-options": "DENY", "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
};
const page = (title, inner, status = 200) => new Response(
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${esc(title)}</title><style>
:root{--bg:#F6F3EC;--card:#FFFFFF;--ink:#171C26;--ink2:#505867;--line:#E1DBCF;--accent:#1B6B64;--soft:#E3F0EE;--rose:#A4493F}
@media(prefers-color-scheme:dark){:root{--bg:#10131A;--card:#181C26;--ink:#EEEAE0;--ink2:#B3B0A7;--line:#2C3342;--accent:#62C7BC;--soft:#17332F;--rose:#E58C82}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:20px;background:var(--bg);color:var(--ink);font:16px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.c{width:100%;max-width:440px;background:var(--card);border:1px solid var(--line);border-radius:22px;padding:28px;box-shadow:0 24px 60px -30px rgba(0,0,0,.35)}
.logo{width:48px;height:48px;border-radius:14px;background:var(--soft);color:var(--accent);display:grid;place-items:center;margin-bottom:16px}
h1{font:600 22px/1.2 ui-serif,Georgia,serif;margin:0 0 6px}p{margin:0 0 14px;color:var(--ink2);font-size:15px}b{color:var(--ink)}
label{display:block;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink2);margin:14px 0 6px}
select,input{width:100%;font:inherit;color:var(--ink);background:transparent;border:1px solid var(--line);border-radius:12px;padding:11px 12px}
select:focus,input:focus{outline:2px solid var(--accent);outline-offset:1px}
.row{display:flex;gap:10px;margin-top:20px}button{flex:1;font:600 15px inherit;font-family:inherit;border-radius:999px;padding:12px 16px;cursor:pointer;border:1px solid var(--ink);background:var(--ink);color:var(--bg)}
button.g{background:transparent;color:var(--ink);border-color:var(--line)}.err{color:var(--rose);font-size:14px;margin:12px 0 0}.fine{font-size:13px;color:var(--ink2);margin-top:16px}
</style></head><body><main class="c"><div class="logo"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 4.5 6v5.5c0 4.4 3.1 8.3 7.5 9.5 4.4-1.2 7.5-5.1 7.5-9.5V6L12 3Z"/><path d="m9 12 2.2 2.2L15.5 10"/></svg></div>${inner}</main></body></html>`,
  { status, headers: PAGE_HEADERS });

// Reads and checks the authorize parameters. Returns { client, p } or { error }.
async function authParams(env, src) {
  const g = (k) => String(src.get ? (src.get(k) ?? "") : (src[k] ?? ""));
  const client = await clientById(env, g("client_id"));
  if (!client) return { error: "This app is not registered. Remove the connector and add it again." };
  const redirect_uri = g("redirect_uri");
  if (!client.uris.includes(redirect_uri)) return { error: "The return address does not match the one this app registered." };
  const p = { client_id: client.id, redirect_uri, state: g("state").slice(0, 500), code_challenge: g("code_challenge"), code_challenge_method: g("code_challenge_method"), response_type: g("response_type") || "code" };
  if (p.response_type !== "code") return { client, p, redirect: "unsupported_response_type" };
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(p.code_challenge) || g("code_challenge_method") !== "S256") return { client, p, redirect: "invalid_request" };
  return { client, p };
}

const back = (p, params) => {
  const u = new URL(p.redirect_uri);
  for (const [k, v] of Object.entries(params)) if (v !== "" && v != null) u.searchParams.set(k, v);
  return new Response(null, { status: 302, headers: { location: u.toString(), "cache-control": "no-store", "referrer-policy": "no-referrer" } });
};

async function consent(env, url, client, p, error = "") {
  const { results } = await env.DB.prepare("SELECT id, name, access FROM services WHERE revoked = 0 ORDER BY created").all();
  const opts = results.map((s) => `<option value="${esc(s.id)}">${esc(s.name)} (${esc(ACCESS_LABEL[s.access] || "Full access")})</option>`).join("");
  const hidden = ["client_id", "redirect_uri", "state", "code_challenge", "code_challenge_method"].map((k) => `<input type="hidden" name="${k}" value="${esc(p[k])}">`).join("");
  let host = ""; try { host = new URL(p.redirect_uri).host || new URL(p.redirect_uri).protocol; } catch { /* shown empty */ }
  return page("Allow access", `<h1>Allow <b>${esc(client.name)}</b> to use your memory?</h1>
<p>It will get its own connection with its own access level and statistics. You can revoke it at any time. It returns to <b>${esc(host)}</b>.</p>
<form method="post" action="/oauth/authorize" autocomplete="off">${hidden}
<label for="service">Connection</label><select id="service" name="service">${opts}<option value="__new">New connection for ${esc(client.name)}</option></select>
<label for="name">Name (new connection)</label><input id="name" name="name" maxlength="60" value="${esc(client.name)}">
<label for="access">Access (new connection)</label><select id="access" name="access">${ACCESS.map((a) => `<option value="${a}"${a === "write" ? " selected" : ""}>${esc(ACCESS_LABEL[a])}</option>`).join("")}</select>
<label for="password">Your password</label><input id="password" name="password" type="password" required autocomplete="current-password">
${error ? `<p class="err" role="alert">${esc(error)}</p>` : ""}
<div class="row"><button class="g" name="decision" value="deny" type="submit" formnovalidate>Deny</button><button name="decision" value="approve" type="submit">Allow</button></div></form>
<p class="fine">Only continue if you started this connection yourself.</p>`);
}

async function authorize(request, env, url) {
  if (request.method === "GET") {
    const r = await authParams(env, url.searchParams);
    if (r.error) return page("Cannot continue", `<h1>Cannot continue</h1><p>${esc(r.error)}</p>`, 400);
    if (r.redirect) return back(r.p, { error: r.redirect, state: r.p.state, iss: url.origin });
    return consent(env, url, r.client, r.p);
  }
  if (request.method !== "POST") return new Response("method not allowed", { status: 405, headers: { allow: "GET, POST" } });
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) return page("Refused", "<h1>Refused</h1><p>This form must be sent from this site.</p>", 403);
  let form;
  try { form = await request.formData(); } catch { return page("Cannot continue", "<h1>Cannot continue</h1><p>Bad request.</p>", 400); }
  const r = await authParams(env, form);
  if (r.error) return page("Cannot continue", `<h1>Cannot continue</h1><p>${esc(r.error)}</p>`, 400);
  if (r.redirect) return back(r.p, { error: r.redirect, state: r.p.state, iss: url.origin });
  if (form.get("decision") !== "approve") return back(r.p, { error: "access_denied", state: r.p.state, iss: url.origin });

  const keys = ["oauth-ip:" + ip(request)];
  if (await locked(env, keys)) return consent(env, url, r.client, r.p, "Too many wrong passwords. Wait 15 minutes.").then((x) => new Response(x.body, { status: 429, headers: x.headers }));
  const owner = await env.DB.prepare("SELECT pass_hash, salt FROM users ORDER BY id LIMIT 1").first();
  const pw = String(form.get("password") || "").slice(0, 256);
  const { hash } = await hashPassword(pw, owner ? owner.salt : randomHex(16));
  if (!owner || !sameText(hash, owner.pass_hash)) {
    await recordFail(env, keys);
    return consent(env, url, r.client, r.p, "Wrong password.").then((x) => new Response(x.body, { status: 401, headers: x.headers }));
  }
  await clearFails(env, keys);

  let serviceId = String(form.get("service") || "");
  if (serviceId === "__new") {
    const access = ACCESS.includes(String(form.get("access"))) ? String(form.get("access")) : "write";
    const made = await createService(env, String(form.get("name") || r.client.name), access);
    if (made.error) return consent(env, url, r.client, r.p, made.error);
    serviceId = made.id;
  } else {
    const s = await env.DB.prepare("SELECT id FROM services WHERE id = ? AND revoked = 0").bind(serviceId).first();
    if (!s) return consent(env, url, r.client, r.p, "Pick a connection.");
  }
  const code = randomHex(32);
  await env.DB.prepare("DELETE FROM oauth_codes WHERE expires < ?").bind(Date.now()).run();
  await env.DB.prepare("INSERT INTO oauth_codes (code_hash, client_id, service_id, redirect_uri, challenge, expires) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(await sha256Hex(code), r.client.id, serviceId, r.p.redirect_uri, r.p.code_challenge, Date.now() + CODE_TTL * 1000).run();
  return back(r.p, { code, state: r.p.state, iss: url.origin });
}

// ---------- tokens ----------
async function issue(env, clientId, serviceId, family) {
  const access = "mra_" + randomHex(32), refresh = "mrr_" + randomHex(32), t = Date.now();
  await env.DB.prepare("DELETE FROM oauth_tokens WHERE expires < ?").bind(t).run();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO oauth_tokens (token_hash, kind, client_id, service_id, family, expires) VALUES (?, 'access', ?, ?, ?, ?)")
      .bind(await sha256Hex(access), clientId, serviceId, family, t + ACCESS_TTL * 1000),
    env.DB.prepare("INSERT INTO oauth_tokens (token_hash, kind, client_id, service_id, family, expires) VALUES (?, 'refresh', ?, ?, ?, ?)")
      .bind(await sha256Hex(refresh), clientId, serviceId, family, t + REFRESH_TTL * 1000),
  ]);
  const s = await env.DB.prepare("SELECT access FROM services WHERE id = ?").bind(serviceId).first();
  return json({ access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL, refresh_token: refresh, scope: "memory:" + (s ? s.access : "full") },
    200, null, { ...CORS, pragma: "no-cache" });
}

async function token(request, env) {
  if (!(await rateLimit(env, "oauth-tok:" + ip(request), 60, 60000)).ok) return oerr("temporarily_unavailable", "slow down", 429);
  const b = await readParams(request);
  if (!b) return oerr("invalid_request", "send form fields or JSON");
  let clientId = String(b.client_id || ""), secret = String(b.client_secret || "");
  const basic = (request.headers.get("authorization") || "").match(/^Basic\s+(\S+)$/i);
  if (basic) { try { const [i, ...rest] = atob(basic[1]).split(":"); clientId = decodeURIComponent(i); secret = decodeURIComponent(rest.join(":")); } catch { /* fall through */ } }
  const client = await clientById(env, clientId);
  if (!client) return oerr("invalid_client", "unknown client", 401);
  if (client.secret_hash && !sameText(await sha256Hex(secret), client.secret_hash)) return oerr("invalid_client", "wrong client secret", 401);
  const live = (id) => env.DB.prepare("SELECT id FROM services WHERE id = ? AND revoked = 0").bind(id).first();

  if (b.grant_type === "authorization_code") {
    const row = await env.DB.prepare("DELETE FROM oauth_codes WHERE code_hash = ? RETURNING *").bind(await sha256Hex(String(b.code || ""))).first(); // single use
    if (!row || row.client_id !== client.id || row.expires < Date.now() || row.redirect_uri !== String(b.redirect_uri || "")) return oerr("invalid_grant", "the code is wrong, used or expired");
    const verifier = String(b.code_verifier || "");
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return oerr("invalid_grant", "code_verifier is required");
    const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
    if (!sameText(challenge, row.challenge)) return oerr("invalid_grant", "PKCE check failed");
    if (!(await live(row.service_id))) return oerr("invalid_grant", "this connection was revoked");
    return issue(env, client.id, row.service_id, randomHex(8));
  }
  if (b.grant_type === "refresh_token") {
    const h = await sha256Hex(String(b.refresh_token || ""));
    const row = await env.DB.prepare("SELECT * FROM oauth_tokens WHERE token_hash = ? AND kind = 'refresh'").bind(h).first();
    if (!row || row.client_id !== client.id || row.expires < Date.now()) return oerr("invalid_grant", "the refresh token is wrong or expired");
    const claimed = row.used ? { meta: { changes: 0 } } : await env.DB.prepare("UPDATE oauth_tokens SET used = 1 WHERE token_hash = ? AND used = 0").bind(h).run();
    if (!claimed.meta.changes) { // a used refresh token came back: someone copied it, so end the whole session
      await env.DB.prepare("DELETE FROM oauth_tokens WHERE family = ?").bind(row.family).run();
      return oerr("invalid_grant", "this refresh token was already used; sign in again");
    }
    if (!(await live(row.service_id))) return oerr("invalid_grant", "this connection was revoked");
    return issue(env, client.id, row.service_id, row.family);
  }
  return oerr("unsupported_grant_type", "use authorization_code or refresh_token");
}

async function revoke(request, env) {
  const b = (await readParams(request)) || {};
  const row = await env.DB.prepare("SELECT family FROM oauth_tokens WHERE token_hash = ?").bind(await sha256Hex(String(b.token || ""))).first();
  if (row) await env.DB.prepare("DELETE FROM oauth_tokens WHERE family = ?").bind(row.family).run();
  return json({}, 200, null, CORS);
}

export async function oauth(request, env, url) {
  const p = url.pathname;
  if (request.method === "OPTIONS" && p !== "/oauth/authorize") return new Response(null, { status: 204, headers: CORS });
  if (p.startsWith("/.well-known/oauth-protected-resource") || p === "/.well-known/oauth-authorization-server") {
    if (request.method !== "GET") return new Response("method not allowed", { status: 405, headers: { allow: "GET" } });
    return json(metadata(url, p), 200, null, { ...CORS, "cache-control": "public, max-age=300" });
  }
  if (p === "/oauth/register" && request.method === "POST") return register(request, env);
  if (p === "/oauth/authorize") return authorize(request, env, url);
  if (p === "/oauth/token" && request.method === "POST") return token(request, env);
  if (p === "/oauth/revoke" && request.method === "POST") return revoke(request, env);
  return new Response("not found", { status: 404 });
}

// ---------- MCP bearer check ----------
export async function serviceByBearer(env, request) {
  const m = (request.headers.get("authorization") || "").match(/^Bearer\s+(mra_[a-f0-9]{64})$/);
  if (!m) return null;
  return env.DB.prepare(
    "SELECT s.* FROM oauth_tokens t JOIN services s ON s.id = t.service_id WHERE t.token_hash = ? AND t.kind = 'access' AND t.expires > ? AND s.revoked = 0"
  ).bind(await sha256Hex(m[1]), Date.now()).first();
}
export const bearerChallenge = (url) => new Response(JSON.stringify({ error: "unauthorized", error_description: "sign in with OAuth" }), {
  status: 401, headers: { ...CORS, "content-type": "application/json", "cache-control": "no-store",
    "www-authenticate": `Bearer resource_metadata="${url.origin}/.well-known/oauth-protected-resource"` } });
