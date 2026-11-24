# Anthropic skill source provenance

The official Anthropic skills, when synchronized, are imported verbatim from
https://github.com/anthropics/skills at the pinned commit recorded in
`ANTHROPIC-UPSTREAM-MANIFEST.json`. Their own LICENSE.txt files are retained as
resources; no rights in Anthropic trademarks are granted or implied.

Run `npm run sync:anthropic` to update the generated module. `npm run build`
also synchronizes automatically, and fails if the upstream fetch fails instead
of deploying unverified partial imports. Large binary resources such as fonts
are represented by immutable upstream URLs, not modified or embedded.

The earlier compact adaptations were NOT faithful Anthropic skill imports.
They are automatically replaced on deployment for unmodified built-ins; owner
modified skills are never overwritten. Existing legacy script bank entries are
kept for compatibility but are not injected into official-source skills.
