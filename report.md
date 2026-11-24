# Repository audit — 2026-11-24

## Scope and verification

Memory Relay is a Cloudflare Worker + D1 backend and React dashboard for agent memories, MCP connections, OAuth, provider keys, and skills. The audit assumes several agents can write or import data concurrently.

Verification completed:

- `npm test`: 198 passed, 1 skipped, 0 failed.
- `npm run test:core`: 123 passed, 1 skipped, 0 failed.
- `npm run build`: passed.
- `npm audit --omit=dev --audit-level=high`: 0 vulnerabilities.

## Must fix

1. **The 5,000-memory limit can be bypassed by imports** (`worker/memories.js:207`).
   - Import rejects files containing more than 5,000 entries, but does not add the existing library size for merge imports.
   - Reproduced: importing two records into a 4,999-memory database succeeded and produced 5,001 records.
   - Fix: count existing non-replaced memories and reject when the final unique count would exceed `MAX_MEMORIES`. For replace mode, account for protected rule memories.

## Should fix

2. **Import reports records as imported when SQLite ignored them** (`worker/memories.js:239`).
   - `INSERT OR IGNORE` can discard duplicate IDs, but the response reports `rows.length` as the imported count.
   - Reproduced: two imported entries with the same ID returned `imported: 2`, while only one was stored.
   - Fix: reject duplicate IDs in the uploaded data and report inserted/skipped counts, or define an explicit update policy.

3. **Individual memory-cap checks are race-prone** (`worker/memories.js:52`, `worker/memories.js:153`).
   - The count and insert are separate operations, so simultaneous writers can each observe available capacity and all insert.
   - Fix: enforce the capacity in a transaction or a conditional insert.

4. **Encrypted OpenAI, NVIDIA, and OpenRouter keys cannot browse model catalogs** (`worker/api.js:181`).
   - The catalog route selects `key` directly from the provider-key table and passes it to `c.list()`.
   - When `KEY_SECRET` is configured, the stored value is `enc:v1:...`, so the Worker sends ciphertext as a Bearer token and the provider rejects it. The Gemini equivalent correctly uses `openRows()` first.
   - Fix: open the selected rows with `openRows(env, rows)` before calling `c.list()`, and return `LOCKED_MESSAGE` when every saved key cannot be decrypted.

5. **Service-worker cache writes are not tied to the fetch event lifetime** (`public/sw.js:18`).
   - The fetch handler returns the network response before the asynchronous `caches.open(...).then(c.put(...))` chain is registered with `event.waitUntil()`.
   - A browser may terminate the service worker once the response is returned, losing the cache write. Offline fallback can therefore be intermittent after a successful online visit.
   - Fix: create the cache-write promise, pass it to `event.waitUntil()`, and still return the network response immediately.

6. **Activity telemetry can grow without a practical volume cap** (`worker/mcp.js:191`, `worker/monitor.js:14`).
   - Every successful or failed MCP tool call inserts an `activity_events` row; skill selection can add more rows. Retention removes data only after 90 days.
   - The allowed rate is 300 requests/minute per connection: one runaway but valid connection can produce 432,000 rows/day, while dashboard aggregate queries scan the retention window.
   - Fix: cap retained event count per service/day, sample high-volume successful calls, or maintain bounded aggregate buckets and retain detailed events only briefly.

7. **The Errors screen cannot scroll on the application shell** (`src/shell/AppShell.jsx:57`, `src/styles/shell.css:8`).
   - Normal screens render inside `.pane`, which owns `overflow-y: auto`. The Errors screen is rendered directly inside `.main`, whose overflow is hidden.
   - More than a viewport of errors, including its pagination controls, is inaccessible on the Errors route.
   - Fix: render `ErrorsScreen` inside the same scrollable pane structure as normal screens, or give its route wrapper `height: 100%; overflow-y: auto`.

8. **“Back to overview” on the Errors screen does not navigate** (`src/shell/AppShell.jsx:30`, `src/modules/home/ErrorsScreen.jsx:26`).
   - Errors is an overlay route, but `tabId` remains `home`. Calling `go("home")` enters the current-tab branch in `select()` and only tries to scroll the hidden Home pane.
   - Fix: scroll only when `route === id` as well as `id === tabId`; otherwise navigate to the requested route. This also makes pressing the Live tab from Errors work.

9. **Model browsing does not enforce text-only models** (`worker/openrouter.js:9`, `worker/providers.js:9`).
   - OpenRouter accepts every free model without considering modalities. The NVIDIA/OpenAI filters are name-based exclusion lists, and Gemini accepts every model with `generateContent`; multimodal, image, audio, or video-capable models can pass those tests.
   - Fix: filter on provider-supplied modality/capability metadata where available; otherwise use a conservative allowlist of text-generation model families and label any fallback behavior clearly.

## Nice to have

10. **A duplicate delete adds an unnecessary D1 round trip** (`worker/githubSkills.js:240`).
   - `removeSkillRepo` deletes from `skill_repo_stage` twice with the identical statement.
   - Fix: remove one statement.

11. **The repository includes a full duplicate worktree and release archive.**
   - `memoryrelay-v3.6.0-work/` is tracked with 294 files, and `MemoryRelay.zip` is also tracked.
   - The duplicate snapshot is about 6.9 MB and can drift from active source.
   - Fix: publish archives as release assets or external artifacts and retain a manifest/checksum in the source repo.

## Not checked

Live Cloudflare deployment configuration, real D1 concurrency under production traffic, and third-party provider credentials/endpoints.

Semgrep was not available in this environment, so no Semgrep ruleset scan was run.
