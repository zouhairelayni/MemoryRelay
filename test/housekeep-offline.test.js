import test from "node:test";
import assert from "node:assert/strict";
import { localDuplicateGroups } from "../worker/housekeep.js";

const row = (id, text, metadata = {}) => ({ id, text, metadata: JSON.stringify(metadata) });

test("offline duplicate check groups near-identical memories of the same version only", () => {
  const g = localDuplicateGroups([
    row("a", "Deploy with wrangler deploy after build", { version: "1" }),
    row("b", "deploy with wrangler deploy after build  ", { version: "1" }),
    row("c", "Deploy with wrangler deploy after build", { version: "2" }),
    row("d", "Something else entirely"),
  ]);
  assert.equal(g.length, 1);
  assert.deepEqual(g[0].drop.length, 1);
  assert.ok(!g[0].drop.includes("c") && !g[0].drop.includes("d"));
  assert.equal(g[0].merged_text, "");
});
