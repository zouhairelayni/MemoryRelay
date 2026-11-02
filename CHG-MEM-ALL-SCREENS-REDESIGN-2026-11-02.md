# CHG-MEM — Full Interface Redesign

**Date:** 2026-11-02  
**Baseline:** `MemoryRelay-Ponytail-Monitoring-2026-11-02.zip` (previous complete project source)  
**Status:** Source patch complete; production deployment not verified.

## Read first

This is a complete replacement source ZIP (project files at ZIP root). All five primary tabs, the Settings sheet, the owner sign-in/setup gate, and the OAuth sign-in/consent pages have been visually updated with the same Signal Desk design language. Existing Worker API contracts, database schema, skill sync, metering, subagent logic, privacy controls, navigation and connection actions are preserved.

## Design

- Mobile: compact top brand bar, persistent bottom navigation, accessible controls and scrollable screens.
- Desktop (800px+): full-window workspace with dedicated dark left navigation rail and usable content width; no 760px-wide phone frame.
- Live: connection-health hero; Agents/Library side-by-side on desktop, stacked on mobile; integrated monitor styling.
- Memory: readable ledger rows, clearer edit/focus states and search controls.
- Skills: consistent skill list, sync controls and separated scroll-contained script/reference sections.
- Agents: structured connection cards, identity switcher and access controls.
- Models: consistent provider/delegation controls.
- Settings: compact section groups; right-side sheet on desktop, full-height mobile sheet.
- Owner sign-in: distinct split introduction on desktop and streamlined mobile sign-in.
- OAuth pages: match dashboard palette, typography, fields and buttons without changing auth or redirect logic.
- Supports light/dark/system themes, keyboard focus and reduced-motion preferences.
- No new JavaScript dependencies or external fonts.

## Additional corrective fix

Fixed a previously existing JSX syntax error in `src/modules/skills/ScriptBank.jsx` (`setResources(...` / Promise chain closing parentheses) that was invisible to Node's Worker-only tests and could block a Vite build.

## Modified areas

`src/styles/workspace.css` (new, loaded after legacy styles), `src/main.jsx`, five `src/modules/*/*Screen.jsx` files, `src/modules/home/HomeScreen.jsx`, `src/shell/{TopBar,TabBar,AuthGate}.jsx`, `src/modules/skills/ScriptBank.jsx`, `worker/oauth.js` (page CSS only), `package.json` (test command), `test/workspace-ui.test.js` (new).

## Verification

| Check | Result |
|---|---|
| `npm run test:core` | **79 pass, 0 fail, 1 skip** (80 tests) |
| Parse all `.jsx` files with TypeScript's JSX parser | PASS |
| CSS stylesheet syntax with `tinycss2` | PASS |
| Headless Chromium desktop static design preview (1400px) | Rendered |
| Headless Chromium mobile dark Skills static design preview (390px) | Rendered; no horizontal document overflow |
| Production Vite build | **NOT RUN** — dependencies unavailable in this container |
| Full authenticated app navigation and OAuth on live Worker | **NOT VERIFIED** — requires deployment |

The rendered screenshots used representative sample content and are only layout checks, not evidence of live data or end-to-end React behavior. The skipped core test needs live upstream GitHub access.

## Deploy

Replace the working source with the ZIP contents, run tests locally if desired, and push to the configured Cloudflare deployment branch. The Worker build will use the existing CI pipeline. No migration is required.

## Known limitations

- Vite bundle and full interactive UI were not tested in this environment because npm dependencies were not available.
- Authenticated end-to-end behavior, real mobile devices, screen reader and live OAuth callbacks remain unverified.
- This release intentionally does not change backend feature behavior or add new features.
