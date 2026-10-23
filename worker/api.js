// Owner API (/api/*). Every route needs a logged-in session.
import { currentUser } from "./auth.js";
import { addMemory, deleteMemory, editMemory, exportMemories, importMemories, listMemories } from "./memories.js";
import { createService, deleteService, listServices, revokeService, testConnector } from "./services.js";
import { geminiOp, geminiState, listGeminiModels } from "./gemini.js";
import { housekeep } from "./housekeep.js";
import { listStats } from "./metering.js";
import { json, now } from "./util.js";

export async function settings(env) {
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

const body = (request) => request.json().catch(() => ({}));
const withStatus = (out) => json(out, out.error ? 400 : 200);

export async function api(request, env, url) {
  const user = await currentUser(env, request);
  if (!user) return json({ error: "log in first" }, 401);
  const p = url.pathname, m = request.method;

  if (p === "/api/settings" && m === "GET") return json(await settings(env));

  // connections
  if (p === "/api/services" && m === "GET") return json({ services: await listServices(env) });
  if (p === "/api/services" && m === "POST") return withStatus(await createService(env, (await body(request)).name));
  const revoke = p.match(/^\/api\/services\/([^/]+)\/revoke$/);
  if (revoke && m === "POST") return json(await revokeService(env, revoke[1]));
  const svcDel = p.match(/^\/api\/services\/([^/]+)$/);
  if (svcDel && m === "DELETE") return withStatus(await deleteService(env, svcDel[1]));
  if (p === "/api/connector/test" && m === "POST") return json(await testConnector(env, request));
  if (p === "/api/stats" && m === "GET") return json({ services: await listStats(env) });

  // Gemini keys and models
  if (p === "/api/gemini" && m === "GET") return json(await geminiState(env));
  if (p === "/api/gemini" && m === "POST") return withStatus(await geminiOp(env, request));
  if (p === "/api/gemini/models" && m === "GET") {
    const row = await env.DB.prepare("SELECT key FROM gemini_keys WHERE enabled = 1 LIMIT 1").first();
    if (!row) return json({ error: "add an enabled key first" }, 400);
    return withStatus(await listGeminiModels(row.key));
  }

  // memories
  if (p === "/api/memories" && m === "GET") return json(await listMemories(env, url.searchParams.get("q")));
  if (p === "/api/memories" && m === "POST") return withStatus(await addMemory(env, await body(request)));
  if (p.startsWith("/api/memories/") && m === "PUT") return withStatus(await editMemory(env, p.split("/").pop(), await body(request)));
  if (p.startsWith("/api/memories/") && m === "DELETE") return json(await deleteMemory(env, p.split("/").pop()));
  if (p === "/api/housekeep" && m === "POST") {
    const b = await body(request);
    return json(await housekeep(env, { apply: !!b.apply, groups: b.groups }));
  }

  // backup
  if (p === "/api/export" && m === "GET") {
    return new Response(JSON.stringify(await exportMemories(env), null, 2), { headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="memories-${now().replace(/[^0-9]/g, "")}.json"`,
    } });
  }
  if (p === "/api/import" && m === "POST") {
    let incoming;
    try { incoming = await request.json(); } catch { return json({ error: "invalid JSON" }, 400); }
    return withStatus(await importMemories(env, incoming, url.searchParams.get("mode") || "merge"));
  }
  return json({ error: "no such api route" }, 404);
}
