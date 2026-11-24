# MemoryRelay audit - resume file (2026-11-11)

## Findings (mini audit)
1. GitHub sync stuck at 8/N: one "Sync now" processes only 8 files; the queue is resumed by cron ONLY for repos with auto-sync ON. Repos with auto-sync off stay "running" forever. UI text "Continues automatically" is false for them.
2. GitHub 403: unauthenticated api.github.com = 60 req/h per shared Cloudflare egress IP; every retry re-burns it. After a failure last_checked is set, so cron then waits 24h even though the repo never synced. No global pause/backoff, no ETag.
3. A skill whose SKILL.md name != folder (taste-skill) throws inside finishOneSkill, queue never advances (0/1 forever).
4. "ponytail doesn't exist": agents can only reach skills through select_skills (ranker, max 3 slots, Gemini may return none). No get/list tool, no exact-name match, empty result says "no skill needed".
5. Lag: seedBuiltins never sets `seen` (5 D1 reads + 1 write on EVERY request); listSkills loads every full body + joins unindexed activity_events; activity row written on every API GET (UI polls); activity_events never pruned; select_skills can wait up to 150 s on LLM; Gemini round-robin = 2 extra D1 round trips; GithubSources polls every 12 s even when tab hidden.
6. Security: local.db ships plaintext admin@memoryrelay.local / password123; server.js stub accepts any login + CORS *; login_fails lock never resets after expiry and never pruned; import endpoint reads unbounded body; get_skill_resource/script ignore enabled flag; GitHub-synced text auto-applied (hidden chars not checked); Gemini 403 disables key for any 403.

## Patches
- [x] P1 GitHub sync (worker/githubSkills.js, worker/db.js, worker/index.js cron, worker/api.js, src/modules/skills/GithubSources.jsx)
- [x] P2 skill lookup (worker/skills.js, worker/mcp.js, worker/constants.js)
- [x] P3 (tests in test/perf-audit.test.js) performance (builtins, listSkills, monitor/activity, db indexes, pick timeout, gemini/compat)
- [x] P4 (tests in test/security-audit.test.js) security (auth lockout, import cap, server.js, local.db, .gitignore, gemini 403)
Deliver zip after every 2 patches, then continue without asking.

## Round 2 (2026-11-12) requests
- sync must say what happened: added/updated/unchanged/adopted/skipped per repo, skill counter + file counters per repo, detect existing repo and pasted skills with same name (adopt option), say when repo/branch/folder not found
- import scripts + .mjs/.js/.ts/.sh tests + fonts (woff/woff2/ttf/otf, base64) and deliver to agents (chunked get_skill_resource, FILES section)
- per-repo filters: file types, path globs, max size
Patches: [x] P5 backend (db cols, githubSkills filters/binary/adopt/summary/counters, api route) [x] P6 agent delivery + UI + tests; zip after P6

## Round 3 (2026-11-12) "fix the gaps" = leftovers 5 and 6
- [x] P7 file management per repo: list imported files by skill (kind, size, source repo), preview text, delete one file (kept out of future syncs via excluded_files), restore. Files: db.js col excluded_files, githubSkills.js, api.js, endpoints.js, GithubSources.jsx (RepoFiles)
- [x] P8 quota: manual Sync now uses the free 304 shortcut when nothing is pending (force option), GitHub quota (remaining/limit/reset) remembered from response headers and shown in the app. Zip after P8.
Round 4 (continue): [x] P9 SETUP_TOKEN lock on non-localhost [x] P10 delegation shared time budget (dg_budget_ms, default 110 s). OAuth registration reviewed: already capped, pruned, redirect-validated, consent shows return host: no change. [x] P11 KEY_SECRET encryption [x] P12 update_mode safe|review|all. Nothing left open from the audit. [x] P13 end-to-end complex skill test (test/skill-e2e.test.js).

## Round 5 (2026-11-13) skills not only in /skills
Reported: repos (impeccable, ui-audit, ui-ux-pro-max-skill, taste-skill) have skills outside skills/, or a folder name different from the SKILL.md name.
- [x] db: skill_map + detect_v columns; existing repos re-checked once
- [x] repoArgs default root '' (auto), accepts /tree/<ref>/<folder> URLs; cleanOpts accepts root
- [x] startSync: find every SKILL.md at any depth (incl. repo root), dedupe same-named copies (prefer visible skills/ folders), fall back to auto when the chosen folder is empty, files belong to nearest skill folder
- [x] finishOneSkill: install under declared name (no folder/name mismatch error), conflict/duplicate handling at install time, skill_map
- [x] UI: folder field blank = automatic; show root or "automatic"; folder editable in File settings; zip r6

## Round 6 (2026-11-13) "how do 5 repos deplete 60 calls/hour?"
Facts: designed cost = 1 API call to check (0 quota when 304) + 1 for the file tree when changed; cron 1 repo/2 min, 24 h between successful checks. 9 repos (not 5) are tracked. "0 of 60" is GitHub's count for the Worker's SHARED egress address, and the app never counted its own calls, so it could not prove who used them.
- [x] P14 detect changes with git smart-HTTP info/refs (0 API calls, works while API is paused), tree by commit sha (1 API call per real change), own-call counter shown next to the quota, tests count api.github.com calls only
- [x] P15 anthropics/skills repo shows "0 skills imported / files (0)" because its skills are source builtin:anthropic-official: count and list them for that repo
- [ ] zip r7
