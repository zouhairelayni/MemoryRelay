# MemoryRelay — Anthropic upstream fidelity audit

Date: 2026-11-02
Official source: https://github.com/anthropics/skills/tree/main/skills
Previously shipped package: MemoryRelay-Anthropic-Skills-Verified-2026-11-02.zip

## Finding
All eleven deployed adaptations were rewritten to ~17–19 lines; the original Anthropic skills were not installed faithfully. The previous claims of "verified Anthropic skill imports" were incorrect. The previous two Python scripts (`webapp_smoke.py`, `canvas_poster.py`) are custom MemoryRelay templates, not original Anthropic bundled scripts.

## File-by-file comparison

| Skill | Old installed lines | Old installed bytes | Official SKILL.md lines (GitHub raw, 2026-11-02) | Original scripts/resources |
|---|---:|---:|---:|---|
| `mcp-builder` | 19 | 1279 | 223 | Original SDK guidance and `reference/` files, e.g. `reference/mcp_best_practices.md`; omitted. |
| `skill-creator` | 19 | 1123 | 406 | Original `scripts/`, `agents/`, `references/`, `eval-viewer/` helpers; omitted. |
| `doc-coauthoring` | 19 | 1087 | 330 | Original detailed three-stage document workflow; omitted. |
| `frontend-design` | 19 | 1135 | 52 | NO ORIGINAL SCRIPTS; original 9 KB `SKILL.md` + license; shortened. |
| `webapp-testing` | 18 | 1181 | 85 | Original `scripts/with_server.py` and Python examples; omitted and replaced with custom smoke script. |
| `internal-comms` | 18 | 925 | 27 | Original `examples/*.md` guidelines (3P, FAQ, newsletter, general); omitted. |
| `discernment-nudge` | 17 | 869 | 192 | Original detailed applicability, exclusions and guidance; shortened. |
| `web-artifacts-builder` | 19 | 1141 | 64 | Original `scripts/init-artifact.sh` and `scripts/bundle-artifact.sh`; omitted. |
| `theme-factory` | 18 | 966 | 49 | Original theme definitions and `theme-showcase.pdf`; omitted. |
| `canvas-design` | 17 | 985 | 106 | Original design philosophy and `canvas-fonts/` assets; omitted. Custom poster script is not upstream. |
| `brand-guidelines` | 18 | 905 | 68 | Original Anthropic-specific brand colors/typography; altered; use only for Anthropic-branded work. |

## Corrections in this patch

- Official 11 `SKILL.md` files downloaded unchanged during `npm run build` (also `npm run sync:anthropic`), pinned to a GitHub commit SHA per build.
- Original `scripts/`, `references/`, `examples/`, shell scripts and readable source files downloaded unchanged, stored in `skill_resources`, and exposed to agents through `get_skill_resource(skill,path)`.
- Resource manifest passed automatically with selected skills; shorter script files can be delivered inline without rewriting them, while larger ones are available verbatim on demand.
- Large binary files (e.g. fonts and theme showcase PDFs) remain immutable upstream GitHub URLs instead of being embedded or tampered with.
- Existing 5,000-token owner/agent upload restriction remains; official imported material is not subjected to that limit, and editing official skills permits up to 25,000 estimated tokens.
- Previously imported built-ins upgrade in place; enabled flags stay unchanged; owner-modified or third-party skills are not overwritten. Earlier versions are recorded in skill history.
- Admin Skills screen distinguishes custom MemoryRelay helper scripts from official upstream resources.
- Source provenance and the exact original file inventory are written to `ANTHROPIC-UPSTREAM-MANIFEST.json` by the sync script.

## Verification status

- 69 previous core tests passed.
- Two new tests: GitHub sync generator passed with mocked upstream responses; official lossless round-trip and resource retrieval passed with synthetic source data.
- Final offline core suite: 70 passed, 1 expected skip because actual Anthropic files could not be downloaded into this execution environment. The skipped test runs after an actual sync.
- The live upstream download, Cloudflare build, MCP tool update and real Claude/Gemini skill execution have **not** been run in this environment. A successful deployment and import need to be checked before claiming live fidelity.
- No existing Cloudflare deployment or D1 database was changed here.

## Deployment

Replace the repository root with the patched source and push to GitHub. The project `npm run build` now synchronizes the official Anthropic repository before Vite; Cloudflare's build configuration must invoke `npm run build` (the existing `npm run deploy` script does). If it invokes only Wrangler directly, the sync stage must be run before deployment.

## Important distinctions

Anthropic's frontend-design contains no Python scripts. The goal is to preserve original instructions, not invent scripts. The custom scripts are retained as legacy helpers for existing connections but are no longer presented as official Anthropic resources. Original license text is loaded as a resource when present. Trademarks remain with their holders.
