// End to end: a complex skill repository -> GitHub sync -> MCP tools an agent calls -> files rebuilt on disk -> delivered tests really run.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createD1 } from "./helpers/d1.js";
import worker from "../worker/index.js";
import { resetSchemaCache } from "../worker/db.js";
import { addSkillRepo, syncSkillRepo } from "../worker/githubSkills.js";

const JSONH = { "content-type": "application/json" };
const sha = "a".repeat(40), treeSha = "c".repeat(40);

// ---- the complex skill: nested folders, unicode, backticks, CRLF, a big file, a binary font, ignored junk ----
const font = Uint8Array.from({ length: 20000 }, (_, i) => (i * 131 + (i >> 3)) % 256); // every byte value, including 0 and 255
const mathLib = `// Weird on purpose: unicode ✓ é 日本語, backticks, regex, template literals, nested braces.
export const greet = (name) => \`Hello, \${name}! \\\`quoted\\\` ✓\`;
export const slug = (s) => s.normalize("NFKD").replace(/[^\\w\\s-]/g, "").trim().replace(/[\\s_-]+/g, "-").toLowerCase();
export function clamp(n, lo, hi) { return n < lo ? lo : n > hi ? hi : n; }
export class Stack { #a = []; push(x) { this.#a.push(x); return this; } pop() { return this.#a.pop(); } get size() { return this.#a.length; } }
`;
const mathTest = `import test from "node:test";
import assert from "node:assert/strict";
import { greet, slug, clamp, Stack } from "../scripts/lib/math.mjs";
test("greet keeps unicode and backticks", () => assert.equal(greet("Zoë"), "Hello, Zoë! \`quoted\` ✓"));
test("slug", () => assert.equal(slug("  Héllo, Wörld_ 日本 "), "hello-world-"));
test("clamp", () => assert.deepEqual([clamp(-1, 0, 5), clamp(9, 0, 5), clamp(3, 0, 5)], [0, 5, 3]));
test("Stack with private field", () => assert.equal(new Stack().push(1).push(2).pop(), 2));
`;
const crlf = "line one\r\nline two\r\n\r\nlast line without newline";
const cliPy = `"""Tiny CLI. Triple quotes, unicode ✓ and braces {} must survive."""
def add(a, b):
    """Return a + b."""
    return a + b

def shout(text):
    return text.upper() + "!"
`;
const cliTest = `import os, sys, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
from cli import add, shout

class T(unittest.TestCase):
    def test_add(self):
        self.assertEqual(add(2, 3), 5)
    def test_shout(self):
        self.assertEqual(shout("héllo"), "HÉLLO!")

if __name__ == "__main__":
    unittest.main()
`;
const big = "// generated table\nexport const table = [\n" + Array.from({ length: 9000 }, (_, i) => `  { id: ${i}, label: "row ${i} ✓", tags: ["a", "b"] },`).join("\n") + "\n];\n"; // ~400 KB
assert.ok(big.length > 250000);

const FILES = {
  "scripts/lib/math.mjs": mathLib,
  "scripts/cli.py": cliPy,
  "scripts/data/big.mjs": big,
  "tests/math.test.mjs": mathTest,
  "tests/test_cli.py": cliTest,
  "fonts/Inter.woff2": font,
  "notes/crlf.txt": crlf,
};
const IGNORED = { "node_modules/left-pad/index.js": "module.exports = 1;", "package-lock.json": "{}", "assets/logo.png": "png" };

const SKILL_MD = `---\nname: complex-kit\ndescription: Use when you need the complex-kit helpers, their tests and the Inter font.\n---\n# complex-kit\n\n${"Run tests/ with node --test. ".repeat(60)}\n`;

function mockGithub() {
  const tree = [{ type: "blob", path: "skills/complex-kit/SKILL.md", size: SKILL_MD.length }];
  for (const [p, c] of [...Object.entries(FILES), ...Object.entries(IGNORED)]) tree.push({ type: "blob", path: "skills/complex-kit/" + p, size: typeof c === "string" ? Buffer.byteLength(c) : c.length });
  const files = { "skills/complex-kit/SKILL.md": SKILL_MD };
  for (const [p, c] of Object.entries({ ...FILES, ...IGNORED })) files["skills/complex-kit/" + p] = c;
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    const h = new Headers();
    const ok = (body) => ({ ok: true, status: 200, headers: h, json: async () => body, text: async () => String(body), arrayBuffer: async () => body instanceof Uint8Array ? body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) : new TextEncoder().encode(String(body)).buffer });
    if (u.includes("/commits/")) return ok({ sha, commit: { tree: { sha: treeSha } } });
    if (u.includes("/git/trees/")) return ok({ truncated: false, tree });
    const path = decodeURIComponent(new URL(u).pathname.split("/").slice(4).join("/"));
    return path in files ? ok(files[path]) : { ok: false, status: 404, headers: h, text: async () => "nf" };
  };
  return () => { globalThis.fetch = real; };
}

async function setup() {
  resetSchemaCache();
  const { DB } = createD1();
  const env = { DB, ASSETS: { fetch: async () => new Response("app") } };
  const ctx = { waitUntil: (p) => p };
  const call = (path, init) => worker.fetch(new Request("http://localhost" + path, init), env, ctx);
  const r = await call("/auth/setup", { method: "POST", headers: JSONH, body: JSON.stringify({ email: "o@x.io", password: "longenough12" }) });
  const cookie = (r.headers.get("set-cookie") || "").split(";")[0];
  const svc = (await (await call("/api/services", { headers: { cookie } })).json()).services[0];
  // The agent's view: real JSON-RPC over HTTP, exactly what an MCP client sends.
  const tool = async (name, args) => {
    const res = await (await call(svc.url, { method: "POST", headers: JSONH, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) })).json();
    return res.result;
  };
  return { env, tool };
}

test("complex skill: synced, delivered through MCP, rebuilt byte for byte, and its delivered tests pass", async () => {
  const { env, tool } = await setup();
  const restore = mockGithub();
  let repo;
  try {
    repo = (await addSkillRepo(env, { repo: "demo/complex-kit", file_types: ["script", "test", "font", "reference"] })).id;
    const out = await syncSkillRepo(env, repo, { importMissing: true });
    assert.equal(out.complete, true);
    assert.deepEqual(out.summary.added, ["complex-kit"]);
    // 7 wanted files; node_modules, the lock file and the png never come along
    assert.deepEqual(out.summary.files, { font: 1, reference: 1, script: 3, test: 2 });
  } finally { restore(); }

  // 1. what the agent is told when it asks for the skill by name
  const got = await tool("get_skill", { name: "complex-kit" });
  assert.notEqual(got.isError, true);
  const text = got.content[0].text;
  assert.match(text, /ORIGINAL UPSTREAM RESOURCES FOR complex-kit \(7 files/);
  for (const p of Object.keys(FILES)) assert.ok(text.includes("- " + p + " ("), "listed: " + p);
  assert.doesNotMatch(text, /node_modules|package-lock|logo\.png/);

  // 2. the agent lists the files, then fetches every one (parts until done) and writes it to disk
  const list = await tool("get_skill_resource", { skill: "complex-kit" });
  const listed = JSON.parse(list.content[0].text).files;
  assert.deepEqual(listed.map((f) => f.path).sort(), Object.keys(FILES).sort());
  const dir = mkdtempSync(join(tmpdir(), "complex-kit-"));
  let partsForBig = 0;
  for (const f of listed) {
    let offset = 0, content = "";
    for (let i = 0; i < 40; i++) {
      const part = JSON.parse((await tool("get_skill_resource", { skill: "complex-kit", path: f.path, offset })).content[0].text);
      if (f.path === "scripts/data/big.mjs") partsForBig++;
      content += part.content;
      if (part.done) break;
      offset = part.next_offset;
    }
    const file = join(dir, f.path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, f.kind === "font" ? Buffer.from(content, "base64") : content, f.kind === "font" ? undefined : "utf8");
  }
  assert.ok(partsForBig >= 3, "the 400 KB file arrived in several parts: " + partsForBig);

  // 3. byte for byte identical to the repository
  for (const [p, c] of Object.entries(FILES)) {
    const got = readFileSync(join(dir, p));
    const want = typeof c === "string" ? Buffer.from(c, "utf8") : Buffer.from(c);
    assert.ok(got.equals(want), "identical: " + p);
  }
  assert.ok(readFileSync(join(dir, "notes/crlf.txt")).includes("\r\n"), "CRLF line endings kept");

  // 4. the delivered tests really run (Node tests always; Python tests when python3 exists)
  const cleanEnv = { ...process.env }; delete cleanEnv.NODE_TEST_CONTEXT; // otherwise the child runner talks to the outer one instead of printing
  const node = spawnSync(process.execPath, ["--test", "--test-reporter=tap", "tests/math.test.mjs"], { cwd: dir, encoding: "utf8", env: cleanEnv });
  assert.equal(node.status, 0, "node tests failed:\n" + node.stdout + node.stderr);
  assert.match(node.stdout, /# pass 4/);
  const py = spawnSync("python3", ["-m", "unittest", "discover", "-s", "tests", "-p", "test_*.py", "-v"], { cwd: dir, encoding: "utf8" });
  if (!py.error) { assert.equal(py.status, 0, "python tests failed:\n" + py.stderr); assert.match(py.stderr, /Ran 2 tests/); }
});

test("complex skill: a later change upstream reaches the agent, and a removed test file stays removed", async () => {
  const { env, tool } = await setup();
  let restore = mockGithub();
  try {
    const repo = (await addSkillRepo(env, { repo: "demo/complex-kit", file_types: ["script", "test"] })).id;
    await syncSkillRepo(env, repo, { importMissing: true });
    const { removeRepoFile } = await import("../worker/githubSkills.js");
    assert.equal((await removeRepoFile(env, repo, { skill: "complex-kit", path: "tests/test_cli.py" })).ok, true);
    await syncSkillRepo(env, repo, { importMissing: true, force: true });
  } finally { restore(); }
  const list = JSON.parse((await tool("get_skill_resource", { skill: "complex-kit" })).content[0].text).files.map((f) => f.path);
  assert.ok(!list.includes("tests/test_cli.py"));
  assert.ok(list.includes("tests/math.test.mjs") && list.includes("scripts/lib/math.mjs"));
  assert.ok(!list.includes("fonts/Inter.woff2"), "fonts were not selected for this repo");
  const missing = await tool("get_skill_resource", { skill: "complex-kit", path: "tests/test_cli.py" });
  assert.equal(missing.isError, true);
});
