import { useEffect, useRef, useState } from "react";
import Button from "../../components/Button.jsx";
import Switch from "../../components/Switch.jsx";
import { copyText, readText } from "../../lib/clipboard.js";

const MAX = 500;

// Used for both adding and editing. Rule on = the tag is exactly "rules" (agents can never change or delete it).
// Rule off = up to 3 free tags.
export default function MemoryEditor({ initial, saveLabel = "Save", onSave, onCancel, autoFocus = false, idPrefix = "ed" }) {
  const [text, setText] = useState(initial.text || "");
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
      const cut = next.length > MAX;
      if (cut) next = next.slice(0, MAX);
      setText(next);
      setNote(cut ? "Pasted and trimmed to 500 characters." : "Pasted.");
      ta.focus();
    } catch {
      setNote("Paste is not available here. Long-press the box and choose Paste.");
    }
  };

  const save = async () => {
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
        <span className="count">{text.length}/{MAX}</span>
      </div>
      <textarea id={idPrefix + "-text"} ref={area} className="fld" maxLength={MAX} value={text}
        placeholder="One short, self-contained fact" onChange={(e) => setText(e.target.value)} />
      <Switch checked={rule} onChange={toggleRule} id={idPrefix + "-rule"}>Rule (only you can edit or delete)</Switch>
      <div className="tagrow">
        <input id={idPrefix + "-tags"} className="fld" placeholder="Tags, comma separated (max 3)" value={tags}
          disabled={rule} onChange={(e) => setTags(e.target.value)} />
      </div>
      <div className="note">{note}</div>
      <div className="row">
        <Button id={idPrefix + "-save"} disabled={busy} onClick={save}>{saveLabel}</Button>
        <Button variant="ghost" id={idPrefix + "-cancel"} onClick={onCancel}>Cancel</Button>
      </div>
      {error ? <p className="notice small bad" id={idPrefix + "-err"} role="alert">{error}</p> : null}
    </div>
  );
}
