import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('local.db');
db.exec(`CREATE TABLE IF NOT EXISTS auth (key TEXT PRIMARY KEY, value TEXT)`);

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', '*');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  let body = '';
  if (req.method === 'POST') {
    for await (const chunk of req) {
      body += chunk;
    }
  }

  if (req.url === '/auth/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ authenticated: true, user: { email: 'admin@memoryrelay.local' } }));
    return;
  }

  if (req.url === '/auth/login') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      success: true, 
      token: 'local-mock-token',
      user: { email: 'admin@memoryrelay.local' } 
    }));
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

server.listen(8787, '127.0.0.1', () => {
  console.log('Local fallback worker running on http://127.0.0.1:8787');
});
