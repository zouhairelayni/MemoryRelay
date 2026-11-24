# MemoryRelay — Chart.js Activity Dashboard

**Date:** 2026-11-02
**Scope:** Activity charts only. No Cloudflare Worker or database changes.

## Changes
- Removed all eight cramped SVG sparklines from Activity metric cards; cards display clear numeric totals only.
- Added Chart.js 4.6.1 (MIT license) as a standard React/Vite dependency, using direct canvas integration rather than an extra React wrapper dependency.
- Added one full-width Chart.js line chart with labeled time axis, zero-based numeric Y-axis, hover tooltips, and a metric/function selector. Existing 1h, 1d, 7d, 30d and 90d windows remain.
- Added a horizontal Chart.js bar chart for the eight most-used recorded functions, with an expandable complete function list.
- Kept the existing hourly heatmap (Chart.js does not ship a heatmap chart type).
- Improved card density and chart containers for narrow/mobile screens. No decorative accent stripes were added.
- Updated the UI regression test to assert Chart.js integration and removal of SVG sparklines.

## Tests observed
- Core Node tests: 86 passed, 0 failed, 1 skipped (live upstream fetch).
- Focused monitoring and workspace tests: 9 passed, 0 failed.
- JSX syntax checked using TypeScript's parser for both changed components.
- Screens and workspace CSS parsed without syntax errors.
- **Not verified:** Vite production build or rendered Chart.js behavior in a browser; the package `chart.js` was unavailable locally because npm registry access was unavailable in the build environment. Must run `npm install --ignore-scripts` before local Vite build.

## Termux
```bash
cd ~/MemoryRelay
unzip -o ~/storage/downloads/MemoryRelay-ChartJS-Hotfix.zip
npm install --ignore-scripts
npm run dev:live
```
Then visit `http://127.0.0.1:5173` and inspect the Activity section.

## Commit
```bash
cd ~/MemoryRelay
git add -A
git commit -m "feat: replace activity sparklines with Chart.js analytics"
git push origin main
```

## Notes
No charts were faked or assigned sample data. Chart.js uses the existing authenticated monitoring API. Totals and timestamps are derived from the same backend records as before. Backend activity and database schema unchanged.
