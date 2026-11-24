import { useEffect, useState } from "react";
import { useApp } from "../../shell/AppContext.js";
import { useGemini } from "../../hooks/useGemini.js";
import Button from "../../components/Button.jsx";
import IconButton from "../../components/IconButton.jsx";
import SearchBar from "../../components/SearchBar.jsx";
import Icon from "../../components/Icon.jsx";
import Notice from "../../components/Notice.jsx";
import Segmented from "../../components/Segmented.jsx";
import KeyRow from "./KeyRow.jsx";

export default function GeminiPanel({ active }) {
  const { loadCounts } = useApp();
  const g = useGemini({ onChange: loadCounts });
  const [pane, setPane] = useState("keys");
  const [label, setLabel] = useState("");
  const [key, setKey] = useState("");
  const [model, setModel] = useState("");
  const [q,setQ] = useState("");

  useEffect(() => { if (active) g.load(); }, [active]); // eslint-disable-line react-hooks/exhaustive-deps
  const enabledKeyIds = g.keys.filter(k=>k.enabled).map(k=>k.id).join(',');
  useEffect(() => {
    if (active && pane === "models" && enabledKeyIds) g.loadAvailable();
  }, [active, pane, enabledKeyIds, g.loadAvailable]);

  const shown = g.available.filter(n=>n.toLowerCase().includes(q.toLowerCase()));
  const selected = new Set(g.models.map(m=>m.name));
  const addKey = async () => { if (await g.op({ op: "add_key", label, key })) setKey(""); };
  const addModel = async () => { if (await g.op({ op: "add_model", name: model.trim() })) setModel(""); };

  return (
    <div className="card">
      <p className="muted small" style={{ margin: "0 0 14px" }}>
        Each request tries the models in order, and for each model your keys in turn. Rate limits (429) and busy
        servers (503) move on to the next one automatically.
      </p>
      <Segmented label="Keys or models" value={pane} onChange={setPane} options={[
        { value: "keys", label: "Keys", count: g.keys.length },
        { value: "models", label: "Models", count: g.models.length },
      ]} />

      {pane === "keys" ? (
        <div id="pane-keys">
          <div className="row">
            <input id="gk-label" className="fld" style={{ flex: "0 1 130px" }} placeholder="Label" value={label} onChange={(e) => setLabel(e.target.value)} />
            <input id="gk-key" className="fld grow" type="password" placeholder="Paste an API key" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} />
            <Button id="gk-add" icon="plus" onClick={addKey}>Add key</Button>
          </div>
          <div id="gk-list" className="stack list">
            {g.keys.map((k) => (
              <KeyRow key={k.id} enabled={k.enabled} onToggle={() => g.op({ op: "toggle_key", id: k.id })}
                lead={<span className={"ic " + (k.enabled ? "ok" : "lock")}><Icon name={k.enabled ? "check" : "lock"} size={18} /></span>}
                title={k.label} sub={"Ends in " + k.tail + (k.cooling.length ? ", cooling down" : "")}
                note={(k.enabled ? "Used in rotation." : "Switched off. It is skipped until you turn it back on.") +
                  (k.cooling.length ? " Cooling down for: " + k.cooling.join(", ") + "." : "")}
                actions={[{ key: "del", label: "Delete key", icon: "trash", variant: "danger",
                  onClick: () => g.op({ op: "delete_key", id: k.id }), confirm: { text: "Delete this key?", yes: "Yes, delete" } }]} />
            ))}
            {!g.keys.length ? <p className="empty">No keys yet.</p> : null}
          </div>
        </div>
      ) : (
        <div id="pane-models">
          <div className="row">
            <input id="gm-name" className="fld grow" list="gm-opts" placeholder="Model name" value={model} onChange={(e) => setModel(e.target.value)} />
            <datalist id="gm-opts">{g.available.map((n) => <option key={n} value={n} />)}</datalist>
            <Button id="gm-load" variant="ghost" onClick={g.loadAvailable} disabled={!enabledKeyIds || g.loadingAvailable}>{g.loadingAvailable ? "Loading…" : "Refresh models"}</Button>
            <Button id="gm-add" icon="plus" onClick={addModel}>Add</Button>
          </div>
          {!enabledKeyIds ? <p className="muted small">Enable a saved Gemini key to browse models. You do not need to paste it again.</p> : null}
          {g.loadingAvailable ? <p className="muted small" role="status">Fetching available models…</p> : null}
          {g.available.length > 0 ? <>
            <div style={{marginTop:10}}><SearchBar id="gm-filter" type="search" placeholder="Filter available models" value={q} onChange={e=>setQ(e.target.value)} /></div>
            <div className="stack list" style={{marginTop:10}}>
              {shown.slice(0,150).map(n=><div className="dcard" key={n}>
                <div className="dhead"><div className="dmain" style={{cursor:"default"}}><span className="tt"><code>{n}</code></span></div>
                  {selected.has(n) ? <span className="badge ok">Added</span> : <IconButton icon="plus" label={"Add " + n} onClick={()=>g.op({op:"add_model",name:n})} />}
                </div>
              </div>)}
            </div>
            {shown.length>150 ? <p className="muted small">Showing 150 models. Filter to narrow the list.</p> : null}
          </> : null}
          <h3 style={{marginTop:18}}>Your models</h3>
          <div id="gm-list" className="stack list">
            {g.models.map((m, i) => (
              <KeyRow key={m.name} enabled={m.enabled} onToggle={() => g.op({ op: "toggle_model", name: m.name })}
                lead={<span className="ic num">{i + 1}</span>} title={m.name} sub={m.enabled ? "On" : "Off"}
                actions={[
                  { key: "up", label: "Move up", icon: "up", onClick: () => g.op({ op: "move_model", name: m.name, dir: -1 }) },
                  { key: "down", label: "Move down", icon: "down", onClick: () => g.op({ op: "move_model", name: m.name, dir: 1 }) },
                  { key: "del", label: "Delete", icon: "trash", variant: "danger", onClick: () => g.op({ op: "delete_model", name: m.name }),
                    confirm: { text: "Delete this model?", yes: "Yes, delete" } },
                ]} />
            ))}
            {!g.models.length ? <p className="empty">No models yet.</p> : null}
          </div>
        </div>
      )}
      <Notice id="gm-msg" tone="muted">{g.message}</Notice>
    </div>
  );
}
