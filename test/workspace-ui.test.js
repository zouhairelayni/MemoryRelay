import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('all five navigation screens use the redesigned layout', () => {
  const files = {
    'src/modules/home/HomeScreen.jsx': 'home-screen',
    'src/modules/memory/MemoryScreen.jsx': 'memory-screen',
    'src/modules/skills/SkillsScreen.jsx': 'skills-screen',
    'src/modules/agents/AgentsScreen.jsx': 'agents-screen',
    'src/modules/keys/KeysScreen.jsx': 'models-screen',
  };
  for (const [file, name] of Object.entries(files)) assert.match(read(file), new RegExp(name), file);
});

test('shared styles are loaded after legacy styles', () => {
  const main = read('src/main.jsx');
  assert.ok(main.indexOf('styles/workspace.css') > main.indexOf('styles/screens.css'));
  const style = read('src/styles/workspace.css');
  assert.match(style, /@media \(min-width:800px\)/);
  assert.match(style, /@media \(max-width:799px\)/);
  assert.match(style, /prefers-reduced-motion/);
  assert.match(style, /\.sheet\s*\{/);
  assert.match(style, /\.gate-card\s*\{/);
});

test('authentication and navigation retain their action selectors', () => {
  assert.match(read('src/shell/AuthGate.jsx'), /id="gate-btn"/);
  assert.match(read('src/shell/TopBar.jsx'), /id="open-settings"/);
  assert.match(read('src/shell/TabBar.jsx'), /onClick=\{\(\) => onSelect\(t\.id\)\}/);
  assert.match(read('src/modules/skills/SkillSelector.jsx'), /id="sk-list"/);
});

test('skills selection uses stable selectable values; monitoring offers hour and day plus per-function charts', () => {
  const selector=read('src/modules/skills/SkillSelector.jsx');
  assert.match(selector, /id="sk-max"[^>]*aria-label="Maximum skills per request"/);
  assert.match(selector, /Array.from\(\{length:8\}/);
  assert.doesNotMatch(selector, /id="sk-max"[^>]*type="number"/);
  const panel=read('src/modules/home/MonitorPanel.jsx');
  for(const period of ['1h','1d','7','30','90']) assert.ok(panel.includes(`value="${period}"`));
  assert.match(panel,/Recorded functions/);
  assert.match(panel,/monitor-function-list/);
  assert.match(panel,/monitor-metric/);
});


test('selected connections and navigation use neutral surfaces instead of accent stripes', () => {
  const workspace = read('src/styles/workspace.css');
  const screens = read('src/styles/screens.css');
  const card = read('src/modules/agents/AgentCard.jsx');
  assert.match(workspace, /\.agents-screen \.cable-chip\.on \{[^}]*box-shadow:none;/);
  assert.match(workspace, /\.agents-screen \.conn \{[^}]*border:1px solid var\(--line\);\}/);
  assert.match(workspace, /\.tab\.on \{[^}]*box-shadow:none;/);
  assert.doesNotMatch(workspace, /border-top:3px|inset 0 -3px 0|inset 3px 0 0/);
  assert.doesNotMatch(screens, /\.split\s*\{|inset 0 0 0 1\.5px var\(--cable\)/);
  assert.doesNotMatch(card, /className="split"|\bpct\(/);
  assert.match(read('package.json'), /https:\/\/memoryrelay\.zouhairelayni\.workers\.dev/);
});
