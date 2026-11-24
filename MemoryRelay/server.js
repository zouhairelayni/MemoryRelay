// DEV-ONLY stub for previewing the UI without Cloudflare. It is NOT the real Worker:
// it pretends to be signed in and stores nothing. Real authentication lives in worker/auth.js.
// It listens on loopback only and answers cross-origin requests only from localhost pages,
// so a website you happen to visit cannot talk to it.
import http from 'node:http';

const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

const server = http.createServer((req, res) => {
  const origin = req.headers.origin;
  if (origin) {
    if (!LOCAL_ORIGIN.test(origin)) { res.writeHead(403); res.end('Forbidden'); return; }
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  req.resume(); // the stub never needs request bodies

  const path = (req.url || '').split('?')[0];
  if (path === '/auth/status' || path === '/auth/login') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ authenticated: true, success: true, user: { email: 'dev@localhost' } }));
    return;
  }
  res.writeHead(404);
  res.end('Not Found');
});

server.listen(8787, '127.0.0.1', () => {
  console.log('DEV STUB (no real auth) on http://127.0.0.1:8787');
});
