// Entry point: routes MCP, auth and API requests. Everything else is the React app (static assets).
import { BUILD } from "./constants.js";
import { api } from "./api.js";
import { auth } from "./auth.js";
import { ensureSchema } from "./db.js";
import { handleMcp } from "./mcp.js";
import { meter } from "./metering.js";
import { serviceBySecret } from "./services.js";
import { json } from "./util.js";

// Headers for the app itself: no framing (clickjacking), no MIME sniffing, no referrer leaks, strict scripts.
function withSecurityHeaders(res) {
  const h = new Headers(res.headers);
  h.set("x-frame-options", "DENY");
  h.set("x-content-type-options", "nosniff");
  h.set("referrer-policy", "same-origin");
  h.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  h.set("content-security-policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  return new Response(res.body, { status: res.status, headers: h });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const p = url.pathname;
    try {
      if (p === "/api/build") return json({ build: BUILD });
      // Browser requests that change data must come from this site (JSON bodies cannot be sent cross-site without a preflight).
      const changes = !["GET", "HEAD"].includes(request.method);
      if (changes && (p.startsWith("/api/") || p.startsWith("/auth/"))) {
        const origin = request.headers.get("origin");
        if (origin && origin !== url.origin) return json({ error: "cross-site request refused" }, 403);
        const hasBody = (request.headers.get("content-length") || "0") !== "0" || !!request.headers.get("transfer-encoding");
        if (hasBody && !String(request.headers.get("content-type") || "").includes("application/json")) {
          return json({ error: "send JSON" }, 415);
        }
      }
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
      if (env.ASSETS) return withSecurityHeaders(await env.ASSETS.fetch(request));
      return new Response("not found", { status: 404 });
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  },
};
