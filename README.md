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

## Skill Genie

Skills are stored in D1 and chosen by Gemini (or keywords when Gemini is unavailable). Agents do not browse the library.

* **Import:** Skills tab → Add → paste a `SKILL.md` or choose a `.md` file. The header needs `name:` and a `description:` that says when to use it ("Use when ...").
* **Switch:** turn skills on or off, or mark one **Always on** (always sent to agents when enabled).
* **Try:** type a request to see which skills an agent would get and why.
* **Max per request:** how many skills the Genie may send (1 to 8, default 3).

An agent calls the MCP tool `select_skills` with its request (and optionally the files and functions it will touch). The Genie returns only the chosen `SKILL.md` texts, or says that no skill is needed. The MCP handshake tells agents to call it first, so Claude, Gemini, ChatGPT or any other MCP client gets this behaviour with no extra setup.

Skills are text an agent obeys. Import only what you trust. Risky patterns (pipes into a shell, `rm -rf`, links, secrets) show a warning but are not blocked.

## OpenRouter

Keys tab → OpenRouter. Paste a key that starts with `sk-or-`, then tap **Browse free models**. The list shows only models whose prices are zero, so nothing you add bills you. Tap **Add** on the ones you want, and reorder them. Gemini is tried first; OpenRouter is used when Gemini is missing or fails, for housekeeping and skill picks.

## Agent-made skills

Agents can add skills of their own over MCP:
1. `get_skill_template` returns the required format (frontmatter `name` and `description`, then sections: When to use, Steps, Rules, Output, Example). It is based on the same format as Anthropic's skills.
2. `upload_skill` with the full SKILL.md text. The description must say when to use the skill ("Use when ..."). Each skill is limited to **5000 tokens**; longer skills are refused with the count.

Agent uploads are saved as **pending** and are never sent to other agents until you switch them on in the Skills tab. Owner uploads go live at once. Token counts are estimates (the larger of characters/4 and words×1.3).
