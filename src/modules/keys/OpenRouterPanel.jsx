import { useEffect, useMemo, useState } from "react";
import { useApp } from "../../shell/AppContext.js";
import { openrouter } from "../../api/endpoints.js";
import Button from "../../components/Button.jsx";
import Icon from "../../components/Icon.jsx";
import Notice from "../../components/Notice.jsx";
import Segmented from "../../components/Segmented.jsx";
import KeyRow from "./KeyRow.jsx";

// OpenRouter: keys rotate, and browsing shows FREE models only.
export default function OpenRouterPanel({ active }) {
  const { loadCounts } = useApp();
  const [state, setState] = useState({ keys: [], models: [] });
  const [pane, setPane] = useState("keys");
  const [label, setLabel] = useState("");
  const [key, setKey] = useState("");
  const [free, setFree] = useState(null);      // null = not browsed yet
  const [q, setQ] = useState("");
  const [message, setMessage] = useState({ text: "", tone: "muted" });

  const say = (text, tone = "muted") => setMessage({ text, tone });
  const load = () => openrouter.state().then(setState).catch((e) => say(e.message, "bad"));
  useEffect(() => { if (active) load(); }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  const op = async (body) => {
    try {
      setState(await openrouter.op(body));
      say("");
      loadCounts();
      return true;
    } catch (e) { say(e.message, "bad"); load(); return false; }
  };

  const browse = async () => {
    say("Loading free models...");
    try {
      const list = await openrouter.freeModels();
      setFree(list);
      say(list.length + " free models. Tap Add on the ones you want.");
    } catch (e) { say(e.message, "bad"); }
  };

  const shown = useMemo(() => (free || []).filter((m) => {
    const hay = (m.id + " " + m.name).toLowerCase();
    return !q || hay.includes(q.toLowerCase());
  }), [free, q]);
  const have = new Set(state.models.map((m) => m.name));

  const addKey = async () => { if (await op({ op: "add_key", label, key })) { setKey(""); } };

  return (
    <div className="card">
      <p className="muted small" style={{ margin: "0 0 14px" }}>
        Paste keys from openrouter.ai. Models are free-only here: nothing you add will bill you.
        Rate limits (429) move on to the next key or model.
      </p>
      <Segmented label="Keys or models" value={pane} onChange={setPane} options={[
        { value: "keys", label: "Keys", count: state.keys.length },
        { value: "models", label: "Models", count: state.models.length },
      ]} />

      {pane === "keys" ? (
        <div>
          <div className="row">
            <input id="or-label" className="fld" style={{ flex: "0 1 130px" }} placeholder="Label" value={label} onChange={(e) => setLabel(e.target.value)} />
            <input id="or-key" className="fld grow" type="password" placeholder="sk-or-..." autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} />
            <Button id="or-add-key" icon="plus" onClick={addKey}>Add key</Button>
          </div>
          <div id="or-keys" className="stack list">
            {state.keys.map((k) => (
              <KeyRow key={k.id} enabled={k.enabled} onToggle={() => op({ op: "toggle_key", id: k.id })}
                lead={<span className={"ic " + (k.enabled ? "ok" : "lock")}><Icon name={k.enabled ? "check" : "lock"} size={18} /></span>}
                title={k.label} sub={"...." + k.tail + (k.cooling.length ? " · cooling" : "")}
                note={(k.enabled ? "Used in rotation." : "Switched off.") + (k.cooling.length ? " Cooling down for: " + k.cooling.join(", ") + "." : "")}
                actions={[{ key: "del", label: "Delete key", icon: "trash", variant: "danger",
                  onClick: () => op({ op: "delete_key", id: k.id }), confirm: { text: "Delete this key?", yes: "Yes, delete" } }]} />
            ))}
            {!state.keys.length ? <p className="empty">No keys yet.</p> : null}
          </div>
        </div>
      ) : (
        <div>
          <div className="row">
            <Button id="or-browse" variant="ghost" icon="download" onClick={browse}>Browse free models</Button>
          </div>
          {free ? (
            <>
              <input id="or-q" className="fld" type="search" placeholder="Filter free models" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginTop: 12 }} />
              <div id="or-browse-list" className="stack list" style={{ marginTop: 10 }}>
                {shown.map((m) => (
                  <div className="dcard" key={m.id}>
                    <div className="dhead">
                      <div className="dmain" style={{ cursor: "default" }}>
                        <span className="tt"><code>{m.id}</code><small>{m.name}{m.context ? " · " + m.context.toLocaleString() + " tokens" : ""}</small></span>
                      </div>
                      {have.has(m.id)
                        ? <span className="badge ok">Added</span>
                        : <Button small onClick={() => op({ op: "add_model", name: m.id })}>Add</Button>}
                    </div>
                  </div>
                ))}
                {!shown.length ? <p className="empty">No free model matches.</p> : null}
              </div>
            </>
          ) : null}
          <h3 style={{ marginTop: 18 }}>Your models</h3>
          <div id="or-models" className="stack list" style={{ marginTop: 8 }}>
            {state.models.map((m, i) => (
              <KeyRow key={m.name} enabled={m.enabled} onToggle={() => op({ op: "toggle_model", name: m.name })}
                lead={<span className="ic num">{i + 1}</span>} title={m.name} sub={m.enabled ? "On" : "Off"}
                actions={[
                  { key: "up", label: "Move up", icon: "up", onClick: () => op({ op: "move_model", name: m.name, dir: -1 }) },
                  { key: "down", label: "Move down", icon: "down", onClick: () => op({ op: "move_model", name: m.name, dir: 1 }) },
                  { key: "del", label: "Delete", icon: "trash", variant: "danger", onClick: () => op({ op: "delete_model", name: m.name }),
                    confirm: { text: "Delete this model?", yes: "Yes, delete" } },
                ]} />
            ))}
            {!state.models.length ? <p className="empty">No models yet. Browse free models above.</p> : null}
          </div>
        </div>
      )}
      <Notice tone={message.tone} id="or-msg">{message.text}</Notice>
    </div>
  );
}
