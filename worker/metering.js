// Per-connection counters (reads, writes, deletes, bytes).
import { now } from "./util.js";

// Counts what an agent did, by outcome, for the per-connection stats.
export function tally(stats, name, out) {
  const s = typeof out === "string" ? out : "";
  if (name === "search" || name === "recent" || name === "select_skills" || name === "draft_skill") stats.n_read++;
  else if (name === "remember") { if (s.startsWith("saved")) stats.n_write++; }
  else if (name === "update_memory") { if (s.startsWith("updated")) stats.n_write++; }
  else if (name === "forget") { if (s === "deleted") stats.n_delete++; }
  else if (name === "housekeep") {
    if (out && typeof out.removed === "number") { stats.n_delete += out.removed; stats.n_write += out.merged || 0; }
    else stats.n_read++;
  }
}

export async function meter(env, request, res, serviceId, stats) {
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

export async function listStats(env) {
  const { results } = await env.DB.prepare(
    "SELECT s.id, s.name, s.revoked, s.created, COALESCE(t.requests, 0) AS requests, COALESCE(t.n_read, 0) AS n_read, COALESCE(t.n_write, 0) AS n_write, COALESCE(t.n_delete, 0) AS n_delete, COALESCE(t.bytes_in, 0) AS bytes_in, COALESCE(t.bytes_out, 0) AS bytes_out, COALESCE(t.last, '') AS last, COALESCE(t.app, '') AS app FROM services s LEFT JOIN service_stats t ON t.service_id = s.id ORDER BY s.created, s.rowid"
  ).all();
  return results.map((r) => ({ ...r, revoked: !!r.revoked }));
}
