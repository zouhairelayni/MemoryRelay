import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
test('Home keeps the error summary card but not inline errors or subagent task lists', async () => {
  const home = await read('../src/modules/home/MonitorPanel.jsx');
  assert.match(home, /onClick=\{\(\)=>go\('errors'\)\}/);
  assert.doesNotMatch(home, /monitor-agent-jobs|monitor-recent|Subagent tasks/);
  assert.match(home, /humanizeFunction/);
  assert.match(home, /displayLabel/);
});
test('Subagent tasks live on Agents and diagnostics have a dedicated route plus Settings entry', async () => {
  const agents = await read('../src/modules/agents/AgentsScreen.jsx');
  const appShell = await read('../src/shell/AppShell.jsx');
  const modules = await read('../src/modules/index.js');
  const settings = await read('../src/settings/SettingsSheet.jsx');
  const errors = await read('../src/modules/home/ErrorsScreen.jsx');
  assert.match(agents, /Subagent tasks/);
  assert.match(appShell, /errorsOpen && ErrorsScreen/);
  assert.match(modules, /id: "errors"/);
  assert.match(settings, /go\("errors"\)/);
  assert.match(errors, /exportJson/);
  assert.match(errors, /diagnostics\.list/);
});
