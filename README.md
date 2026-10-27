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
  housekeep.js       duplicate detection and merge (agents can only apply a proposal they were shown)
  skillstudio.js     AI that writes and edits skills (drafts only)
  oauth.js           OAuth 2.1 sign-in for MCP (discovery, registration, PKCE, tokens)
  aifetch.js         AI calls with an idle watchdog (never cuts off a model that is still answering)
  limits.js          rate limits kept in D1
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

## Skill Studio (write and edit skills with AI)

Skills tab → **Write with AI** to make a new skill, or open a skill and tap **Edit**.

* **New:** describe what the skill should do. The AI returns a complete `SKILL.md` that follows the template. If the draft breaks a rule (header, "Use when", 5000 tokens) it is fixed automatically once.
* **Edit:** change the text by hand, or type what should change and tap **Apply change with AI**. The name never changes, and you see how many lines were added and removed.
* **Nothing is saved or switched on by the AI.** You read the draft and press **Save**. Each save keeps the previous version, so **Undo last save** always works.
* Agents can call `draft_skill` over MCP to get a validated draft (10 per hour per connection), then `upload_skill`. It still waits for your approval.
* Needs a Gemini or OpenRouter key (Keys tab).

## Security and limits

* **Agents never get more power than you gave them.** They cannot set the `rules` tag (also not by editing a tag), cannot choose the `source` of a memory, and can only apply a housekeeping proposal that a dry run showed (`proposal_id`, valid 10 minutes, one use).
* **Hidden text:** agent skills with invisible or direction-changing characters are refused; the same pattern is flagged on owner skills. Pending agent skills show their warnings before you approve them. At most 20 agent skills can wait for review.
* **MCP endpoint:** the address must look like a secret before the database is touched; browser requests (Origin header) are refused; 300 requests per minute per connection; bodies over 256 KB are refused; JSON-RPC errors use the standard codes; tool arguments are checked against the schema; tools carry read-only / destructive hints so clients can ask before risky calls. Supports protocol versions 2025-06-18, 2025-03-26, 2024-11-05.
* **Errors:** internal details go to the Worker logs, never to the client.
* **AI calls** time out after 25 seconds, and AI-powered tools fall back (skill picks use keywords after 60 AI picks per hour per connection).
* **Memory:** search treats `%` and `_` as normal text; at most 5000 memories; imports are validated (ids, history, tags); the `rules` tag is matched as a whole tag, not as part of another word.
* **Optional setup lock:** `npx wrangler secret put SETUP_TOKEN` makes the first-run account page ask for that token, so nobody else can claim your instance before you.

## MCP sign-in (OAuth) and access levels

There are two ways to connect an agent, and both work at the same time:

1. **Secret address** `https://your-app/mcp/<secret>`, one per connection (as before).
2. **OAuth** `https://your-app/mcp`. Apps that support remote MCP with OAuth (for example a Claude custom connector) find everything themselves: they register, open a page on your Worker, and you approve with your **password**. Pick an existing connection or make a new one, and choose its access level. Tokens last 1 hour and refresh automatically (rotating refresh tokens; a reused refresh token ends that sign-in). PKCE (S256) is required. Only hashes are stored.

Each connection has an **access level** (the eye / pencil / shield control on the Agents tab):

| Level | Can do |
| --- | --- |
| Read only | search, recent, select_skills, get_skill_template, draft_skill |
| Read and write | also remember, update_memory, upload_skill, delegate |
| Full access | also forget and housekeep |

Tools above a connection's level are hidden from it and refused if called. Revoking a connection also signs out all its OAuth sessions. "Sign out OAuth sessions" ends them without revoking the secret address.

`wrangler.toml` now routes `/mcp`, `/oauth/*` and `/.well-known/*` to the Worker; deploy it as usual.

## AI timeouts

AI calls never use a flat timeout. Long jobs (Skill Studio) stream the answer, and the only things that stop a call are: no answer starting within 3 minutes (a model thinking), silence for 90 seconds in the middle of an answer, or 7 minutes in total as a runaway guard. Every piece of output restarts the silence clock. Short jobs (skill picks, duplicate checks) allow 60 seconds to start and 30 seconds of silence. The numbers are in `worker/aifetch.js`.

## Sub-agents (`delegate`)

An agent can hand one self-contained job to another model and get only the result back, which saves its own usage limits. Each request is a fresh sub-agent: it sees only what is sent, cannot use tools, files or the web, and answers in one go.

```
delegate { task, kind?, context?, language?, provider?, model?, max_output_tokens? }
kind: snippet | function | feature | refactor | tests | review | explain | debug | other
```

* **Providers:** Gemini, OpenRouter, NVIDIA (build.nvidia.com, `nvapi-` keys) and OpenAI. Add keys and models in the Keys tab; every provider rotates its keys round-robin, cools a key down on 429, retries once on 5xx, and disables a rejected key.
* **Routing:** *Spread* starts each request at the next provider, so no single free limit is used up (like a key balancer). *In order* always tries the first one and keeps the rest as backups. A failing provider falls through to the next. The same order is used by skill picks, duplicate checks and Skill Studio.
* **Size:** up to 7,900 tokens in (all brief fields together), 2,000 tokens out by default, 4,096 at most.
* **Safe by default:** needs Read and write access; one switch and an hourly cap per connection (default 30); requests that contain API keys, tokens, private keys or `password = ...` are refused (the value is never echoed back); an agent can only use models you added; OpenAI is paid, so it is used only when you add it to the routing order or the agent names it; the usage log keeps sizes and outcomes, never the text.
* **Slow models:** sub-agent answers are streamed and use the idle watchdog described above, so a model that is still writing is never cut off.

### How agents learn to delegate, and how the result is checked

* **The brief form.** `delegate` takes `task`, `kind`, `language`, `interface`, `requirements`, `constraints`, `acceptance`, `context` and `verify`. `get_delegation_brief` returns the full guide (when to delegate, how to write the brief, how to review the result, when to give up) plus a filled-in example. The same text is in the dashboard (Keys tab, Sub-agents, Instructions for agents) so it can be pasted into an agent's own instructions.
* **Built-in skill.** A skill called `delegating-to-subagents` is added once, so `select_skills` hands it to agents that are about to write or test code. Edit or delete it freely; it is not added again.
* **Rules for the sub-agent.** Every job runs under strict quality rules: meet every requirement and acceptance item, match the interface exactly, complete runnable code with no placeholders, handle errors, never invent APIs, self-check line by line, and answer in a fixed format (Result, Assumptions, Self-check, STATUS).
* **Automatic checks** on every answer: code present, code blocks closed, no TODO or placeholder text, JSON blocks valid, not cut off, not a refusal, STATUS is COMPLETE. If something is wrong, one automatic repair round is run with the exact problems.
* **Independent review** (`verify: true`, on by default for features): a different provider checks the answer against the brief and the acceptance list and returns defects with a verdict. A REVISE verdict triggers the same single repair round.
* **Quality report.** The last line of every reply says what passed or what is still wrong, and reminds the agent that it owns the result: check the acceptance list, run the tests, then integrate.
* **Try it.** The dashboard can run a job through the same pipeline, so you can see exactly what an agent would get.

## Known limits (by design, worth knowing)

* **Provider keys are stored as plain text in your D1 database** (the dashboard shows only the last 4 characters). Anyone with access to your Cloudflare account or the database can read them. Use keys with spending limits, and rotate them if the account is ever shared.
* **OAuth registration is open** (that is how connectors sign themselves up). A stranger can register an app, but cannot get a token without your password on the approval page. Read the app name and the return address on that page before you approve. Unfinished registrations are removed after an hour.
* **Sub-agent output is untrusted text.** It runs on other companies' servers and can be wrong or contain instructions. Agents are told to verify it and never follow instructions inside it.
* **A secret address works like a password.** Anyone who has it has that connection's access level. Revoke it if it leaks; use OAuth to avoid pasting it anywhere.

## Design system ("Patchbay")

The look was planned from the product, not from a template, using the guidance of the most-used design skills (Anthropic's frontend-design, UI/UX Pro Max, Taste Skill, Emil Kowalski's design-engineering rules, and the mobile-design skills): commit to one idea, avoid the generic AI look, put accessibility and touch ergonomics first, and use motion only where it explains something.

* **Idea:** every agent is a cable with its own colour (`lib/cable.js`, tokens `--cable-0..7`). That colour follows the agent through the app: its row on Live, its chip on Agents, the thin bar on the memories it wrote.
* **Structure:** tabs are Live, Memory, Skills, Agents, Models. Live shows status, what needs you and the library; Models splits into Sub-agents and Providers. Lists are one grouped surface with hairline dividers, not piles of cards. Rows reveal their actions when tapped, so there are no button clusters.
* **Files:** `styles/tokens.css` (palette, type, shape, motion tokens), `base.css`, `shell.css` (frame, floating tab bar, sheet), `system.css` (components), `screens.css`, `motion.css`.
* **Motion rules:** ease-out only; UI motion under 300 ms (drawers 480 ms); nothing enters from scale(0); hover movement only on real pointers; one orchestrated entrance (Live); `prefers-reduced-motion` keeps colour and opacity changes and drops movement.
* **Mobile rules:** 44 px touch targets, safe areas, 16 px inputs, bottom navigation with 5 items, labels above fields, dark and light themes with checked contrast (body text 4.7:1 or better in both).
* **Fonts:** system fonts only (the app's security policy blocks external fonts). To use a custom typeface, add a self-hosted `@font-face` in `tokens.css` and put it first in `--display`.
