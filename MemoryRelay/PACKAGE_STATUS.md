# MemoryRelay — Source Snapshot Package Status

This archive contains the full current working source tree for the ongoing consolidated MemoryRelay upgrade.

## Package identity
- Working directory snapshot: `memoryrelay-v3.6.0-work`
- `package.json` version: `3.5.1` (not bumped; final consolidated release versioning is intentionally deferred)
- Package type: **working source snapshot**, not a release-ready build

## Verification performed at packaging
- `npm test`: **184 passed, 0 failed, 1 skipped (185 total) after Round 7 patches P16-P17**
- The skipped test requires an upstream sync and is explicitly skipped in the offline runner.
- `npm run build`: **not verified** — local dependencies were incomplete and `vite` was unavailable (`sh: 1: vite: not found`). Dependency restoration previously timed out.
- No production bundle, deployment, browser visual regression, or release installer was verified as part of this package.

## Setup
1. Extract the archive.
2. Install Node.js 24 (or a supported Node version for the dependencies).
3. Run `npm ci`.
4. Run `npm test`.
5. Run `npm run build` before treating this snapshot as deployable.
6. Configure Worker secrets and deployment settings using `.dev.vars.example`, `wrangler.toml`, and the project README. Never commit real secrets.

## Scope
This snapshot preserves the full source, tests, docs, worker, scripts, and public assets. It excludes `node_modules`, local secrets, and generated build output. Remaining consolidated upgrade tasks and final release documentation/versioning are not complete.
