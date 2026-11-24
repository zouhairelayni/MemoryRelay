import { useRef, useState } from "react";
import { backup } from "../api/endpoints.js";
import { useApp } from "../shell/AppContext.js";
import Button from "../components/Button.jsx";
import ActionRow from "../components/ActionRow.jsx";
import Notice from "../components/Notice.jsx";
import Segmented from "../components/Segmented.jsx";
import Section from "./Section.jsx";

export default function Backup() {
  const { loadCounts } = useApp();
  const [mode, setMode] = useState("merge");
  const [msg, setMsg] = useState("");
  const [tone, setTone] = useState("muted");
  const file = useRef(null);

  const say = (text, t = "muted") => { setMsg(text); setTone(t); };

  const exportNow = async () => {
    try {
      const blob = await backup.exportJson();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = "memories-backup.json"; a.click();
      say("Backup downloaded.", "ok");
    } catch (e) { say("Export failed: " + e.message, "bad"); }
  };

  const importNow = async () => {
    const f = file.current && file.current.files[0];
    if (!f) { say("Choose a JSON file first", "bad"); return; }
    try {
      const d = await backup.importJson(await f.text(), mode);
      say("Imported " + d.imported + ". Total " + d.total + ".", "ok");
      loadCounts();
    } catch (e) { say("Import failed: " + e.message, "bad"); }
  };

  const importAction = mode === "replace"
    ? { key: "imp", label: "Import", icon: "upload", variant: "solid", onClick: importNow,
        confirm: { text: "Replace all memories with this file? Rules are kept.", yes: "Yes, replace" } }
    : { key: "imp", label: "Import", icon: "upload", variant: "solid", onClick: importNow };

  return (
    <Section title="Backup">
      <p className="muted small" style={{ margin: "0 0 12px" }}>Download every memory as a file, or load one back in.</p>
      <Button id="exp" icon="download" variant="ghost" onClick={exportNow}>Export memories</Button>
      <div style={{ marginTop: 16 }}>
        <input id="file" ref={file} type="file" accept="application/json,.json" className="fld" />
      </div>
      <div className="row">
        <Segmented label="Import mode" value={mode} onChange={setMode} options={[
          { value: "merge", label: "Merge" }, { value: "replace", label: "Replace" },
        ]} />
      </div>
      <div id="imp-wrap"><ActionRow className="row" actions={[importAction]} /></div>
      <Notice id="msg" tone={tone}>{msg}</Notice>
    </Section>
  );
}
