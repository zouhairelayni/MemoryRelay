import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Sheet from "../../components/Sheet.jsx";
import Button from "../../components/Button.jsx";
import Notice from "../../components/Notice.jsx";
import { skills as api } from "../../api/endpoints.js";
import { estimateTokens } from "../../lib/tokens.js";

// Skill Studio: write a skill with AI, or edit one by hand or with AI. Nothing is saved until you press Save.
// target: null (closed) | { fresh: true } (new skill) | { name } (edit an existing skill)
export default function SkillStudio({ target, onClose, onSaved }) {
  const editing = !!(target && target.name);
  const [text, setText] = useState("");
  const [saved, setSaved] = useState("");
  const [ask, setAsk] = useState("");
  const [busy, setBusy] = useState("");
  const [warnings, setWarnings] = useState([]);
  const [versions, setVersions] = useState(0);
  const [limit, setLimit] = useState(5000);
  const [note, setNote] = useState({ text: "", tone: "muted" });
  const [discard, setDiscard] = useState(false);
  const say = (t, tone = "muted") => setNote({ text: t, tone });

  useEffect(() => {
    if (!target) return;
    setAsk(""); setDiscard(false); setWarnings([]); setVersions(0); say("");
    if (target.name) {
      setBusy("load"); setText(""); setSaved("");
      api.get(target.name)
        .then((d) => { setText(d.text); setSaved(d.text); setWarnings(d.warnings || []); setVersions(d.versions || 0); setLimit(d.max_tokens || 5000); })
        .catch((e) => say(e.message, "bad"))
        .finally(() => setBusy(""));
    } else { setText(""); setSaved(""); }
  }, [target]);

  const hasText = !!text.trim();
  const tokens = estimateTokens(text);
  const dirty = text !== saved;

  const runAi = async () => {
    setBusy("ai"); say("");
    try {
      const d = hasText ? await api.improve(text, ask) : await api.generate(ask);
      setText(d.text); setWarnings(d.warnings || []);
      const diff = hasText ? " +" + d.added + " / \u2212" + d.removed + " lines." : "";
      say("Drafted by " + d.model + "." + diff + (d.repaired ? " It was fixed automatically once." : "") + " Read it, then press Save.", "ok");
      setAsk("");
    } catch (e) { say(e.message, "bad"); } finally { setBusy(""); }
  };

  const save = async () => {
    setBusy("save"); say("");
    try {
      const d = editing ? await api.update(target.name, text) : await api.add(text, "ai");
      const name = d.name || target.name;
      onSaved((editing ? "Saved " : "Added ") + name + "." + (d.warnings && d.warnings.length ? " Check before use: " + d.warnings.join("; ") + "." : ""), !!(d.warnings && d.warnings.length));
      setSaved(text); onClose();
    } catch (e) { say(e.message, "bad"); } finally { setBusy(""); }
  };

  const undo = async () => {
    setBusy("save"); say("");
    try {
      const d = await api.revert(target.name);
      setText(d.text); setSaved(d.text); setWarnings(d.warnings || []); setVersions(d.versions || 0);
      say("Went back to the earlier version.", "ok"); onSaved("Went back to the earlier version of " + target.name + ".", false);
    } catch (e) { say(e.message, "bad"); } finally { setBusy(""); }
  };

  const tryClose = () => { if (dirty && hasText && !discard) setDiscard(true); else onClose(); };
  const shell = typeof document !== "undefined" ? document.querySelector(".shell") : null;
  if (!shell) return null;

  return createPortal(
    <Sheet open={!!target} title={editing ? "Edit skill" : "New skill"} closeLabel="Close the skill editor" onClose={tryClose}>
      <div className="card">
        <label className="lbl" htmlFor="st-ask">{hasText ? "What should change?" : "What should the skill do?"}</label>
        <textarea id="st-ask" className="fld" style={{ minHeight: 84, marginTop: 8 }} value={ask} onChange={(e) => setAsk(e.target.value)}
          placeholder={hasText ? "for example: add a rule to never edit lockfiles" : "for example: write the weekly status report from my notes, in three bullet points"} />
        <div className="row">
          <Button id="st-ai" onClick={runAi} disabled={!!busy || ask.trim().length < (hasText ? 4 : 8)}>
            {busy === "ai" ? "Thinking\u2026" : hasText ? "Apply change with AI" : "Draft with AI"}
          </Button>
        </div>
        <p className="muted small" style={{ margin: "8px 0 0" }}>The AI only writes a draft here. It is checked like an upload and never saved or switched on by itself.</p>
      </div>

      <div className="card">
        <div className="top">
          <h3>SKILL.md</h3>
          <span className="muted small">~{tokens} / {limit} tokens</span>
        </div>
        <textarea id="st-text" className="fld" style={{ minHeight: 320, fontFamily: "var(--mono)", fontSize: 13, marginTop: 8 }}
          spellCheck={false} value={text} disabled={busy === "load"} onChange={(e) => setText(e.target.value)}
          placeholder={"---\nname: my-skill\ndescription: Use when ...\n---\nInstructions..."} />
        {tokens > limit ? <Notice tone="bad">Over the limit by about {tokens - limit} tokens. Shorten it.</Notice> : null}
        {warnings.length ? <Notice tone="bad">Check before use: {warnings.join("; ")}.</Notice> : null}
        <Notice tone={note.tone} id="st-msg">{note.text}</Notice>
        {discard ? (
          <div className="row">
            <span className="small">Discard your unsaved changes?</span>
            <Button small variant="sdanger" onClick={onClose}>Yes, discard</Button>
            <Button small variant="ghost" onClick={() => setDiscard(false)}>Keep editing</Button>
          </div>
        ) : (
          <div className="row">
            <Button id="st-save" onClick={save} disabled={!!busy || !hasText || (editing && !dirty)}>{busy === "save" ? "Saving\u2026" : "Save skill"}</Button>
            {editing && versions ? <Button variant="ghost" id="st-undo" onClick={undo} disabled={!!busy || dirty}>Undo last save</Button> : null}
            <Button variant="ghost" onClick={tryClose}>Close</Button>
          </div>
        )}
      </div>
    </Sheet>,
    shell
  );
}
