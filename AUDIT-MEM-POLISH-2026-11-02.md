# MemoryRelay — Unslop, Frontend Design & Ponytail Audit

**Date:** 2026-11-02  
**Baseline:** `MemoryRelay-All-Screens-Frontend-Redesign-2026-11-02.zip`  
**Scope:** All shared UI styles and controls, Skills selector, monitoring (Worker + React), delegated verification, auth and sync code review.  
**Assumed load:** single owner, several agent connections, moderate event volume. Does not assert high-load readiness.

## What this repo does

MemoryRelay serves a private MCP endpoint and dashboard on Cloudflare Workers with D1. It manages memories, skills, third-party agent connections, GitHub skill updates, API provider keys, sub-agent delegation and activity metrics.

## Findings and actions

### Must fix

1. **Skill-count control reset while editing** (`src/modules/skills/SkillSelector.jsx`, `src/hooks/useSkills.js`). The controlled number input called the server on every intermediate keystroke; clearing it reset the value immediately. **Fixed:** use a stable 1–8 selector, with a persistent owner setting.
2. **Skill selection exceeded the maximum** (`worker/skills.js:selectSkills`). Prioritized skills were appended *on top* of the maximum optional skill count. **Fixed:** prioritize core skills within the total cap, use remaining slots for other skills, and enforce the limit for AI and keyword selection. If core skills exceed the cap, only the first prioritized skills are selected.
3. **Review could fail open** (`worker/delegate.js:delegate`). With `verify:true`, a reviewer returning no verdict, or returning no response, could leave `quality.ok` true. **Fixed:** missing/unknown reviewer results fail verification; `REVISE` also fails final quality unless a subsequent review accepts.
4. **Invalid skill counts were silently accepted** (`worker/skills.js:setSkillMax`, `worker/api.js`). Invalid input such as `0`, `9`, or an invalid string silently turned into another setting, sometimes with success status. **Fixed:** reject invalid values with HTTP 400 and preserve the saved setting.

### Should fix

5. **Activity missing useful short windows and trends** (`worker/monitor.js`, `src/modules/home/MonitorPanel.jsx`). Monitoring only offered 7/30/90 days and a single overall chart. **Fixed:** 1-hour (5-minute bins) and 1-day (hourly bins) plus 7/30/90-day trends, summary sparklines for MCP, skills, delegations, memory changes, dashboard API, model API, estimated tokens and errors; a compact chart for each recorded function. Raw counts come from D1, not fabricated client data.
6. **Decorative chrome and inconsistent control density** (`src/styles/screens.css`, `src/styles/system.css`, `src/styles/workspace.css`). Uninformative colored inset stripes on connection and memory rows; large controls and decorative accents competed with data. **Fixed:** remove inset accents, simplify small buttons and drop-downs, align control radii and padding, and preserve readable keyboard focus states. No new dependency or styling layer was added.
7. **Outdated delegation privacy assertion** (`test/delegate.test.js`). A test still expected no task summary despite the current dashboard storing bounded task summaries for live monitoring. **Fixed test:** verifies summary is bounded to the requested task; full delegated brief is not logged.

### Remaining risks / not verified

8. **Whole-delegation deadline** (`worker/delegate.js`, `worker/aifetch.js`). Multiple serial AI calls and retries have individual long network timeouts but no shared end-to-end budget. A slow provider can still delay the tool for minutes. Not changed in this targeted release because bounding a multi-provider workflow safely requires end-to-end cancellation tests.
9. **Fuzz test completion** (`test/audit.test.js`). The broad dashboard API fuzz test stalled past the execution limit; it was not counted as passed. A likely contribution is repeated cryptographic login work and slow provider paths, but root cause not proven. Investigate it independently.
10. **Production UI build and live endpoints:** Vite and Cloudflare production build, real OAuth callback, live GitHub scheduled sync, high-load SQL, cross-account authorization, and browser interactions were not rerun during this patch. Static JSX and CSS syntax were verified instead.

## Security observations

- Reviewed owner gating on `/api/*`, MCP service access, OAuth PKCE + callback validation, CSRF-related checks and hashed session handling; the existing core tests covering these paths passed.
- The delegation verifier fail-open issue was fixed. No independent penetration test or secrets-repository audit was performed.
- Event trends aggregate event metadata. The server does not add raw prompts, memory contents or API keys to monitoring rows. Task summaries may contain task descriptions and are intentionally stored (bounded length).

## Tests

| Check | Result |
|---|---|
| Core Node/D1 regression | **83 passed, 0 failed, 1 skipped** (live-upstream requirement) |
| Delegation regression | **15 passed, 0 failed** |
| Gestures regression | **3 passed, 0 failed** |
| JS/JSX syntax | **75 files, 0 errors** |
| CSS syntax | **7 files, 0 errors** |
| Complete `npm test` | **Timed out**; no complete-suite pass claimed |
| Vite production build | **Not run** (npm dependencies unavailable in this runtime) |

## Change size versus baseline

**14 files changed, +226 lines added, -74 lines removed, net +152 lines** (source, tests and styles; standard line-diff accounting, excludes generated build assets).

## Verdict

The reproducible skill-limit and verification problems are fixed, UI chrome is simpler, and monitoring has finer time windows and per-function charts. **Remaining operational risk:** long delegation workflows and uncompleted fuzz/production tests. No database data was intentionally deleted or migrated.
