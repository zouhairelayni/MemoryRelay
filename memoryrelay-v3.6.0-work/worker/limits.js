// Fixed-window rate limits kept in D1, so they hold across Worker instances.
export async function rateLimit(env, key, max, windowMs) {
  const t = Date.now(), until = t + windowMs;
  const r = await env.DB.prepare(
    `INSERT INTO rate_limits (key, n, expires) VALUES (?, 1, ?)
     ON CONFLICT(key) DO UPDATE SET n = CASE WHEN expires <= ? THEN 1 ELSE n + 1 END,
       expires = CASE WHEN expires <= ? THEN ? ELSE expires END
     RETURNING n, expires`
  ).bind(key, until, t, t, until).first();
  if (Math.random() < 0.02) await env.DB.prepare("DELETE FROM rate_limits WHERE expires < ?").bind(t).run();
  return { ok: r.n <= max, n: r.n, retryAfter: Math.max(1, Math.ceil((r.expires - t) / 1000)) };
}
