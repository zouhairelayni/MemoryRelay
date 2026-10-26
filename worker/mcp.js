// The MCP JSON-RPC endpoint agents talk to.
import { ACCESS_LABEL, ACCESS_RANK, MAX_ARG_CHARS, PROTOCOLS, SERVER_VERSION, TOOLS, TOOL_LEVEL } from "./constants.js";
import { json, readJson } from "./util.js";
import { forget, recent, remember, search, updateMemory } from "./memories.js";
import { housekeep } from "./housekeep.js";
import { formatForAgent, SKILL_TEMPLATE, selectSkills, uploadSkillFromAgent } from "./skills.js";
import { generateSkill } from "./skillstudio.js";
import { delegate } from "./delegate.js";
import { BRIEF_FORM, GUIDE } from "./delegateguide.js";
import { rateLimit } from "./limits.js";
import { tally } from "./metering.js";

// Errors whose message is safe to show to an agent. Anything else becomes a generic "internal error".
export class ToolError extends Error {}

// A connection may call a tool only if its access level reaches the tool's level (no connection = the dashboard test, full).
const levelOf = (svc) => (svc && ACCESS_RANK[svc.access] ? svc.access : "full");
const mayCall = (svc, name) => ACCESS_RANK[levelOf(svc)] >= (ACCESS_RANK[TOOL_LEVEL[name]] || 99);

const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));
const agentLabel = (name) => "agent:" + (String(name || "").replace(/[^a-z0-9 ._-]/gi, "").trim().slice(0, 40) || "unknown");

// Checks the arguments against the tool's schema. Numbers and booleans sent as text ("5", "true") are accepted.
export function validateArgs(schema, input) {
  if (input === undefined || input === null) input = {};
  if (typeof input !== "object" || Array.isArray(input)) return { error: "arguments must be an object" };
  const out = { ...input };
  for (const k of schema.required || []) if (out[k] === undefined || out[k] === null) return { error: "missing required argument: " + k };
  for (const [k, spec] of Object.entries(schema.properties || {})) {
    let v = out[k];
    if (v === undefined || v === null) { delete out[k]; continue; }
    if (spec.type === "string") {
      if (typeof v !== "string") return { error: k + " must be a string" };
      if (v.length > MAX_ARG_CHARS) return { error: k + " is too long" };
    } else if (spec.type === "integer") {
      if (typeof v === "string" && /^-?\d{1,9}$/.test(v.trim())) v = Number(v);
      if (!Number.isInteger(v)) return { error: k + " must be a whole number" };
      out[k] = v;
    } else if (spec.type === "boolean") {
      if (v === "true") v = true; else if (v === "false") v = false;
      if (typeof v !== "boolean") return { error: k + " must be true or false" };
      out[k] = v;
    } else if (spec.type === "array") {
      if (!Array.isArray(v) || v.length > 100) return { error: k + " must be a list of at most 100 items" };
      if (spec.items && spec.items.type === "string" && v.some((x) => typeof x !== "string" || x.length > 1000)) return { error: k + " must be a list of short strings" };
    }
  }
  return { args: out };
}

export async function callTool(env, name, a, agentName = "", svc = null) {
  switch (name) {
    case "get_skill_template": return { template: SKILL_TEMPLATE, max_tokens: 5000, note: "Keep the description to the trigger. Put detail in Steps and Rules. Or call draft_skill to have the built-in AI write one." };
    case "upload_skill": return uploadSkillFromAgent(env, a.skill_md, (svc && svc.name) || agentName);
    case "draft_skill": {
      if (svc && !(await rateLimit(env, "draft:" + svc.id, 10, 3600e3)).ok) throw new ToolError("too many drafts this hour. Write the skill yourself with get_skill_template.");
      const r = await generateSkill(env, { goal: a.goal, details: a.details });
      if (r.error) throw new ToolError(r.error);
      return { skill_md: r.text, tokens: r.tokens, warnings: r.warnings,
        next: "Review the draft. Then call upload_skill with skill_md. The owner must approve it before any agent can use it." };
    }
    case "get_delegation_brief": return { text: GUIDE + "\n\n## Brief form\n" + BRIEF_FORM };
    case "delegate": {
      const r = await delegate(env, svc, a);
      if (r.error) throw new ToolError(r.error);
      return { text: r.text };
    }
    case "remember": return remember(env, { text: a.text, tags: a.tags }, agentLabel((svc && svc.name) || agentName)); // the source is the connection name, never taken from the agent
    case "search": return search(env, a);
    case "recent": return recent(env, a);
    case "update_memory": return updateMemory(env, a);
    case "forget": return forget(env, a);
    case "housekeep": {
      if (!a.apply && svc && !(await rateLimit(env, "hk:" + svc.id, 10, 3600e3)).ok) throw new ToolError("too many housekeeping checks this hour.");
      return housekeep(env, { apply: !!a.apply, proposal_id: a.proposal_id }); // agents cannot inject groups
    }
    case "select_skills": {
      // Past the hourly AI budget the pick silently falls back to keywords, so agents keep working.
      const useGemini = !svc || (await rateLimit(env, "pick:" + svc.id, 60, 3600e3)).ok;
      const arr = (x) => (Array.isArray(x) ? x.map(String).slice(0, 40) : []);
      const r = await selectSkills(env, { request: String(a.request || "").slice(0, 4000), files: arr(a.files), functions: arr(a.functions) }, { useGemini });
      return { text: formatForAgent(r), picks: r.skills.map((s) => s.name), mode: r.mode };
    }
    default: throw new ToolError("unknown tool " + name);
  }
}

const rpcError = (id, code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
const toolError = (id, text) => ({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "error: " + text }], isError: true } });

// Handles one JSON-RPC message. Returns the reply object, or null for notifications.
async function dispatch(msg, env, stats, svc) {
  if (!msg || typeof msg !== "object" || Array.isArray(msg) || typeof msg.method !== "string") return rpcError(msg && msg.id, -32600, "invalid request");
  const { id, method } = msg;
  if (id === undefined) return null; // notification: no reply
  if (id !== null && typeof id !== "string" && typeof id !== "number") return rpcError(null, -32600, "invalid request id");
  const params = msg.params && typeof msg.params === "object" && !Array.isArray(msg.params) ? msg.params : {};
  const ok = (result) => ({ jsonrpc: "2.0", id, result });

  if (method === "initialize") {
    const ci = params.clientInfo && typeof params.clientInfo === "object" ? params.clientInfo : {};
    if (stats) stats.app = [ci.name, ci.version].filter(Boolean).map(String).join(" ").slice(0, 60);
    const protocolVersion = PROTOCOLS.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOLS[0];
    return ok({ protocolVersion, capabilities: { tools: { listChanged: false } },
      instructions: "Before starting any task, call select_skills with the user's request word for word. Follow only the skills it returns. To save your own usage limits, hand self-contained coding jobs (snippets, functions, small features, tests, reviews) to delegate (call get_delegation_brief once for the brief form and the review checklist); it runs them on other models and returns a checked result that you must still verify. To add a skill, call draft_skill (AI writes it) or get_skill_template (write it yourself, max 5000 tokens), then call upload_skill. Uploads wait for owner approval.",
      serverInfo: { name: "my-memory", version: SERVER_VERSION } });
  }
  if (method === "ping") return ok({});
  if (method === "tools/list") return ok({ tools: TOOLS.filter((t) => mayCall(svc, t.name)) });
  if (method === "tools/call") {
    if (typeof params.name !== "string") return rpcError(id, -32602, "tool name is required");
    const tool = TOOL_BY_NAME.get(params.name);
    if (!tool) return rpcError(id, -32602, "unknown tool " + params.name.slice(0, 60));
    if (!mayCall(svc, tool.name)) return toolError(id, "this connection has " + ACCESS_LABEL[levelOf(svc)].toLowerCase() + ". " + tool.name + " needs " + ACCESS_LABEL[TOOL_LEVEL[tool.name]].toLowerCase() + ". The owner can change it in the dashboard.");
    const v = validateArgs(tool.inputSchema, params.arguments);
    if (v.error) return toolError(id, "invalid arguments: " + v.error);
    try {
      const out = await callTool(env, params.name, v.args, stats ? stats.app : "", svc);
      if (stats) tally(stats, params.name, out);
      const text = ["select_skills", "delegate", "get_delegation_brief"].includes(params.name) ? out.text : typeof out === "string" ? out : JSON.stringify(out, null, 2);
      return ok({ content: [{ type: "text", text }] });
    } catch (e) {
      if (e instanceof ToolError) return toolError(id, e.message);
      console.error("tool failed:", params.name, e && e.stack || e); // details stay in the logs, not in the reply
      return toolError(id, "internal error, please try again");
    }
  }
  return rpcError(id, -32601, "method not found");
}

export async function handleMcp(request, env, stats, svc = null) {
  const body = await readJson(request);
  if (body.error) return json(rpcError(null, body.parse ? -32700 : -32600, body.error), body.status);
  const msg = body.value;
  if (Array.isArray(msg)) { // JSON-RPC batch (older protocol versions)
    if (!msg.length || msg.length > 20) return json(rpcError(null, -32600, "batch must hold 1 to 20 messages"), 400);
    const replies = [];
    for (const m of msg) { const r = await dispatch(m, env, stats, svc); if (r) replies.push(r); }
    return replies.length ? json(replies) : new Response(null, { status: 202 });
  }
  const reply = await dispatch(msg, env, stats, svc);
  if (!reply) return new Response(null, { status: 202 });
  return json(reply, reply.error && (reply.error.code === -32600) ? 400 : 200);
}
