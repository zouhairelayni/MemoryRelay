// The MCP JSON-RPC endpoint agents talk to.
import { TOOLS } from "./constants.js";
import { json } from "./util.js";
import { forget, recent, remember, search, updateMemory } from "./memories.js";
import { housekeep } from "./housekeep.js";
import { tally } from "./metering.js";

export async function callTool(env, name, a) {
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
      serverInfo: { name: "my-memory", version: "2.1.0" } });
  }
  if (method === "ping") return ok({});
  if (method === "tools/list") return ok({ tools: TOOLS });
  if (method === "tools/call") {
    try {
      const out = await callTool(env, params.name, params.arguments || {});
      if (stats) tally(stats, params.name, out);
      return ok({ content: [{ type: "text", text: typeof out === "string" ? out : JSON.stringify(out, null, 2) }] });
    } catch (e) {
      return ok({ content: [{ type: "text", text: "error: " + e.message }], isError: true });
    }
  }
  return json({ jsonrpc: "2.0", id, error: { code: -32601, message: "method not found" } });
}
