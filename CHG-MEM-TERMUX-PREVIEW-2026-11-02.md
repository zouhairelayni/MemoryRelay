# MemoryRelay Termux preview fix — November 2, 2026

## Problem
- `npm run build:local` / `npm run preview` were missing because the old `package.json` was kept during extraction.
- `npm run dev` forwarded `/auth` and `/api` to local port 8787. `workerd` does not run natively on Android/Termux, so login could not reach the backend.

## Fix
- Added explicit opt-in `npm run dev:live` and `npm run preview:live` for authenticated UI inspection against the deployed Cloudflare Worker.
- Proxies only `/auth` and `/api` in live-preview mode, with the Worker's Origin header for its CSRF checks.
- Binds the preview to `127.0.0.1` to avoid sharing a production-authenticated proxy across a LAN.
- Preserves `npm run dev` for desktop development with local Worker, and local Vite build/preview scripts.
- No backend or database changes.

## Test plan
- `npm run test:core` verifies the existing Worker and skill regressions.
- `npm run build:local` compiles the UI if dependencies are installed.
- On Android visit http://localhost:5173 after `npm run dev:live`; sign in using your existing MemoryRelay credentials.
- `npm run preview:live` serves a compiled build from http://localhost:4173.

## Important
**Live-preview uses the real production account and database.** Avoid editing/deleting real data when testing. Do not expose port 5173 to other devices. Do not copy `localhost` MCP connection links from this preview; obtain connector links from the production site.
