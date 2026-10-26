// Service worker: network-first for pages, cache fallback when offline.
// /api, /auth, /mcp, /oauth and /.well-known are never touched or cached (the sign-in page must never become the cached app page). Bump CACHE to force clients to refresh.
const CACHE = "memory-relay-v4";
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/", "/manifest.webmanifest", "/icons/icon-192.png"])).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  const p = url.pathname;
  if (p.startsWith("/api/") || p.startsWith("/auth/") || p === "/mcp" || p.startsWith("/mcp/") || p.startsWith("/oauth/") || p.startsWith("/.well-known/")) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && !/no-store/i.test(res.headers.get("cache-control") || "")) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req.mode === "navigate" ? "/" : req, copy)); }
        return res;
      })
      .catch(() => caches.match(req.mode === "navigate" ? "/" : req))
  );
});
