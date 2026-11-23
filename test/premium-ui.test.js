import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {colorForMetric,METRIC_COLORS} from '../src/modules/home/metricColors.js';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('every core metric has a distinct accessible CSS color, functions keep stable color',()=>{
  assert.equal(Object.keys(METRIC_COLORS).length,new Set(Object.values(METRIC_COLORS)).size);
  assert.equal(colorForMetric('mcp'),METRIC_COLORS.mcp);
  const first=colorForMetric('fn:mcp:remember'),second=colorForMetric('fn:mcp:search');
  assert.match(first,/^#[0-9A-F]{6}$/);
  assert.notEqual(first,second);
  assert.equal(colorForMetric('fn:mcp:remember'),first);
});
test('no mobile native selection menus remain in active React screens',()=>{
  for(const file of ['src/modules/skills/SkillSelector.jsx','src/modules/skills/GithubSources.jsx']){
    assert.doesNotMatch(read(file),/<select\b|showPicker\(|window\.confirm\(/);
    assert.match(read(file),/AppSelect/);
  }
  const picker=read('src/components/AppSelect.jsx');
  assert.match(picker,/createPortal/);assert.match(picker,/role="listbox"/);
  assert.match(picker,/event\.key === "Escape"/);assert.match(picker,/pointerdown/);
});
test('repository management uses a dedicated screen with files and settings, not nested details',()=>{
  const skills=read('src/modules/skills/SkillsScreen.jsx');
  const repos=read('src/modules/skills/GithubSources.jsx');
  assert.match(skills,/repoDetail/);assert.match(skills,/focusRepo/);
  assert.match(repos,/repo-detail-tabs/);assert.match(repos,/RepoFiles repoId=\{selected\.id\}/);
  assert.match(repos,/FileOptions showRoot value=\{draftOf\(selected\)\}/);
  assert.match(repos,/Confirm disconnect/);assert.doesNotMatch(repos,/repo-list-details/);
});
test('Overview shows library metrics as small cards before usage, charts use gradient fill',()=>{
  const home=read('src/modules/home/HomeScreen.jsx');
  assert.ok(home.indexOf('overview-library-grid')<home.indexOf('<MonitorPanel'));
  assert.match(home,/overview-library-card/);
  const chart=read('src/modules/home/ActivityChart.jsx');
  assert.match(chart,/Filler/);assert.match(chart,/createLinearGradient/);
  assert.match(chart,/fill:isBar\?false:"origin"/);
  const monitor=read('src/modules/home/MonitorPanel.jsx');
  assert.match(monitor,/colorForMetric\(metric\)/);
  assert.match(monitor,/monitor-load-error/);
});
test('Web boot screen does not render the gray loading dot',()=>{
  const app=read('src/App.jsx');assert.doesNotMatch(app,/<span className="pulse" \/>/);
  assert.match(app,/WelcomeSplash/);
  assert.match(read("src/components/WelcomeSplash.jsx"),/Logo size=\{128\}/);
});
