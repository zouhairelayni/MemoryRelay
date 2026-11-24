# MemoryRelay release history

## 3.5.0 — Full-library memory discovery and metadata (2026-11-23)
Paged MCP `list_memories`, `search`, and `get_memory` enable agents to discover and selectively retrieve the entire memory library. Added descriptions and colored typed metadata (app, platform, feature, version, languages, stack) independent of context tags, with owner UI editing, legacy-safe D1 migration, import/export preservation, and expanded MCP tool descriptions for Markdown and copyable code. Release-aware housekeeping protections, full pagination, and regression tests included. See [`docs/releases/3.5.0.md`](docs/releases/3.5.0.md) and [`docs/QA-2026-11-23-3.5.0.md`](docs/QA-2026-11-23-3.5.0.md).

## 3.3.8 — Copyable inline Markdown commands (2026-11-23)
Backtick-wrapped command snippets are individually copyable; fenced command blocks remain copyable and non-executable. See [`docs/releases/3.3.8.md`](docs/releases/3.3.8.md).

## 3.3.7 — Dashboard visual QA (2026-11-23)
Four primary metrics precede the activity chart, compact overview, supporting counters follow. Documented headless Chromium CSS preview results. See [`docs/releases/3.3.7.md`](docs/releases/3.3.7.md).

## 3.3.6 — MCP memory description and format (2026-11-23)
Owner-configured token limits are returned by `tools/list`, `initialize` and `get_memory_settings`; agents receive Markdown format instructions. Plain-text agent inputs are normalized without deleting content. See [`docs/releases/3.3.6.md`](docs/releases/3.3.6.md).

## 3.3.5 — Installed-PWA refresh (2026-11-23)
PWA refresh control moved beside Settings in the app header. See [`docs/releases/3.3.5.md`](docs/releases/3.3.5.md).

## 3.3.4 — Markdown memories (2026-11-23)
Safe Markdown memory reader, structured editor and copyable command blocks. See [`docs/releases/3.3.4.md`](docs/releases/3.3.4.md).

## 3.3.3 — GitHub repository UI (2026-11-23)
Readable compact repository cards in a 3.5-row scroll viewport. See [`docs/releases/3.3.3.md`](docs/releases/3.3.3.md).

## 3.3.2 — In-app chart menu (2026-11-23)
No OS-native metric popup, with accessible listbox behavior and time range segmented control. See [`docs/releases/3.3.2.md`](docs/releases/3.3.2.md).

## 3.3.1 — Dashboard-first Home (2026-11-23)
Restructured Live to prioritize measured usage and trends. See [`docs/releases/3.3.1.md`](docs/releases/3.3.1.md).

## 3.3.0 — Security and configurable memory context (2026-11-23)
See [`AUDIT-2026-11-23-V3.3.0.md`](AUDIT-2026-11-23-V3.3.0.md).

## v3.4.0–v3.4.7 (2026-11-23)

- **3.4.0:** Compact library metrics — Overview now places Memories, Rules, Skills and AI keys in four compact linked cards. Usage data remains sourced from monitored activity; library counts are not invented.
- **3.4.1:** In-app selection menus — Replaced remaining native HTML selects in the Skills and repository resource flows with AppSelect: keyboard navigation, touch targets, outside-pointer close, bounded viewport placement and portal anchoring.
- **3.4.2:** Repository workspace — Selecting a tracked GitHub repository opens a dedicated Overview / Files / Settings workspace rather than an expandable list row. Sync, file inspection, exclusions and destructive disconnect confirmation remain accessible.
- **3.4.3:** Per-metric chart identity — Line charts use a transparent vertical area gradient beneath the stroke. Metrics get stable distinct accent colors, including deterministic per-function colors. Graphs represent recorded data only.
- **3.4.4:** Startup cleanup — Removed the gray loading-dot experience from the app startup. App startup handling uses a branded display.
- **3.4.5:** Mobile UI audit — Consolidated compact cards, responsive repository screens, 3.5-card list view, typography and dropdown styles. Added UI/source regression coverage; no remaining native <select>, alert, prompt or confirm calls in src.
- **3.4.6:** Logo and PWA icons — Replaced the legacy dotted M with a premium ribbon monogram. Generated opaque PWA icons at 192/512, padded maskable variants at 192/512, Apple touch icon and PNG favicons. Shared Logo component uses the same mark for toolbar and auth.
- **3.4.7:** React welcome animation and motion quality — Added one-time WelcomeSplash using composite-only opacity/transform. Startup display minimum 850 ms, bypassed for reduced motion; authorization loading still respected. Removed excessive per-row stagger, introduced minimal dropdown/repository transition and bumped the service worker cache.

## v3.4.0–v3.4.7 (2026-11-23)

- **3.4.0:** Compact library metrics — Overview now places Memories, Rules, Skills and AI keys in four compact linked cards. Usage data remains sourced from monitored activity; library counts are not invented.
- **3.4.1:** In-app selection menus — Replaced remaining native HTML selects in the Skills and repository resource flows with AppSelect: keyboard navigation, touch targets, outside-pointer close, bounded viewport placement and portal anchoring.
- **3.4.2:** Repository workspace — Selecting a tracked GitHub repository opens a dedicated Overview / Files / Settings workspace rather than an expandable list row. Sync, file inspection, exclusions and destructive disconnect confirmation remain accessible.
- **3.4.3:** Per-metric chart identity — Line charts use a transparent vertical area gradient beneath the stroke. Metrics get stable distinct accent colors, including deterministic per-function colors. Graphs represent recorded data only.
- **3.4.4:** Startup cleanup — Removed the gray loading-dot experience from the app startup. App startup handling uses a branded display.
- **3.4.5:** Mobile UI audit — Consolidated compact cards, responsive repository screens, 3.5-card list view, typography and dropdown styles. Added UI/source regression coverage; no remaining native <select>, alert, prompt or confirm calls in src.
- **3.4.6:** Logo and PWA icons — Replaced the legacy dotted M with a premium ribbon monogram. Generated opaque PWA icons at 192/512, padded maskable variants at 192/512, Apple touch icon and PNG favicons. Shared Logo component uses the same mark for toolbar and auth.
- **3.4.7:** React welcome animation and motion quality — Added one-time WelcomeSplash using composite-only opacity/transform. Startup display minimum 850 ms, bypassed for reduced motion; authorization loading still respected. Removed excessive per-row stagger, introduced minimal dropdown/repository transition and bumped the service worker cache.


### v3.5.0 full-source consolidation (installer correction; no version increment)

- Repackaged the complete v3.5.0 source with all prior v3.4.7 premium UI/logo/PWA work and release documents.
- Direct upgrade installer now accepts clean v3.3.0, v3.3.8, and v3.4.7 repositories without requiring intermediate installation.
- Added SHA-256 manifest and guarded application; tests and build remain mandatory before automatic commit/push.
