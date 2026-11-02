import { useEffect, useState } from "react";
import { skills } from "../../api/endpoints.js";

export default function ScriptBank({ active, revision }) {
  const [legacy, setLegacy] = useState([]);
  const [resources, setResources] = useState([]);
  const [opened, setOpened] = useState({});
  useEffect(() => {
    if (!active) return;
    setOpened({});
    skills.scripts().then(setLegacy).catch(() => {});
    skills.resources().then(setResources).catch(() => {});
  }, [active, revision]);
  const load = async (item) => {
    const key = item.skill + "/" + item.path;
    if (opened[key] !== undefined || item.kind === "asset") return;
    try {
      const data = await skills.resource(item.skill, item.path);
      setOpened(prev => ({...prev, [key]: data.content ?? "Binary asset: " + data.url}));
    } catch (err) {
      setOpened(prev => ({...prev, [key]: "Unable to fetch: " + String(err.message || err)}));
    }
  };
  if (!legacy.length && !resources.length) return null;
  return (
    <section className="card stack" aria-label="Skill resource bank">
      <div className="chead"><div className="grow"><h3>Skill resource bank</h3>
        <div className="sub">Original scripts, examples, references and assets. Source is returned to the agent, never executed by MemoryRelay.</div>
      </div></div>
      {resources.map(item => {
        const key = item.skill + "/" + item.path;
        return <details key={key} onToggle={e => { if (e.currentTarget.open) load(item); }}>
          <summary><strong>{item.path}</strong> <span className="muted small">· {item.skill} · {item.kind}</span></summary>
          {item.kind === "asset" ? <p><a href={item.url} rel="noreferrer" target="_blank">Original upstream asset</a></p> :
          <pre style={{whiteSpace: "pre", overflowX: "auto", maxHeight: 320, padding: 12, borderRadius: 10, background: "var(--paper2, #eef0f4)", fontSize: 12}}><code>{opened[key] ?? "Loading source…"}</code></pre>}
        </details>;
      })}
      {legacy.map(item => <details key={item.name}>
        <summary><strong>{item.name}</strong> <span className="muted small">· {item.skill} · MemoryRelay custom helper (not Anthropic)</span></summary>
        <pre style={{whiteSpace: "pre", overflowX: "auto", maxHeight: 320, padding: 12}}><code>{item.code}</code></pre>
      </details>)}
    </section>
  );
}
