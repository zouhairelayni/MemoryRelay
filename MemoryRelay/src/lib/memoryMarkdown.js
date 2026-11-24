/** Safe, intentionally small Markdown grammar for memory content.
 * Parser returns plain data, renderer uses React text nodes (no innerHTML).
 * HTML, images and arbitrary embedded links are always treated as plain text.
 */
export function inlineTokens(source) {
  const text = String(source || "");
  const pattern = /(\*\*([^*\n]+)\*\*|__([^_\n]+)__|`([^`\n]+)`|\*([^*\n]+)\*|_([^_\n]+)_)/g;
  const result = []; let index = 0; let match;
  while ((match = pattern.exec(text))) {
    if (match.index > index) result.push({ type: "text", value: text.slice(index, match.index) });
    result.push({ type: match[2] !== undefined || match[3] !== undefined ? "strong" : match[4] !== undefined ? "code" : "em",
      value: match[2] ?? match[3] ?? match[4] ?? match[5] ?? match[6] });
    index = match.index + match[0].length;
  }
  if (index < text.length) result.push({ type: "text", value: text.slice(index) });
  return result;
}

export function parseMemoryMarkdown(source) {
  const lines = String(source || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  for (let i = 0; i < lines.length;) {
    let line = lines[i];
    if (!line.trim()) { i++; continue; }
    const fence = line.match(/^\s*```([\w.+-]{0,24})\s*$/);
    if (fence) {
      const contents = []; i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) contents.push(lines[i++]);
      if (i < lines.length) i++;
      blocks.push({ type: "code", language: fence[1] || "text", value: contents.join("\n") });
      continue;
    }
    const heading = line.match(/^\s*(#{1,4})\s+(.+)$/);
    if (heading) { blocks.push({ type: "heading", level: heading[1].length, text: heading[2] }); i++; continue; }
    const list = line.match(/^\s*([-*+]\s+|\d+[.)]\s+)(.+)$/);
    if (list) {
      const ordered = /^\d/.test(list[1]); const items=[];
      while (i < lines.length) {
        const m=lines[i].match(/^\s*([-*+]\s+|\d+[.)]\s+)(.+)$/);
        if (!m || ordered !== /^\d/.test(m[1])) break;
        items.push(m[2]);i++;
      }
      blocks.push({ type: ordered ? "ordered" : "list", items }); continue;
    }
    if (/^\s*>\s?/.test(line)) {
      const quote=[]; while(i<lines.length && /^\s*>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/,""));
      blocks.push({ type: "quote", text:quote.join(" ") }); continue;
    }
    const para=[];
    while (i<lines.length && lines[i].trim() && !/^\s*(```|#{1,4}\s+|[-*+]\s+|\d+[.)]\s+|>\s?)/.test(lines[i])) para.push(lines[i++]);
    if (!para.length) { para.push(lines[i]);i++; }
    blocks.push({ type: "paragraph", text:para.join(" ") });
  }
  return blocks;
}

export function memoryTitle(text) {
  const first = String(text||"").split(/\r?\n/).map(s=>s.trim()).find(Boolean)||"Memory";
  return first.replace(/^#{1,4}\s+/,"").replace(/^\*\*(.*)\*\*$/, "$1").slice(0,110);
}
