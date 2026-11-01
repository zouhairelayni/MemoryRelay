// OAuth 2.1 authorization for MCP (the standard way custom connectors sign in):
//   discovery  GET /.well-known/oauth-protected-resource, /.well-known/oauth-authorization-server
//   register   POST /oauth/register           (dynamic client registration, RFC 7591)
//   sign in    GET/POST /oauth/authorize      (the owner approves with their password, PKCE S256 required)
//   tokens     POST /oauth/token              (authorization_code and refresh_token, refresh tokens rotate)
//   revoke     POST /oauth/revoke
// Every approval is tied to ONE connection, so each agent has its own access level, statistics and kill switch.
// Only SHA-256 hashes of codes and tokens are stored.
import { ACCESS, ACCESS_LABEL } from "./constants.js";
import { currentUser, passwordLogin, sameText, sha256Hex } from "./auth.js";
import { brandSvg, detectBrand } from "../shared/brands.js";
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

// ---------- authorize (sign in, then approve) ----------
// 1. Not signed in: the page shows ONLY a sign-in form. It reveals nothing about your account or connections.
// 2. Signed in: no password again. Every handshake is a NEW connection, unless the same app signed in before:
//    then it is a refresh and the existing connection is reused (and the page says so).
// The approval is a same-origin form post authenticated by the session cookie; cross-site posts are refused.
const PAGE_HEADERS = {
  "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-frame-options": "DENY",
  "referrer-policy": "same-origin", // never "no-referrer": that makes browsers send "Origin: null" on form posts
  "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
};
const M_MARK = (size) => `<svg width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7.2" fill="#2F54EB"/><path d="M8.5 22V11.5l7.5 6.5 7.5-6.5V22" fill="none" stroke="#fff" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round"/><circle cx="16" cy="8.2" r="2.5" fill="#fff"/></svg>`;
const appTile = (name) => {
  const id = detectBrand(name);
  const inner = id ? brandSvg(id, 34) : `<span style="font:700 26px system-ui;color:#2F54EB">${esc(String(name || "?").trim().charAt(0).toUpperCase() || "?")}</span>`;
  return `<span class="tile">${inner}</span>`;
};
const page = (title, inner, status = 200) => new Response(
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${esc(title)}</title><style>
:root{--bg:#EEF1F5;--card:#FFFFFF;--ink:#0D1626;--ink2:#475268;--line:#D5DCE7;--cobalt:#2F54EB;--soft:#E3E9FD;--rose:#B92A44;--paper2:#E2E7EF}
@media(prefers-color-scheme:dark){:root{--bg:#0A1020;--card:#111A2E;--ink:#E8EDF7;--ink2:#AAB5C9;--line:#26324A;--cobalt:#8EA3FF;--soft:#1B2547;--rose:#FF8696;--paper2:#0E1830}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:20px;background:var(--bg);color:var(--ink);font:16px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.c{width:100%;max-width:440px;background:var(--card);border-radius:28px;padding:28px;box-shadow:0 0 0 1px var(--line),0 24px 60px -30px rgba(0,0,0,.45)}
.pair{display:flex;align-items:center;justify-content:center;gap:0;margin:2px 0 22px}
.tile{width:60px;height:60px;border-radius:18px;background:var(--bg);box-shadow:inset 0 0 0 1px var(--line);display:grid;place-items:center;flex:none}
.pair .tile.m{background:none;box-shadow:none}
.cable{height:3px;width:46px;border-radius:3px;background:var(--cobalt);opacity:.55;margin:0 6px}
h1{font:700 24px/1.15 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;letter-spacing:-.025em;margin:0 0 8px;text-align:center}
p{margin:0 0 14px;color:var(--ink2);font-size:15px;text-align:center}b{color:var(--ink)}
label{display:block;font-size:13px;font-weight:600;color:var(--ink2);margin:14px 0 6px}
input[type=text],input[type=email],input[type=password]{width:100%;font:inherit;color:var(--ink);background:var(--bg);border:0;box-shadow:inset 0 0 0 1px var(--line);border-radius:14px;padding:12px 14px;min-height:46px}
input:focus-visible{outline:2px solid var(--cobalt);outline-offset:1px}
.opts{display:flex;flex-direction:column;gap:8px;margin-top:8px}
.opt{display:flex;gap:12px;align-items:flex-start;padding:12px 14px;border-radius:14px;box-shadow:inset 0 0 0 1px var(--line);cursor:pointer;margin:0;font-weight:400;color:var(--ink)}
.opt input{margin-top:4px;accent-color:var(--cobalt)}.opt span{display:block;font-size:13px;color:var(--ink2)}.opt b{display:block;font-size:15px}
.opt:has(input:checked){box-shadow:inset 0 0 0 2px var(--cobalt);background:var(--soft)}
.row{display:flex;gap:10px;margin-top:22px}button{flex:1;font:600 15px inherit;font-family:inherit;border-radius:999px;padding:12px 16px;min-height:46px;cursor:pointer;border:0;background:var(--ink);color:var(--bg);transition:transform .14s cubic-bezier(.23,1,.32,1)}
button:active{transform:scale(.97)}button.g{background:transparent;color:var(--ink);box-shadow:inset 0 0 0 1px var(--line)}
button.link{background:none;color:var(--ink2);font-weight:500;text-decoration:underline;min-height:40px;margin-top:6px;width:100%;flex:none}
.err{color:var(--rose);font-size:14px;margin:12px 0 0;text-align:center}.fine{font-size:13px;color:var(--ink2);margin:16px 0 0;text-align:center}
.tag{display:block;width:fit-content;margin:0 auto 14px;background:var(--soft);color:var(--cobalt);font:600 13px system-ui;border-radius:8px;padding:5px 11px}
@media(prefers-reduced-motion:reduce){button{transition:none}}
</style></head><body><main class="c">${inner}</main></body></html>`,
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
const authorizeUrl = (url, p) => url.origin + "/oauth/authorize?" + new URLSearchParams({ response_type: "code", client_id: p.client_id, redirect_uri: p.redirect_uri, state: p.state, code_challenge: p.code_challenge, code_challenge_method: "S256" });
const hiddenFields = (p) => ["client_id", "redirect_uri", "state", "code_challenge", "code_challenge_method"].map((k) => `<input type="hidden" name="${k}" value="${esc(p[k])}">`).join("");
const hostOf = (uri) => { try { const u = new URL(uri); return u.host || u.protocol; } catch { return ""; } };

// A browser form post from our own page is same-origin. Newer browsers say so (Sec-Fetch-Site); older ones send Origin.
function sameSiteRequest(request, url) {
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin" || site === "none";
  const origin = request.headers.get("origin");
  return !origin || origin === url.origin;
}

// "Claude at claude.ai" is the same app coming back; "Claude on a different site" is not.
function oauthKey(name, redirectUri) {
  let host = "";
  try { const u = new URL(redirectUri); host = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) ? "loopback" : (u.host || u.protocol); } catch { /* empty */ }
  return (String(name || "").trim().toLowerCase() + "@" + host).slice(0, 200);
}
const findReconnect = (env, client, p) => env.DB.prepare("SELECT id, name, access FROM services WHERE revoked = 0 AND oauth_key = ? ORDER BY created DESC LIMIT 1").bind(oauthKey(client.name, p.redirect_uri)).first();

function loginPage(client, p, { error = "", email = "" } = {}, status = 200) {
  return page("Sign in", `<div class="pair">${appTile(client.name)}<span class="cable"></span><span class="tile m">${M_MARK(60)}</span></div>
<h1>Sign in to continue</h1>
<p><b>${esc(client.name)}</b> wants to connect to your Memory Relay. Sign in to your account first.</p>
<form method="post" action="/oauth/authorize">${hiddenFields(p)}<input type="hidden" name="step" value="login">
<label for="email">Email</label><input id="email" name="email" type="email" required autocomplete="username" value="${esc(email)}">
<label for="password">Password</label><input id="password" name="password" type="password" required autocomplete="current-password">
${error ? `<p class="err" role="alert">${esc(error)}</p>` : ""}
<div class="row"><button type="submit">Sign in</button></div></form>
<p class="fine">Nothing is shared until you approve it on the next step.</p>`, status);
}

function consentPage(client, p, user, reconnect, error = "") {
  const host = hostOf(p.redirect_uri);
  const label = ACCESS_LABEL[reconnect ? reconnect.access : "write"];
  const access = reconnect ? `<p class="fine" style="margin:0 0 6px"><b>${esc(reconnect.name)}</b> keeps its access level (${esc(label)}) and its history.</p>` : `
<label>Access for this connection</label><div class="opts">${[["read", "Reads memory and skills. Cannot change anything."], ["write", "Also saves memories, uploads skills and hands jobs to sub-agents."], ["full", "Also deletes memories and cleans up duplicates."]].map(([v, hint]) =>
  `<label class="opt"><input type="radio" name="access" value="${v}"${v === "write" ? " checked" : ""}><div><b>${esc(ACCESS_LABEL[v])}</b><span>${esc(hint)}</span></div></label>`).join("")}</div>
<label for="name">Connection name</label><input id="name" name="name" type="text" maxlength="60" value="${esc(client.name)}">`;
  return page("Allow access", `<div class="pair">${appTile(client.name)}<span class="cable"></span><span class="tile m">${M_MARK(60)}</span></div>
<span class="tag">${reconnect ? "Refreshing an existing connection" : "New connection"}</span>
<h1>${reconnect ? "Reconnect" : "Connect"} ${esc(client.name)}?</h1>
<p>${reconnect ? `This app was connected before, so this refreshes <b>${esc(reconnect.name)}</b> instead of making a new one.` : `This creates a new connection with its own access level, activity and kill switch.`} It returns to <b>${esc(host)}</b>.</p>
<form method="post" action="/oauth/authorize">${hiddenFields(p)}<input type="hidden" name="step" value="consent">${access}
${error ? `<p class="err" role="alert">${esc(error)}</p>` : ""}
<div class="row"><button class="g" name="decision" value="deny" type="submit">Deny</button><button name="decision" value="approve" type="submit">${reconnect ? "Reconnect" : "Allow"}</button></div>
${reconnect ? `<button class="link" name="decision" value="new" type="submit">Create a separate new connection instead</button>` : ""}</form>
<p class="fine">Signed in as ${esc(user.email)}. Only continue if you started this connection yourself.</p>`);
}

async function authorize(request, env, url) {
  if (request.method !== "GET" && request.method !== "POST") return new Response("method not allowed", { status: 405, headers: { allow: "GET, POST" } });
  const post = request.method === "POST";
  let form = null;
  if (post) {
    if (!sameSiteRequest(request, url)) return page("Refused", "<h1>Refused</h1><p>This form must be sent from this site.</p>", 403);
    try { form = await request.formData(); } catch { return page("Cannot continue", "<h1>Cannot continue</h1><p>Bad request.</p>", 400); }
  }
  const r = await authParams(env, post ? form : url.searchParams);
  if (r.error) return page("Cannot continue", `<h1>Cannot continue</h1><p>${esc(r.error)}</p>`, 400);
  if (r.redirect) return back(r.p, { error: r.redirect, state: r.p.state, iss: url.origin });
  const { client, p } = r;

  // step 1: sign in (only ever a form; it shows nothing about the account)
  if (post && form.get("step") === "login") {
    const res = await passwordLogin(env, request, form.get("email"), form.get("password"));
    if (!res.ok) return loginPage(client, p, { error: res.error, email: String(form.get("email") || "") }, res.status);
    return new Response(null, { status: 302, headers: { location: authorizeUrl(url, p), "set-cookie": res.cookie, "cache-control": "no-store" } });
  }
  const user = await currentUser(env, request);
  if (!user) return loginPage(client, p);

  // step 2: approve (new connection, or refresh of the same app's connection)
  const reconnect = await findReconnect(env, client, p);
  if (!post) return consentPage(client, p, user, reconnect);
  const decision = String(form.get("decision") || "");
  if (decision === "deny") return back(p, { error: "access_denied", state: p.state, iss: url.origin });
  if (decision !== "approve" && decision !== "new") return consentPage(client, p, user, reconnect);

  let serviceId;
  if (reconnect && decision === "approve") {
    serviceId = reconnect.id;
  } else {
    const access = ACCESS.includes(String(form.get("access"))) ? String(form.get("access")) : "write";
    let name = String(form.get("name") || client.name).trim().slice(0, 60) || client.name;
    const taken = new Set((await env.DB.prepare("SELECT name FROM services WHERE revoked = 0").all()).results.map((x) => x.name));
    for (let n = 2, base = name; taken.has(name) && n < 50; n++) name = (base + " " + n).slice(0, 60);
    const made = await createService(env, name, access);
    if (made.error) return consentPage(client, p, user, reconnect, made.error);
    await env.DB.prepare("UPDATE services SET oauth_key = ? WHERE id = ?").bind(oauthKey(client.name, p.redirect_uri), made.id).run();
    serviceId = made.id;
  }
  const code = randomHex(32);
  await env.DB.prepare("DELETE FROM oauth_codes WHERE expires < ?").bind(Date.now()).run();
  await env.DB.prepare("INSERT INTO oauth_codes (code_hash, client_id, service_id, redirect_uri, challenge, expires) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(await sha256Hex(code), client.id, serviceId, p.redirect_uri, p.code_challenge, Date.now() + CODE_TTL * 1000).run();
  return back(p, { code, state: p.state, iss: url.origin });
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
