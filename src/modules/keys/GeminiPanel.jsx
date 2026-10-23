import { useEffect, useState } from "react";
import { useApp } from "../../shell/AppContext.js";
import { useGemini } from "../../hooks/useGemini.js";
import Button from "../../components/Button.jsx";
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

  useEffect(() => { if (active) g.load(); }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

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
                title={k.label} sub={"...." + k.tail + (k.cooling.length ? " · cooling" : "")}
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
            <Button id="gm-load" variant="ghost" onClick={g.loadAvailable}>Load list</Button>
            <Button id="gm-add" icon="plus" onClick={addModel}>Add</Button>
          </div>
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
