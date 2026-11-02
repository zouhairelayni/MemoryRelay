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
