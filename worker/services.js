// Connections (one MCP address per agent): lookup, listing and the dashboard connector test.
import { ACCESS } from "./constants.js";
import { newId, now, randomHex } from "./util.js";
import { handleMcp } from "./mcp.js";

export async function serviceBySecret(env, secret) {
  return env.DB.prepare("SELECT * FROM services WHERE secret = ? AND revoked = 0").bind(secret).first();
}

export async function activeServices(env) {
  const { results } = await env.DB.prepare("SELECT * FROM services WHERE revoked = 0 ORDER BY created").all();
  return results;
}

export async function listServices(env) {
  const { results } = await env.DB.prepare(
    "SELECT s.id, s.name, s.secret, s.access, (SELECT COUNT(DISTINCT family) FROM oauth_tokens WHERE service_id = s.id AND kind = 'refresh' AND used = 0 AND expires > " + Date.now() + ") AS sessions, s.created, s.last_seen, s.revoked, COALESCE(t.requests, 0) AS requests, COALESCE(t.n_read, 0) AS n_read, COALESCE(t.n_write, 0) AS n_write, COALESCE(t.n_delete, 0) AS n_delete, COALESCE(t.bytes_in, 0) AS bytes_in, COALESCE(t.bytes_out, 0) AS bytes_out, COALESCE(t.last, '') AS last, COALESCE(t.app, '') AS app FROM services s LEFT JOIN service_stats t ON t.service_id = s.id ORDER BY s.created, s.rowid"
  ).all();
  return results.map((s) => ({
    id: s.id, name: s.name, access: s.access || "full", sessions: s.sessions, created: s.created, last_seen: s.last_seen, revoked: !!s.revoked, url: "/mcp/" + s.secret,
    requests: s.requests, n_read: s.n_read, n_write: s.n_write, n_delete: s.n_delete,
    bytes_in: s.bytes_in, bytes_out: s.bytes_out, last: s.last, app: s.app,
  }));
}

export async function testConnector(env, request) {
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

// ---- owner (dashboard) helpers ----

export async function createService(env, name, access = "full") {
  const clean = String(name || "").trim().slice(0, 60);
  if (!clean) return { error: "give the service a name" };
  if (!ACCESS.includes(access)) return { error: "access must be read, write or full" };
  const id = newId(), secret = randomHex(24);
  await env.DB.prepare("INSERT INTO services (id, name, secret, created, access) VALUES (?, ?, ?, ?, ?)")
    .bind(id, clean, secret, now(), access).run();
  return { id, name: clean, access, url: "/mcp/" + secret };
}

export async function setAccess(env, id, access) {
  if (!ACCESS.includes(access)) return { error: "access must be read, write or full" };
  const r = await env.DB.prepare("UPDATE services SET access = ? WHERE id = ? AND revoked = 0").bind(access, String(id)).run();
  return r.meta.changes ? { ok: true, access } : { error: "connection not found" };
}

// Signs out every OAuth session of a connection (its secret address keeps working).
export async function signOutSessions(env, id) {
  const r = await env.DB.prepare("DELETE FROM oauth_tokens WHERE service_id = ?").bind(String(id)).run();
  await env.DB.prepare("DELETE FROM oauth_codes WHERE service_id = ?").bind(String(id)).run();
  return { signed_out: r.meta.changes };
}

export async function revokeService(env, id) {
  const r = await env.DB.prepare("UPDATE services SET revoked = 1 WHERE id = ? AND revoked = 0").bind(String(id)).run();
  await signOutSessions(env, id);
  return { revoked: r.meta.changes };
}

export async function deleteService(env, id) {
  const r = await env.DB.prepare("DELETE FROM services WHERE id = ? AND revoked = 1").bind(String(id)).run();
  if (!r.meta.changes) return { error: "only revoked services can be deleted" };
  await env.DB.prepare("DELETE FROM service_stats WHERE service_id = ?").bind(String(id)).run();
  await signOutSessions(env, id);
  return { deleted: r.meta.changes };
}
