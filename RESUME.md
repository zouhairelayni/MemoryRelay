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
