import { useEffect, useRef, useState } from "react";
import Button from "../../components/Button.jsx";
import Switch from "../../components/Switch.jsx";
import { copyText, readText } from "../../lib/clipboard.js";
import { useApp } from "../../shell/AppContext.js";
import { DEFAULT_MEMORY_TOKENS, MAX_MEMORY_TEXT_CHARS, estimateMemoryTokens } from "../../../shared/memoryBudget.js";


// Used for both adding and editing. Rule on = the tag is exactly "rules" (agents can never change or delete it).
// Rule off = up to 5 free tags.
export default function MemoryEditor({ initial, saveLabel = "Save", onSave, onCancel, autoFocus = false, idPrefix = "ed" }) {
  const { counts } = useApp();
  const maxTokens = counts.memory_max_tokens || DEFAULT_MEMORY_TOKENS;
  const [text, setText] = useState(initial.text || "");
  const tokens = estimateMemoryTokens(text);
  const tooLong = tokens > maxTokens;
  const [rule, setRule] = useState(!!initial.rule);
  const [tags, setTags] = useState(initial.rule ? "rules" : initial.tags || "");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const area = useRef(null);
  const savedTags = useRef(initial.rule ? "" : initial.tags || "");

  useEffect(() => { if (autoFocus && area.current) area.current.focus(); }, [autoFocus]);

  const toggleRule = (on) => {
    setRule(on);
    if (on) { savedTags.current = tags; setTags("rules"); }
    else setTags(savedTags.current && savedTags.current !== "rules" ? savedTags.current : "");
  };

  const selectAll = () => {
    const ta = area.current;
    ta.focus(); ta.select();
    try { ta.setSelectionRange(0, ta.value.length); } catch { /* ignore */ }
    setNote("");
  };

  const copy = async () => {
    const ta = area.current;
    const sel = ta.selectionStart !== ta.selectionEnd ? ta.value.slice(ta.selectionStart, ta.selectionEnd) : ta.value;
    if (!sel) { setNote("Nothing to copy."); return; }
    setNote((await copyText(sel)) ? "Copied." : "The browser blocked copying.");
  };

  const paste = async () => {
    const ta = area.current;
    try {
      const t = await readText();
      if (!t) { setNote("The clipboard is empty."); return; }
      const start = ta.selectionStart, end = ta.selectionEnd;
      let next = ta.value.slice(0, start) + t + ta.value.slice(end);
      const cut = next.length > MAX_MEMORY_TEXT_CHARS;
      if (cut) next = next.slice(0, MAX_MEMORY_TEXT_CHARS);
      setText(next);
      setNote(cut ? `Pasted and trimmed at the ${MAX_MEMORY_TEXT_CHARS}-character safety bound.` : "Pasted.");
      ta.focus();
    } catch {
      setNote("Paste is not available here. Long-press the box and choose Paste.");
    }
  };

  const save = async () => {
    if (tooLong) { setError(`Memory exceeds the limit of ${maxTokens} estimated tokens.`); return; }
    setBusy(true); setError("");
    try { await onSave({ text, tags, rule }); }
    catch (e) { setError(e.message); setBusy(false); }
  };

  return (
    <div className="editor">
      <div className="tools">
        <Button small variant="ghost" data-ed="selectall" onClick={selectAll}>Select all</Button>
        <Button small variant="ghost" data-ed="copy" onClick={copy}>Copy</Button>
        <Button small variant="ghost" data-ed="paste" onClick={paste}>Paste</Button>
        <span className="count" aria-live="polite" style={tooLong ? { color: "var(--rose)" } : undefined}>{tokens}/{maxTokens} estimated tokens</span>
      </div>
      <textarea id={idPrefix + "-text"} ref={area} className="fld" maxLength={MAX_MEMORY_TEXT_CHARS} value={text}
        placeholder="One short, self-contained fact" onChange={(e) => setText(e.target.value)} />
      <Switch checked={rule} onChange={toggleRule} id={idPrefix + "-rule"}>Rule (only you can edit or delete)</Switch>
      <div className="tagrow">
        <input id={idPrefix + "-tags"} className="fld" placeholder="Tags, comma separated (max 5)" value={tags}
          disabled={rule} onChange={(e) => setTags(e.target.value)} />
      </div>
      <div className="note">{note}</div>
      <div className="row">
        <Button id={idPrefix + "-save"} disabled={busy || tooLong} onClick={save}>{saveLabel}</Button>
        <Button variant="ghost" id={idPrefix + "-cancel"} onClick={onCancel}>Cancel</Button>
      </div>
      {error ? <p className="notice small bad" id={idPrefix + "-err"} role="alert">{error}</p> : null}
    </div>
  );
}
