# Memory Relay

One space that connects and empowers your agents. A Cloudflare Worker (logic, `.js`) with a D1 database, and a React app (screens, `.jsx`) served from the same Worker.

## Where things go

| What | Where |
| --- | --- |
| D1 database id | `wrangler.toml` → `database_id` (it is an identifier, not a secret) |
| Real secrets (future API keys for other services) | `npx wrangler secret put NAME` in production, `.dev.vars` locally (never committed) |
| Logins, memories, connections, Gemini keys | inside D1 (tables are created automatically on first run) |

Put your real id in `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "memory-db"
database_id = "<your real id>"
```

## Run and deploy

```bash
npm install
npm run dev          # React app with hot reload on http://localhost:5173
npm run dev:worker   # in a second terminal: the Worker and local D1 on :8787 (the app proxies to it)
npm test             # unit tests (Worker modules and swipe logic)
npm run deploy       # builds the app into ./dist and deploys Worker + app
```

Your existing data and agent addresses (`/mcp/<secret>`) keep working: it is the same database and the same URLs.
The installed app keeps its identity too (`id: /dashboard` in the manifest).

## Structure

```
worker/            server logic (plain .js, no UI)
  index.js           routing only: /mcp, /auth, /api, everything else = the React app
  api.js             owner API route table
  auth.js            accounts, sessions
  memories.js        memory storage + the "rules" protection
  mcp.js             the MCP endpoint agents talk to
  services.js        connections (one address per agent)
  gemini.js          key and model pools, rotation, 429/503 handling
  housekeep.js       duplicate detection and merge
  metering.js        reads / writes / deletes per connection
  db.js constants.js util.js

src/               the app
  main.jsx App.jsx
  api/               client.js (the only fetch), endpoints.js (one function per route)
  hooks/             all logic: useServices, useMemories, useGemini, useSwipePager, useSwipeDeck, ...
  lib/               gesture.js (pure swipe maths), clipboard.js, format.js, storage.js
  components/        building blocks (.jsx): Button, Switch, Segmented, Collapse, ActionRow, Sheet, Icon
  shell/             AppShell, Pager (swipe between tabs), TabBar, TopBar, AuthGate
  modules/           one folder per tab: home, agents, memory, keys, skills  (+ index.js registry)
  settings/          the settings sheet, one file per section
  styles/            tokens.css (light/dark), base, shell, cards, forms
public/            manifest, service worker, icons
test/              node:test unit tests
```

## Adding a module (a new tab)

1. Create `src/modules/<id>/<Id>Screen.jsx` (it receives `{ active }`).
2. Add one line to `src/modules/index.js`. It becomes a bottom-bar tab and a card on Home automatically.
3. Server side: add `worker/<id>.js` and its routes in `worker/api.js`; add its calls to `src/api/endpoints.js` and a hook in `src/hooks/`.

More API-key providers: add a panel next to `src/modules/keys/GeminiPanel.jsx` and list it in `src/modules/keys/providers.js` (a provider switcher appears by itself).

## Plugging in the skill selector

`src/modules/skills/SkillSelector.jsx` is the slot. Replace it with your component; it is given the list of connections. The file explains the suggested server wiring (a `skill_grants` table and `/api/skills` routes).

## Gestures

* Swipe left and right anywhere on a screen to change tab (can be switched off in Settings).
* Agent cards swipe on their own (the card area never changes tab).
* Swipe the settings page to the right to close it. Android back and Esc close it too.
* Swipes that start in a text field are ignored.
