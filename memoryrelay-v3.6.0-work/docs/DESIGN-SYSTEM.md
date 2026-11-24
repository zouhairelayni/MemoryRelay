# MemoryRelay / Aurora workspace visual system

## Intent

Premium, restrained and mobile-first. Inspired by the *interaction principles* established in RIVNA (compact, useful metrics and discoverable navigation), Milvayo (calm, readable surfaces), and Cographide (clear hierarchy and visual exploration). No brand assets or proprietary designs copied.

## Visual decisions

- **Primary hierarchy:** Live = operational dashboard. The user first sees measured MCP calls, estimated AI tokens, skill selections and errors, then the activity chart. The second row of metrics and connected resources follow.
- **Color:** Midnight/graphite background, distinct elevated ink surfaces, restrained lavender/violet structural accent, mint for healthy, warm rose for errors. Surface tone, not thick glow or colored terminal borders, creates depth.
- **Typography:** Native/system font families, 11–12 px labels and 25–34 px numeric metrics, clear action labels and high contrast. Monospaced type is reserved for commands and code blocks.
- **Repos:** Readable repository names, owner/subpath, actionable sync badges. A 3½-row inner scroller, not an infinitely tall stack. Advanced file settings stay available behind a disclosure.
- **Memories:** Heading/list/paragraph hierarchy. Markdown is stored as text; code is displayed as copyable inline commands or scrollable fenced blocks; neither is executable.
- **Navigation:** Bottom app navigation on mobile, desktop rail preserved from existing app. PWA refresh sits beside Settings, not over graphs.

## Keyboard and interaction

- Metric dropdown is an application-owned listbox. Arrow keys, Home/End and Escape supported; click outside closes it. Options are selectable without an OS fullscreen picker.
- PWA refresh appears only in installed/standalone display mode, per supported browser APIs.
- Reduced-motion setting disables unnecessary decorative animation.
- No misleading zero-to-trend chart for missing data; monitoring uses the existing Cloudflare measured API.

## Test evidence and limitations

The `docs/visual/preview.html` fixture renders these production styles with **explicit sample data** in headless Chromium. PNG captures are labeled to avoid confusion with live telemetry. Browser preview confirms layout at 390px/430px and no global sideways scrolling; it is not a signed Android build or a live authenticated Worker smoke test.

After installation on your Debian device, run `npm ci`, `npm test`, `npm run build`, `npm run dev:live`, and inspect genuine logged-in screen captures at mobile and tablet widths before production deployment. Deployment/push remains user-controlled.
