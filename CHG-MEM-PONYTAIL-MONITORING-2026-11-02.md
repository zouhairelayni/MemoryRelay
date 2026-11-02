# MemoryRelay — Release changelog and handoff

**Batch:** 2026-11-02 Ponytail / Monitoring / GitHub Skill Sync / OAuth
**Source:** `MemoryRelay-Ponytail-Monitoring-2026-11-02.zip` (project files at archive root)
**Status:** Prepared and locally tested; not deployed or live-verified in this batch.

## READ FIRST

- Existing MemoryRelay Cloudflare Worker/D1 project; retain the existing environment secrets, D1 data, and worker hostname.
- Full source ZIP builds on the prior `MemoryRelay-GitHub-Sync-OAuth-Fix.zip`.
- No user database or live Cloudflare deployment was modified during this batch.
- Android/Termux: use `npm install --ignore-scripts` if local npm setup requires it. GitHub/Cloudflare CI performs production build.

## Changes included

1. **Resumable GitHub skill sync:** one repository per scheduled run; eight files maximum per batch. D1 stores commit SHA, queue, file counts, error and status. Automatic Cloudflare cron every two minutes resumes active batches; enabled repositories receive a daily version check. Disabling sync leaves installed skills alone. The UI polls repository status every 12 seconds and displays progress, completion, and useful error messages. `Sync now` starts or resumes an import. Unauthenticated GitHub REST API may still return 403 if its rate quota is exhausted; an optional `GITHUB_TOKEN` is supported both at runtime and during the build-time Anthropic importer.
2. **Skill management:** default ten most recently added, with sorting for recently updated, most used, all/enabled/disabled and 'show 10 more'. Accurate per-skill use counts are recorded from selections. Python scripts have a separate, collapsible, filtered view from non-script reference files; each shows only eight items before 'more'. LICENSE/LICENCE/NOTICE/COPYING files are excluded from GitHub imports and the bank, and a one-time cleanup removes previously imported license files. Removing a skill deletes its linked scripts, reference records, and history, but never blocks future approved reinstallation.
3. **Global activity monitoring:** D1 activity events for MCP operations, skill selections, AI provider calls, estimated input/output tokens, errors and HTTP API calls. Dashboard shows counts, daily line chart, weekday/hour heatmap, error code and message, and recent calls. Token numbers are estimates, not provider billing figures.
4. **Subagent task monitoring:** records running/completed/failed state, delegated task summary (capped to 320 characters), provider/model, kind, approximate tokens, duration, and error. Running elapsed-time values update every second without rerendering the whole analytics dashboard. After 20 minutes a still-running task displays 'Check for stalled task' rather than incorrectly claiming completion. Unexpected delegated call errors are marked failed in D1.
5. **OAuth and connections:** fixed CSP external callback handling from earlier hotfix; OAuth now defaults to a **new connection** on every authorization, with an optional explicit reuse choice. Connection name and access level are chosen before allowing. Same app with different external accounts can create separate connections; the server cannot discover the external Claude/Gemini account identity. Connections can be renamed in the dashboard.
6. **Minimal refactor:** existing modules and conventions preserved; no new UI/runtime dependencies, no new execution rights or auth bypass. Monitoring errors do not prevent successfully completed MCP tool calls.

## Tests and limits

| Check | Result |
|---|---|
| `npm run test:core` | **76 pass, 0 fail, 1 skipped**, 77 total |
| Official Github mock importer test | Pass |
| Backend Worker and scripts `node --check` | Pass |
| Builtin CRUD, OAuth, permissions and skill cleanup regression | Included in core suite |
| Full `npm test` suite | **Not completed:** slower delegation test timed out in this environment |
| `npx vite build` | **Not verified:** npm dependency installation timed out in this environment |
| Actual Cloudflare GitHub 403/resume behavior | **Not live-verified** |
| New Claude/Gemini OAuth multi-account handshake | **Not live-verified**; mocked tests pass |
| Actual model usage and provider billing counts | Not verified; UI labels estimates |

## Deployment handoff

After extracting into `~/MemoryRelay` in Termux, check and commit the source as usual. A push triggers the existing GitHub-to-Cloudflare build when linked. `wrangler.toml` configures a two-minute scheduled trigger; review Cloudflare's cron deployment status after release. If GitHub API responds 403 after deploying, configure an appropriately scoped GitHub token as the `GITHUB_TOKEN` Worker secret and, if CI build-time GitHub import is rate-limited, as the build environment secret too. Do not put tokens into the repository.

## Known follow-ups

- Live GitHub sync/error and scheduled-run verification with Cloudflare logs.
- Browser QA of the monitor and mobile skills layout after CI build.
- Real OAuth authorization from a second account in Claude/Gemini.
- Full slower delegation test suite in CI where upstream network access is available.
