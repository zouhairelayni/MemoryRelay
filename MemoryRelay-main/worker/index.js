// Entry point: routes MCP, auth and API requests. Everything else is the React app (static assets).
import { BUILD, MCP_PER_MINUTE } from "./constants.js";
import { api } from "./api.js";
import { auth } from "./auth.js";
import { ensureSchema } from "./db.js";
import { seedBuiltins } from "./builtins.js";
import { rateLimit } from "./limits.js";
import { handleMcp } from "./mcp.js";
import { meter } from "./metering.js";
import { CORS, bearerChallenge, isOauthPath, oauth, serviceByBearer } from "./oauth.js";
import { serviceBySecret } from "./services.js";
import { json } from "./util.js";

// Headers for the app itself: no framing (clickjacking), no MIME sniffing, no referrer leaks, strict scripts.
function withSecurityHeaders(res) {
  const h = new Headers(res.headers);
  h.set("x-frame-options", "DENY");
  h.set("x-content-type-options", "nosniff");
  h.set("referrer-policy", "same-origin");
  h.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  h.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  h.set("content-security-policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  return new Response(res.body, { status: res.status, headers: h });
}

// One MCP request for an authenticated connection: rate limit, handle, count.
async function serveMcp(request, env, ctx, svc, extraHeaders) {
  const rl = await rateLimit(env, "mcp:" + svc.id, MCP_PER_MINUTE, 60000);
  if (!rl.ok) return json({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "rate limit exceeded, retry in " + rl.retryAfter + "s" } }, 429, null, { ...extraHeaders, "retry-after": String(rl.retryAfter) });
  const stats = { n_read: 0, n_write: 0, n_delete: 0, app: "" };
  const res = await handleMcp(request, env, stats, svc);
  ctx.waitUntil(meter(env, request, res, svc.id, stats).catch((e) => console.error("metering failed:", e && e.message)));
  if (!Object.keys(extraHeaders).length) return res;
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(extraHeaders)) h.set(k, v);
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
      if (p === "/mcp" || p.startsWith("/mcp/") || p.startsWith("/auth/") || p.startsWith("/api/") || isOauthPath(p)) {
        if (request.method === "OPTIONS" && p === "/mcp") return new Response(null, { status: 204, headers: CORS });
        await ensureSchema(env);
        await seedBuiltins(env);
        if (isOauthPath(p)) return await oauth(request, env, url);
        if (p === "/mcp") { // OAuth clients: Authorization: Bearer <access token>
          if (request.method !== "POST") return new Response("method not allowed", { status: 405, headers: { allow: "POST", ...CORS } });
          const svc = await serviceByBearer(env, request);
          if (!svc) return bearerChallenge(url);
          return await serveMcp(request, env, ctx, svc, CORS);
        }
        if (p.startsWith("/mcp/")) { // the secret address
          const secret = p.slice(5);
          if (!/^[A-Za-z0-9_-]{16,128}$/.test(secret)) return new Response("not found", { status: 404 });
          const svc = await serviceBySecret(env, secret);
          if (!svc) return new Response("not found", { status: 404 });
          if (request.method !== "POST") return new Response("method not allowed", { status: 405, headers: { allow: "POST" } });
          // Agents are servers, not web pages. A browser sends Origin: refusing it blocks DNS-rebinding and cross-site calls (MCP spec).
          const origin = request.headers.get("origin");
          if (origin && origin !== url.origin) return json({ error: "browser requests are not accepted here" }, 403);
          return await serveMcp(request, env, ctx, svc, {});
        }
        if (p.startsWith("/auth/")) return await auth(request, env, url);
        return await api(request, env, url);
      }
      if (env.ASSETS) return withSecurityHeaders(await env.ASSETS.fetch(request));
      return new Response("not found", { status: 404 });
    } catch (e) {
      console.error("request failed:", request.method, p, e && e.stack || e); // details stay in the logs, never in the reply
      return json({ error: "internal error, please try again" }, 500);
    }
  },
};
