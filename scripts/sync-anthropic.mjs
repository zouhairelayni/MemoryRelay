#!/usr/bin/env node
// Import unmodified skill content and all upstream supporting resources from Anthropic.
// Binary assets stay as immutable upstream URLs; text source is bundled and served via MCP.
import fs from "node:fs/promises";
import path from "node:path";
const names = ["mcp-builder","skill-creator","doc-coauthoring","frontend-design","webapp-testing","internal-comms","discernment-nudge","web-artifacts-builder","theme-factory","canvas-design","brand-guidelines"];
const BASE = "https://api.github.com/repos/anthropics/skills";
const output = path.resolve("worker/anthropicUpstream.generated.js");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function fetchText(url, attempts=4) {
  for (let i=0; i<attempts; i++) {
    const r = await fetch(url,{headers:{"User-Agent":"MemoryRelay-SkillImporter/2.0","Accept":"application/vnd.github+json"},signal:AbortSignal.timeout(45000)});
    if (r.ok) return r.text();
    if (i===attempts-1 || ![429,500,502,503,504].includes(r.status)) throw new Error(`upstream fetch failed ${r.status}: ${url}`);
    await sleep(1500*(i+1));
  }
}
const commit = JSON.parse(await fetchText(`${BASE}/commits/main`));
const sha = commit.sha;
const treeSha = commit.commit?.tree?.sha;
if (!/^[0-9a-f]{40}$/.test(treeSha || "")) throw new Error("invalid GitHub tree SHA");
if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error("invalid GitHub commit SHA");
const tree = JSON.parse(await fetchText(`${BASE}/git/trees/${treeSha}?recursive=1`));
if (tree.truncated || !Array.isArray(tree.tree)) throw new Error("incomplete GitHub tree; refusing partial import");
const entries = tree.tree.filter(x => x.type==="blob" && names.some(n=>x.path.startsWith(`skills/${n}/`)));
const sourceFor=(f)=>`https://raw.githubusercontent.com/anthropics/skills/${sha}/${f}`;
const textFile=(f)=>/\.(md|py|sh|js|mjs|cjs|ts|tsx|jsx|json|html|htm|css|txt|yaml|yml|toml|xml|svg|csv)$/i.test(f);
const cache=new Map();
async function fetchFile(f) {
  if(!cache.has(f)) cache.set(f,fetchText(sourceFor(f)));
  return cache.get(f);
}
const skills=[];
for(const name of names){
 const f=`skills/${name}/SKILL.md`;
 if(!entries.some(x=>x.path===f)) throw new Error("missing upstream SKILL.md: "+f);
 const content=await fetchFile(f);
 if(!content.startsWith("---\n")) throw new Error("malformed source skill "+f);
 const header=content.split(/\n---\s*\n/,1)[0];
 const match=header.match(/^description:\s*(.*)$/m);
 if(!match) throw new Error("skill without description: "+f);
 let description=match[1].trim();
 if(description==='>'||description==='|'||description==='>-'){
   const lines=content.split('\n');const start=lines.findIndex(l=>l.startsWith('description:'))+1;
   const parts=[];
   for(let i=start;i<lines.length&&/^\s+\S/.test(lines[i]);i++) parts.push(lines[i].trim());
   description=parts.join(' ');
 }
 if(!description||description.length>1024) throw new Error('bad description '+name);
 skills.push({name,description,content});
}
const resources=[];
for(const file of entries){
 const seg=file.path.split('/');const name=seg[1], rel=seg.slice(2).join('/');
 if(rel==='SKILL.md') continue;
 const url=sourceFor(file.path);
 // Some Anthropic resource bundles include large binary fonts/media. Preserve their paths/URLs;
 // never inline or alter the binary assets, and never truncate textual instructions/scripts.
 if(textFile(rel) && file.size <= 750000){
   const content=await fetchFile(file.path);
   resources.push({skill:name,path:rel,kind:rel.match(/\.(py|sh|js|mjs|cjs|ts|tsx)$/i)?'script':'reference',content,url});
 }else{
   resources.push({skill:name,path:rel,kind:'asset',content:null,url});
 }
}
const text = `// Upstream official skills. Auto-generated; do not hand-edit. Source: ${sha}\n` +
  `export const OFFICIAL_SHA = ${JSON.stringify(sha)};\n`+
  `export const OFFICIAL_SKILLS = ${JSON.stringify(skills)};\n`+
  `export const OFFICIAL_RESOURCES = ${JSON.stringify(resources)};\n`;
await fs.writeFile(output,text);
await fs.writeFile('ANTHROPIC-UPSTREAM-MANIFEST.json',JSON.stringify({repo:'https://github.com/anthropics/skills',commit:sha,skills:skills.map(x=>({name:x.name,bytes:Buffer.byteLength(x.content),source:sourceFor(`skills/${x.name}/SKILL.md`)})),resources:resources.map(x=>({skill:x.skill,path:x.path,kind:x.kind,bytes:x.content===null?null:Buffer.byteLength(x.content),url:x.url}))},null,2)+'\n');
console.log(`Imported unmodified Anthropic SKILL.md files: ${skills.length}; resources: ${resources.length}; commit: ${sha.slice(0,12)}`);
