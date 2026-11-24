# MemoryRelay — GitHub skill file filter

- Sync only `SKILL.md` and nested `.py` scripts.
- Ignore images, Markdown references, JSON, JavaScript, and other files.
- Keep 750 KB per Python script and 1,500 script cap.
- Regression test verifies 1,801 ignored assets do not block import.
- Existing installed resources are replaced on next successful full sync, not immediately.
