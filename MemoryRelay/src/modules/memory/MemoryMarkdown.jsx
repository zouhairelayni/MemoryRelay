import { useMemo, useState } from "react";
import { copyText } from "../../lib/clipboard.js";
import { inlineTokens, parseMemoryMarkdown } from "../../lib/memoryMarkdown.js";

function InlineCode({ value }) {
  const [copied,setCopied]=useState(false);
  const copy=async()=>{setCopied(await copyText(value));};
  return <button type="button" className="memory-inline-copy" onClick={copy} title="Copy inline command" aria-label={`Copy inline command: ${value}`}><code>{value}</code><span aria-hidden="true">{copied?"✓":"⧉"}</span></button>;
}
function Inline({ text }) {
  return inlineTokens(text).map((t,i) => t.type === "strong" ? <strong key={i}>{t.value}</strong> :
    t.type === "em" ? <em key={i}>{t.value}</em> : t.type === "code" ? <InlineCode key={i} value={t.value}/> : <span key={i}>{t.value}</span>);
}
function CommandBlock({ language, value }) {
  const [copied,setCopied]=useState(false);
  const copy=async()=>{ const ok=await copyText(value); setCopied(ok); };
  return <div className="memory-md-code"><div className="memory-md-code-head"><span>{language === "text" ? "Text / commands" : language}</span><button type="button" aria-label="Copy command block" onClick={copy}>{copied?"Copied ✓":"Copy"}</button></div><pre><code>{value}</code></pre></div>;
}
export default function MemoryMarkdown({ text }) {
  const blocks=useMemo(()=>parseMemoryMarkdown(text),[text]);
  return <div className="memory-markdown">{blocks.map((b,i)=>{
    if (b.type === "heading") return <p key={i} className="memory-md-heading"><Inline text={b.text}/></p>;
    if (b.type === "code") return <CommandBlock key={i} language={b.language} value={b.value}/>;
    if (b.type === "quote") return <blockquote key={i}><Inline text={b.text}/></blockquote>;
    if (b.type === "list" || b.type === "ordered") {
      const Tag = b.type === "list" ? "ul" : "ol";
      return <Tag className="memory-md-list" key={i}>{b.items.map((v,j)=><li key={j}><Inline text={v}/></li>)}</Tag>;
    }
    return <p key={i} className={i===0?"memory-md-heading":""}><Inline text={b.text}/></p>;
  })}</div>;
}
