# MemoryRelay — Second-Pass Ponytail Audit

**Date:** 2026-11-02  
**Baseline:** `MemoryRelay-Unslop-Ponytail-Audit-2026-11-02.zip`  
**Assumed load:** one owner, several MCP connections, moderate activity and skill-resource volume.  
**Method:** traced Worker routes, D1 storage, OAuth, skills/imports, delegation, monitoring, UI controls, and tests; reproduced four bugs with local Node/D1 and mocked requests. Reviewed code, not deployed Cloudflare state.

## What this repo does

MemoryRelay is an owner-controlled MCP server and dashboard on Cloudflare Workers and D1. It stores memories and skills, connects OAuth/MCP clients, delegates tasks to AI providers, synchronizes GitHub skill repositories, and records activity.

## Must fix — found and corrected in attached source

1. **Secret MCP address in error logs** (`worker/index.js:94–95`). When D1 failed during a POST to `/mcp/<secret>`, the global exception handler logged the full URL path. **Reproduced:** synthetic 32-character secret was present in captured `console.error`. **Fix:** log `/mcp/[redacted]`, not the token-bearing path. **Risk if skipped:** anyone with access to Worker error logs could recover bearer-style connector URLs. Rotate a real secret only if logs actually exposed it.

2. **GitHub skills silently lose script/resource listings** (`worker/skills.js:304–311`). `selectSkills` populated resources only for `builtin:anthropic-official`; after GitHub sync changed source to `github:...`, even stored scripts were absent from the selected skill. **Reproduced:** resource existed in D1 but was missing from the selection and agent response. **Fix:** return resources for all selected skills; retain short scripts inline, leave larger files available via `get_skill_resource`, and query only selected skills rather than the entire bank. **Risk if skipped:** skills silently lose important supporting instructions and tooling after updates.

3. **Gemini delegation requests incompatible JSON output** (`worker/delegate.js:186–190`, `worker/gemini.js:25–27`). The delegation prompt and validator expect Markdown code blocks, but Gemini was asked for JSON by default. **Fix:** force plain text for generation, review and repair in the shared delegation call. **Regression:** asserted absence of `generationConfig.responseMimeType` in a mocked Gemini provider request. **Risk if skipped:** malformed or shortened answers, unnecessary repairs and false quality failures.

4. **Running subagents disappear from the activity monitor** (`worker/monitor.js:25–29`). The 40 newest jobs could all be completed while an older job was still running; the monitor then displayed zero active agents. **Reproduced:** one running + forty newer completed jobs returned `active:0`. **Fix:** prioritize running jobs in the bounded list and count all running jobs in a separate query. **Risk if skipped:** misleading operations dashboard and concealed active/stalled jobs.

## Should fix — not included in this focused patch

5. **No shared overall deadline for a delegated workflow** (`worker/delegate.js:186–282`, `worker/aifetch.js:8–20`). Generation, independent review and repair each have their own potentially long provider timeouts. One request can exceed an interactive MCP client’s patience or end mid-work. Introduce a single end-to-end deadline with remaining-time propagation and explicit timeout state. No live provider load test was performed.

6. **Activity-event storage grows without retention** (`worker/monitor.js:3–5`, `worker/db.js:38`). `activity_events` is append-only; dashboards query up to 90 days but older records have no cleanup. Add a scheduled purge older than the supported retention range and make it incremental under D1 limits. At the assumed load this is a scaling/maintenance issue rather than an immediate outage.

7. **Production build depends on GitHub availability** (`package.json`, `scripts/sync-anthropic.mjs`). Every build fetches upstream Anthropic data; a GitHub 403 or network failure fails the build even when deployed skills already exist in D1. Consider a verified committed upstream snapshot, with GitHub updates handled by the existing scheduled importer. This was not reproduced against live Cloudflare CI.

8. **Fuzz and live deployment validation remain incomplete** (`test/audit.test.js`). The broad malformed-body fuzz path stalled, consistent with the previous audit. Live OAuth, GitHub scheduled syncing, and long-running subagents were not independently load-tested. Do not infer production security from unit tests alone.

## Tests and changes

| Check | Result |
|---|---|
| Original core suite | 83 passed, 1 skipped, 0 failed |
| Patched core + delegation + gesture suite | **103 passed, 1 skipped, 0 failed** |
| Secret-path leak reproduction | Confirmed on baseline; regression passed after patch |
| GitHub script selection reproduction | Confirmed on baseline; regression passed after patch |
| Gemini request-format regression | Passed |
| Older running-job visibility regression | Confirmed on baseline; passed after patch |
| Worker and sync-script syntax | Passed |
| Broad fuzz / full npm test | Not completed (stalled) |
| Vite/Cloudflare production build and live OAuth | Not verified |

**Changed files:** `worker/index.js`, `worker/skills.js`, `worker/delegate.js`, `worker/monitor.js`, `test/hardening.test.js`, `test/github-repo-sync.test.js`, `test/delegate.test.js`, `test/monitoring.test.js`. No new runtime dependencies. No database schema change. UI layout untouched in this patch.

**Verdict:** The prior audit missed four reproducible defects, including one security exposure. All four have focused fixes and regression tests in the accompanying ZIP. The delegation time budget and long-term event retention remain the most important unaddressed operational issues.
