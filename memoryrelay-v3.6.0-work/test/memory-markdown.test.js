import test from 'node:test';
import assert from 'node:assert/strict';
import { inlineTokens, parseMemoryMarkdown, memoryTitle } from '../src/lib/memoryMarkdown.js';
import { formatAgentMemory, AGENT_MEMORY_GUIDANCE } from '../worker/memoryFormat.js';
import { readFileSync } from 'node:fs';

test('fenced commands stay exact and cannot become live HTML', () => {
  const markdown = '**Deployment**\n- *Step:* Copy exactly\n```bash\nprintf "<script>alert(1)</script>"\n```';
  const blocks = parseMemoryMarkdown(markdown);
  assert.equal(blocks[0].type, 'paragraph');
  assert.equal(blocks[1].type, 'list');
  assert.equal(blocks[2].type, 'code');
  assert.equal(blocks[2].language, 'bash');
  assert.equal(blocks[2].value, 'printf "<script>alert(1)</script>"');
  const jsx = readFileSync(new URL('../src/modules/memory/MemoryMarkdown.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(jsx, /dangerouslySetInnerHTML|innerHTML\s*=/);
  assert.match(jsx, /copyText\(value\)/);
  assert.match(jsx, /className="memory-inline-copy"/);
});

test('supports bold, italic, inline code, lists, headings and quotations', () => {
  assert.deepEqual(inlineTokens('**Ready** *Agent* `codex`').map(x => x.type), ['strong','text','em','text','code']);
  assert.equal(parseMemoryMarkdown('# Title\n- *A:* a\n- *B:* b\n1. First\n2. Second\n> quoted').length, 4);
  assert.equal(memoryTitle('**Security findings**\n- *Fix:* safe'), 'Security findings');
});

test('MCP normalizes legacy plain text without losing commands or already formatted memories', () => {
  const raw = 'Enable strict mode\n```bash\necho hello\n```';
  const normalized = formatAgentMemory(raw);
  assert.match(normalized, /^\*\*Enable strict mode\*\*\n- \*Detail:\*/);
  assert.ok(normalized.endsWith(raw));
  const structured = '**Security review**\n- *Decision:* Reject risky changes';
  assert.equal(formatAgentMemory(structured), structured);
  assert.match(AGENT_MEMORY_GUIDANCE, /bold.*title/);
});
