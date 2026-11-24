# MemoryRelay — GitHub Token and Saved Model Catalogs

Date: 2026-11-03
Baseline: MemoryRelay-ChartJS-Full-2026-11-02.zip

## Changes

- GitHub skill sync shows whether the Cloudflare `GITHUB_TOKEN` Worker secret is configured (boolean only; token value never leaves Worker).
- GitHub skill sync includes an in-app collapsible setup guide: fine-grained GitHub PAT, Contents (read), Metadata (read), 90-day suggested expiry, Cloudflare Worker Settings > Variables and Secrets > Secret > GITHUB_TOKEN > Deploy. No GitHub token is collected in the dashboard.
- Models > Providers: opening the Models tab automatically fetches provider catalogs from already-saved enabled keys. The browser supports refresh, inline search and adding models without adding another key. OpenRouter can show public models without a stored key.
- Gemini models now display in a searchable inline list with Add/Added actions instead of only the original datalist. Auto-loads on Models tab entry.
- Backend catalog routes try up to five enabled stored keys (oldest first) if a key fails. The response never includes saved key values.
- Kept the existing Cloudflare deployment and Termux dev:live scripts. No database schema changes.

## Test results

- `npm run test:core`: 90 total, 89 passed, 0 failed, 1 skipped (existing live-upstream test).
- `test/saved-model-catalog.test.js`: 3/3 passed (saved Gemini and OpenAI key fallback; owner-only GitHub secret presence status with no secret disclosure).
- `node --check`: changed Worker/API and hook modules passed syntax checks.
- UI source wiring checks: 4/4 passed.
- Not tested: production Vite build and visual browser behavior. `npm install` timed out in this environment. Real provider HTTP APIs were mocked in tests; live API access remains to be checked after deployment.

## Deployment

Extract the hotfix into the existing ~/MemoryRelay directory (overwrite files), then:

```bash
npm install --ignore-scripts
npm run dev:live
# after local testing
git add -A
git commit -m "fix: load provider models from saved keys and document GitHub sync token"
git push origin main
```

If GitHub sync still shows HTTP 403, add/rotate the Cloudflare `GITHUB_TOKEN` secret separately. Do not include the token in source, git, .toml, or chat.
