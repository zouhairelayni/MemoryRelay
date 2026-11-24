import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const get = file => readFileSync(new URL('../'+file,import.meta.url));
const source = file => get(file).toString('utf8');

test('PWA icons are opaque PNG assets at the declared resolutions',()=>{
  for(const [name,size] of [['icon-192.png',192],['icon-512.png',512],['maskable-192.png',192],['maskable-512.png',512],['apple-touch-icon.png',180],['favicon-32.png',32]]){
    const buf=get('public/icons/'+name);
    assert.equal(buf.subarray(1,4).toString(),'PNG',name);
    assert.equal(buf.readUInt32BE(16),size,name);
    assert.equal(buf.readUInt32BE(20),size,name);
    assert.ok([2,6].includes(buf[25]),'valid RGB/RGBA color type for '+name);
  }
});
test('Approved PNG supports a folding ribbon on Home and welcome',()=>{
  const logo=source('src/components/Logo.jsx');
  assert.match(logo,/useAccent, iconFor/);
  assert.match(logo,/const image = iconFor\(accent, 192\)/);
  assert.match(logo,/ribbon-fold-left/);
  assert.match(logo,/ribbon-fold-middle/);
  assert.match(logo,/ribbon-fold-right/);
  assert.match(logo,/draggable="false"/);
  assert.match(source('src/shell/TopBar.jsx'),/import Logo/);
  assert.match(source('src/shell/AuthGate.jsx'),/import Logo/);
  assert.match(source('src/components/WelcomeSplash.jsx'),/Logo size=\{128\} animated/);
  const svg=source('public/icons/icon.svg');
  assert.doesNotMatch(svg,/<circle\b/);
  assert.match(svg,/<path/);
});
test('Welcome runs once on startup and respects reduced motion',()=>{
  const app=source('src/App.jsx');
  const splash=source('src/components/WelcomeSplash.jsx');
  const motion=source('src/styles/motion.css');
  assert.match(app,/useEffect\(/);
  assert.match(app,/prefers-reduced-motion: reduce/);
  assert.match(app,/1250/);
  assert.match(app,/auth\.phase === "loading" \|\| !welcomeComplete/);
  assert.match(splash,/welcome-emblem/);
  assert.match(splash,/welcome-wordmark/);
  assert.doesNotMatch(splash,/<span className="pulse"|loading-dot|spinner/);
  assert.match(motion,/@keyframes ribbon-fold-left/);
  assert.match(motion,/@keyframes ribbon-cycle-mark/);
  assert.match(motion,/@media\(prefers-reduced-motion:reduce\)/);
  assert.doesNotMatch(motion,/\.enter>\*\s*\{/);
});
test('CSS changes are source-scoped and cache is bumped',()=>{
  assert.match(source('src/styles/redesign.css'),/\.welcome-screen/);
  assert.match(source('public/sw.js'),/memory-relay-v3\.5\.1/);
  assert.match(source('package.json'),/"version": "3\.5\.1"/);
});
