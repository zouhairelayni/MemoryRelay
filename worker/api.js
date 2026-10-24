// Owner API (/api/*). Every route needs a logged-in session.
import { currentUser } from "./auth.js";
import { addMemory, deleteMemory, editMemory, exportMemories, importMemories, listMemories } from "./memories.js";
import { createService, deleteService, listServices, revokeService, testConnector } from "./services.js";
import { geminiOp, geminiState, listGeminiModels } from "./gemini.js";
import { housekeep } from "./housekeep.js";
import { listStats } from "./metering.js";
import { SKILL_TEMPLATE, MAX_TOKENS, addSkill, deleteSkill, getSkillSettings, listSkills, selectSkills, setSkillFlag, setSkillMax } from "./skills.js";
import { json, now } from "./util.js";
import { listFreeModels } from "./openrouter.js";
import { openrouterOp, openrouterState } from "./openrouter.js";

export async function settings(env) {
  const last = await env.DB.prepare("SELECT MAX(last_seen) AS last FROM services").first();
  const mem = await env.DB.prepare(
    "SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN tags LIKE '%rules%' THEN 1 ELSE 0 END), 0) AS rules FROM memories"
  ).first();
  const svc = await env.DB.prepare("SELECT COUNT(*) AS n FROM services WHERE revoked = 0").first();
  const keys = await env.DB.prepare("SELECT (SELECT COUNT(*) FROM gemini_keys WHERE enabled = 1) + (SELECT COUNT(*) FROM openrouter_keys WHERE enabled = 1) AS n").first();
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

  // skills (Skill Genie)
  if (p === "/api/skills" && m === "GET") return json({ skills: await listSkills(env), settings: await getSkillSettings(env), template: SKILL_TEMPLATE, max_tokens: MAX_TOKENS });
  if (p === "/api/skills" && m === "POST") {
    const b = await body(request);
    return withStatus(await addSkill(env, String(b.text || ""), b.source === "file" ? "file" : "paste"));
  }
  const skillFlag = p.match(/^\/api\/skills\/([^/]+)\/(enabled|core)$/);
  if (skillFlag && m === "PUT") return withStatus(await setSkillFlag(env, decodeURIComponent(skillFlag[1]), skillFlag[2], !!(await body(request)).value));
  const skillDel = p.match(/^\/api\/skills\/([^/]+)$/);
  if (skillDel && m === "DELETE") return json(await deleteSkill(env, decodeURIComponent(skillDel[1])));
  if (p === "/api/skills/max" && m === "PUT") return json(await setSkillMax(env, (await body(request)).max));
  if (p === "/api/skills/try" && m === "POST") {
    const b = await body(request);
    const r = await selectSkills(env, { request: String(b.request || "").slice(0, 4000), files: Array.isArray(b.files) ? b.files.map(String) : [], functions: [] });
    return json({ mode: r.mode, note: r.note, ms: r.ms, picks: r.skills.map((s) => ({ name: s.name, why: s.why })) });
  }

  // OpenRouter: keys and free models
  if (p === "/api/openrouter" && m === "GET") return json(await openrouterState(env));
  if (p === "/api/openrouter" && m === "POST") {
    const out = await openrouterOp(env, request);
    return json(out, out.error ? 400 : 200);
  }
  if (p === "/api/openrouter/models" && m === "GET") {
    const row = await env.DB.prepare("SELECT key FROM openrouter_keys WHERE enabled = 1 LIMIT 1").first();
    return withStatus(await listFreeModels(row ? row.key : ""));
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
