// The MCP JSON-RPC endpoint agents talk to.
import { TOOLS } from "./constants.js";
import { json } from "./util.js";
import { forget, recent, remember, search, updateMemory } from "./memories.js";
import { housekeep } from "./housekeep.js";
import { formatForAgent, SKILL_TEMPLATE, selectSkills, uploadSkillFromAgent } from "./skills.js";
import { tally } from "./metering.js";

export async function callTool(env, name, a, agentName = "") {
  switch (name) {
    case "get_skill_template": return { template: SKILL_TEMPLATE, max_tokens: 5000, note: "Keep the description to the trigger. Put detail in Steps and Rules." };
    case "upload_skill": return uploadSkillFromAgent(env, a.skill_md, agentName);
    case "remember": return remember(env, a);
    case "search": return search(env, a);
    case "recent": return recent(env, a);
    case "update_memory": return updateMemory(env, a);
    case "forget": return forget(env, a);
    case "housekeep": return housekeep(env, { apply: !!a.apply }); // agents cannot inject groups
    case "select_skills": {
      const arr = (x) => (Array.isArray(x) ? x.map(String).slice(0, 40) : []);
      const r = await selectSkills(env, { request: String(a.request || "").slice(0, 4000), files: arr(a.files), functions: arr(a.functions) });
      return { text: formatForAgent(r), picks: r.skills.map((s) => s.name), mode: r.mode };
    }
    default: throw new Error("unknown tool " + name);
  }
}

export async function handleMcp(request, env, stats) {
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
      instructions: "Before starting any task, call select_skills with the user's request word for word. Follow only the skills it returns. To add a skill you wrote, call get_skill_template, follow it exactly (max 5000 tokens), then call upload_skill. Uploads wait for owner approval.",
      serverInfo: { name: "my-memory", version: "2.1.0" } });
  }
  if (method === "ping") return ok({});
  if (method === "tools/list") return ok({ tools: TOOLS });
  if (method === "tools/call") {
    try {
      const out = await callTool(env, params.name, params.arguments || {}, stats ? stats.app : "");
      if (stats) tally(stats, params.name, out);
      if (params.name === "select_skills") {
        return ok({ content: [{ type: "text", text: out.text }] });
      }
      return ok({ content: [{ type: "text", text: typeof out === "string" ? out : JSON.stringify(out, null, 2) }] });
    } catch (e) {
      return ok({ content: [{ type: "text", text: "error: " + e.message }], isError: true });
    }
  }
  return json({ jsonrpc: "2.0", id, error: { code: -32601, message: "method not found" } });
}
