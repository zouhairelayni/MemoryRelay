import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const names = ['mcp-builder','skill-creator','doc-coauthoring','frontend-design','webapp-testing','internal-comms','discernment-nudge','web-artifacts-builder','theme-factory','canvas-design','brand-guidelines'];
const sha='a'.repeat(40), treeSha='b'.repeat(40);
test('official Github importer preserves complete text, paths and pinned resource URLs',async()=>{
 const cwd=process.cwd(), tmp=await fs.mkdtemp(path.join(os.tmpdir(),'memoryrelay-sync-'));
 await fs.mkdir(path.join(tmp,'worker'));
 const originalFetch=globalThis.fetch;
 const tree=names.flatMap(name=>[{type:'blob',path:`skills/${name}/SKILL.md`,size:1500},{type:'blob',path:`skills/${name}/LICENSE.txt`,size:100}]);
 tree.push({type:'blob',path:'skills/webapp-testing/scripts/with_server.py',size:55});
 tree.push({type:'blob',path:'skills/canvas-design/canvas-fonts/font.ttf',size:120000});
 const makeResponse=(value)=>({ok:true,text:async()=>typeof value==='string'?value:JSON.stringify(value)});
 let requests=[];
 globalThis.fetch=async(url)=>{
  requests.push(String(url));
  if(String(url).endsWith('/commits/main'))return makeResponse({sha,commit:{tree:{sha:treeSha}}});
  if(String(url).includes(`/git/trees/${treeSha}`))return makeResponse({truncated:false,tree});
  if(String(url).endsWith('/SKILL.md')) {
    const name=String(url).match(/skills\/([^/]+)\/SKILL\.md$/)[1];
    return makeResponse(`---\nname: ${name}\ndescription: Use when conducting complete ${name} tasks.\n---\n# Full ${name} original\n\n${'NO TRIMMING. '.repeat(120)}\n`);
  }
  if(String(url).endsWith('/LICENSE.txt'))return makeResponse('Apache License 2.0 — text preserved.');
  if(String(url).endsWith('with_server.py'))return makeResponse('print("original helper")\n');
  throw Error('unexpected URL '+url);
 };
 try {
  process.chdir(tmp);
  await import(pathToFileURL(path.resolve(cwd,'scripts/sync-anthropic.mjs')).href+'?audit=mock');
  const code=await fs.readFile(path.join(tmp,'worker/anthropicUpstream.generated.js'),'utf8');
  assert.ok(code.includes('NO TRIMMING. '.repeat(120)));
  assert.ok(code.includes(`export const OFFICIAL_SHA = "${sha}"`));
  assert.ok(code.includes('scripts/with_server.py'));
  assert.ok(code.includes(`https://raw.githubusercontent.com/anthropics/skills/${sha}/skills/canvas-design/canvas-fonts/font.ttf`));
  const manifest=JSON.parse(await fs.readFile(path.join(tmp,'ANTHROPIC-UPSTREAM-MANIFEST.json'),'utf8'));
  assert.equal(manifest.skills.length,11);
  assert.equal(manifest.resources.length,2);
  assert.ok(manifest.resources.every(r=>!/(?:LICENSE|LICENCE)\.txt$/i.test(r.path)),'licenses are excluded from the script and reference bank');
  assert.ok(requests.some(x=>x.includes(`/git/trees/${treeSha}`)));
  assert.ok(!requests.some(x=>x.includes('/font.ttf')),'binary fonts are delivered through an immutable link');
 } finally {
  process.chdir(cwd);globalThis.fetch=originalFetch;await fs.rm(tmp,{recursive:true,force:true});
 }
});
