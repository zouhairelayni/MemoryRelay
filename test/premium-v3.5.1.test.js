import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createD1} from './helpers/d1.js';
import {resetSchemaCache} from '../worker/db.js';
import worker from '../worker/index.js';
const source = (f) => readFileSync(new URL('../'+f,import.meta.url),'utf8');

test('v3.5.1 preserves exact approved PNG with visible three-part ribbon choreography and reduced-motion fallback',()=>{
 const logo=source('src/components/Logo.jsx'),motion=source('src/styles/motion.css');
 assert.match(logo,/useAccent, iconFor/);
 assert.match(logo,/const image = iconFor\(accent, 192\)/);
 for(const side of ['left','middle','right']){
  assert.match(logo,new RegExp(`ribbon-fold-${side}`));
  assert.match(motion,new RegExp(`@keyframes ribbon-fold-${side}`));
 }
 assert.match(motion,/\.topbar \.logo-ribbon-animated/);
 assert.match(motion,/@keyframes ribbon-cycle-mark/);
 assert.match(motion,/\.logo-ribbon-animated \.ribbon-folds\{display:none\}/);
 assert.match(motion,/prefers-reduced-motion:reduce/);
 assert.match(source('src/components/WelcomeSplash.jsx'),/Logo size=\{128\} animated/);
});

test('non-home headers are compact, branded home only, no agent directory on Overview',()=>{
 const bar=source('src/shell/TopBar.jsx'),home=source('src/modules/home/HomeScreen.jsx');
 assert.match(bar,/HEADERS =/);
 for(const label of ['Memories','Skills','Connections','Models'])assert.ok(bar.includes(label));
 assert.match(bar,/<h1>\{heading\[0\]\}<\/h1>/);
 assert.match(bar,/<Logo size=\{36\} animated/);
 assert.doesNotMatch(home,/Connected agents|home-agents|<Brand/);
 assert.match(home,/overview-library-grid/);
 assert.match(source('src/modules/agents/AgentsScreen.jsx'),/connection-health/);
});

test('initial and async loading use skeletons, not a naked blank page',()=>{
 for(const file of ['src/components/WelcomeSplash.jsx','src/modules/home/MonitorPanel.jsx','src/modules/memory/MemoryScreen.jsx','src/modules/agents/AgentsScreen.jsx','src/modules/skills/SkillSelector.jsx','src/modules/skills/GithubSources.jsx']){
  assert.match(source(file),/skel|skeleton|shimmer/i,file);
 }
 assert.match(source('src/styles/motion.css'),/@keyframes shimmer/);
});

test('colored metric charts have a visible same-color gradient and a fill plugin',()=>{
 const chart=source('src/modules/home/ActivityChart.jsx');
 assert.match(chart,/const accent=color\|\|/);
 assert.match(chart,/const channels=rgb\?/);
 assert.match(chart,/gradient\.addColorStop\(0,rgba\(\.49\)\)/);
 assert.match(chart,/gradient\.addColorStop\(\.55,rgba\(\.25\)\)/);
 assert.match(chart,/fill:isBar\?false:"origin"/);
 const colors=source('src/modules/home/metricColors.js');
 const values=[...colors.matchAll(/\w+:"(#[0-9a-f]{6})"/gi)].map(m=>m[1]);
 assert.ok(values.length>=8 && new Set(values).size===values.length);
});

test('Skills layout shows 1–10 and sync buttons with live D1-backed progress',()=>{
 const ui=source('src/modules/skills/SkillSelector.jsx');
 assert.match(ui,/Array\.from\(\{length:10\}/);
 assert.match(ui,/skills-toolbar-card/);
 assert.match(ui,/expand-glyph/);
 const repo=source('src/modules/skills/GithubSources.jsx');
 assert.match(repo,/repo-quick-sync/);
 assert.match(repo,/repo-global-sync/);
 assert.match(repo,/sync_done/);
 assert.match(repo,/sync_total/);
 assert.match(repo,/aria-label=\{`Sync \$\{r\.repo\} now`\}/);
 const mcp=source('worker/mcp.js');
 assert.match(mcp,/up to 10 skills per request/);
});

test('settings, repository workspaces and modal focus handling use accessible components',()=>{
 assert.match(source('src/settings/SettingsSheet.jsx'),/settings-group/);
 const repo=source('src/modules/skills/GithubSources.jsx');
 assert.match(repo,/repo-detail-tabs/);assert.match(repo,/repo-file-action/);
 const sheet=source('src/components/Sheet.jsx');
 assert.match(sheet,/previousFocus/);assert.match(sheet,/e\.key === "Escape"/);
 assert.match(sheet,/e\.key !== "Tab"/);
 assert.match(source('src/components/SearchBar.jsx'),/aria-label/);
 assert.match(source('src/components/Switch.jsx'),/aria-label/);
});

async function ownerFixture(){
 resetSchemaCache();const {db,DB}=createD1();const env={DB,ASSETS:{fetch:async()=>new Response('app')}};
 const call=(path,init)=>worker.fetch(new Request('http://localhost'+path,init),env,{waitUntil:()=>{}});
 const init=await call('/auth/setup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'owner@test.example',password:'a-long-secret-password'})});
 assert.equal(init.status,200);
 const cookie=init.headers.get('set-cookie').split(';')[0];
 const api=async(path,method='GET',obj)=>{const res=await call(path,{method,headers:{cookie,'content-type':'application/json'},body:obj===undefined?undefined:JSON.stringify(obj)});return res.json()};
 return {db,api};
}

test('housekeeping safely formats Markdown, preserves context tags and only accepts evidenced structured labels',async()=>{
 const {db,api}=await ownerFixture();
 const before=await api('/api/memories','POST',{text:'**Build 14**: React UI fix in MemoryRelay v3.5.1. TypeScript PWA.',tags:'release,ui',description:'Build 14 UI',metadata:{app:'MemoryRelay',version:'v3.5.1'}});
 const duplicate=await api('/api/memories','POST',{text:'**Build 14 details**: TypeScript React animations for PWA.',tags:'release,code',metadata:{app:'MemoryRelay',version:'v3.5.1'}});
 assert.ok(before.id&&duplicate.id,JSON.stringify({before,duplicate}));
 const groups=[{keep:before.id,drop:[duplicate.id],merged_text:'**Build 14 — v3.5.1**\n- *Verified:* React UI\n```bash\nnpm test\n```',merged_description:'Evidence-backed React UI update',merged_metadata:{app:'MemoryRelay',version:'v3.5.1',languages:['TypeScript'],platforms:['PWA'],stack:['React']}}];
 const result=await api('/api/housekeep','POST',{apply:true,groups});
 assert.equal(result.removed,1,JSON.stringify(result));
 const row=db.prepare('SELECT text,description,metadata,tags FROM memories WHERE id=?').get(before.id);
 assert.match(row.text,/```bash/);
 assert.equal(row.description,'Evidence-backed React UI update');
 assert.deepEqual(JSON.parse(row.metadata).languages,['TypeScript']);
 assert.equal(row.tags,'release,ui');
 assert.equal(db.prepare('SELECT COUNT(*) n FROM memories WHERE id=?').get(duplicate.id).n,0);
});

test('housekeeping rejects invented labels without deleting any memory',async()=>{
 const {db,api}=await ownerFixture();
 const a=await api('/api/memories','POST',{text:'First verified React panel',tags:'ui'});
 const b=await api('/api/memories','POST',{text:'Second verified React panel',tags:'ui'});
 const result=await api('/api/housekeep','POST',{apply:true,groups:[{keep:a.id,drop:[b.id],merged_text:'**React panel**',merged_metadata:{version:'v9.9.9'}}]});
 assert.match(result.error,/invalid housekeeping metadata/);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM memories').get().n,2);
});
