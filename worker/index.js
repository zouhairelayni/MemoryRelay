// Entry point: routes MCP, auth and API requests. Everything else is the React app (static assets).
import { BUILD } from "./constants.js";
import { api } from "./api.js";
import { auth } from "./auth.js";
import { ensureSchema } from "./db.js";
import { handleMcp } from "./mcp.js";
import { meter } from "./metering.js";
import { serviceBySecret } from "./services.js";
import { json } from "./util.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const p = url.pathname;
    try {
      if (p === "/api/build") return json({ build: BUILD });
      if (p.startsWith("/mcp/") || p.startsWith("/auth/") || p.startsWith("/api/")) {
        await ensureSchema(env);
        if (p.startsWith("/mcp/")) {
          const svc = await serviceBySecret(env, p.slice(5));
          if (!svc) return new Response("not found", { status: 404 });
          if (request.method !== "POST") return new Response("method not allowed", { status: 405, headers: { allow: "POST" } });
          const stats = { n_read: 0, n_write: 0, n_delete: 0, app: "" };
          const res = await handleMcp(request, env, stats);
          ctx.waitUntil(meter(env, request, res, svc.id, stats));
          return res;
        }
        if (p.startsWith("/auth/")) return await auth(request, env, url);
        return await api(request, env, url);
      }
      if (env.ASSETS) return env.ASSETS.fetch(request);
      return new Response("not found", { status: 404 });
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  },
};
