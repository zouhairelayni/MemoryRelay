import { useEffect, useState } from "react";
import { skills } from "../../api/endpoints.js";

// Templates are only returned to the owner; scripts are never run by the Worker.
export default function ScriptBank({ active }) {
  const [scripts, setScripts] = useState([]);
  useEffect(() => { if (active) skills.scripts().then(setScripts).catch(() => {}); }, [active]);
  if (!scripts.length) return null;
  return (
    <section className="card stack" aria-label="Python script bank">
      <div className="chead"><div className="grow"><h3>Python script bank</h3>
        <div className="sub">Templates are sent automatically with their matching skills. They run only in an agent's authorized Python environment.</div>
      </div></div>
      {scripts.map((s) => <details key={s.name}>
        <summary><strong>{s.name}</strong> <span className="muted small">· {s.skill}</span></summary>
        <p className="muted small">{s.description}</p>
        <pre style={{ whiteSpace: "pre", overflowX: "auto", maxHeight: 320, padding: 12, borderRadius: 10, background: "var(--paper2, #eef0f4)", fontSize: 12 }}><code>{s.code}</code></pre>
      </details>)}
    </section>
  );
}
