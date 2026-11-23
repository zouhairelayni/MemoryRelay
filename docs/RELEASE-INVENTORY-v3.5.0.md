# MemoryRelay v3.5.0 — Consolidated full-source inventory

This is a **cumulative source distribution**, not a delta patch. The app version remains **3.5.0**.

## Already included from v3.3.8

- Premium dashboard foundation, Markdown memory viewer/editor and copyable command blocks.
- Configurable memory context limit, MCP limit handling, chart selection and installed-PWA refresh control.
- Prior UI/security regression tests and documents.

## Already included from v3.4.0–v3.4.7

- Rethought Overview cards, app-owned drop-downs instead of native browser selectors.
- Dedicated repository Overview / Files / Settings screens, condensed repo listings.
- Per-metric chart colors, gradient fills, refined mobile layouts.
- Approved MemoryRelay logo; PWA/web launcher and maskable icons; animated welcome with reduced-motion handling.
- Matching release notes and branding/motion, screenshot, QA and design documentation.

## Included from v3.5.0

- Paginated full-library memory index across up to 5,000 stored records.
- MCP selective full-text fetch by ID, searchable short descriptions, structured metadata separate from context tags.
- Editable app, platform, feature, build/release version, programming languages, and stack; colored chips.
- MCP schemas and descriptions advertising Markdown, snippets, and metadata features.
- Backward-compatible legacy-memory migration; housekeeping release identity protection.
- Full regression suite and index-specific integration tests.

## Packaging and safety

- No intermediate v3.4.7 install needed when upgrading from clean v3.3.8 (also supports v3.3.0 and v3.4.7).
- Application code includes no production credentials or `.git` folder.
- Installer verifies every shipped file using SHA-256 before copying.
- Local `graphify-out/` data is left untouched.
- Tests and Vite build are required before the installer commits and pushes.
- Browser/Cloudflare production build is **not** claimed verified by an offline test suite.
