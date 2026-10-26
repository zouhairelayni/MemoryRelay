import { useEffect, useMemo, useState } from "react";
import { useApp } from "../../shell/AppContext.js";
import { provider } from "../../api/endpoints.js";
import Button from "../../components/Button.jsx";
import Icon from "../../components/Icon.jsx";
import IconButton from "../../components/IconButton.jsx";
import Notice from "../../components/Notice.jsx";
import SearchBar from "../../components/SearchBar.jsx";
import Segmented from "../../components/Segmented.jsx";
import KeyRow from "./KeyRow.jsx";

// Keys and models for a provider that speaks the OpenAI chat protocol (OpenRouter, NVIDIA, OpenAI).
// props: id, title, intro, keyHint, browseLabel
export default function CompatPanel({ id, title, intro, keyHint, browseLabel = "Load models", active }) {
  const { loadCounts } = useApp();
  const api = useMemo(() => provider(id), [id]);
  const [state, setState] = useState({ keys: [], models: [] });
  const [pane, setPane] = useState("keys");
  const [label, setLabel] = useState("");
  const [key, setKey] = useState("");
  const [list, setList] = useState(null);      // null = not loaded yet
  const [q, setQ] = useState("");
  const [typed, setTyped] = useState("");
  const [message, setMessage] = useState({ text: "", tone: "muted" });

  const say = (text, tone = "muted") => setMessage({ text, tone });
  const load = () => api.state().then(setState).catch((e) => say(e.message, "bad"));
  useEffect(() => { if (active) load(); }, [active, id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setPane("keys"); setList(null); setQ(""); say(""); }, [id]);

  const op = async (body) => {
    try { setState(await api.op(body)); say(""); loadCounts(); return true; }
    catch (e) { say(e.message, "bad"); load(); return false; }
  };

  const browse = async () => {
    say("Loading models...");
    try { const m = await api.models(); setList(m); say(m.length + " models. Tap + on the ones you want."); }
    catch (e) { say(e.message, "bad"); }
  };

  const shown = useMemo(() => (list || []).filter((m) => !q || (m.id + " " + m.name).toLowerCase().includes(q.toLowerCase())), [list, q]);
  const have = new Set(state.models.map((m) => m.name));
  const addKey = async () => { if (await op({ op: "add_key", label, key })) setKey(""); };
  const addTyped = async () => { if (typed.trim() && (await op({ op: "add_model", name: typed.trim() }))) setTyped(""); };

  return (
    <div className="card">
      <p className="muted small" style={{ margin: "0 0 14px" }}>{intro}</p>
      <Segmented label="Keys or models" value={pane} onChange={setPane} options={[
        { value: "keys", label: "Keys", count: state.keys.length },
        { value: "models", label: "Models", count: state.models.length },
      ]} />

      {pane === "keys" ? (
        <div>
          <div className="row">
            <input id={id + "-label"} className="fld" style={{ flex: "0 1 130px" }} placeholder="Label" value={label} onChange={(e) => setLabel(e.target.value)} />
            <SearchBar id={id + "-key"} icon="keys" type="password" placeholder={keyHint} autoComplete="off" value={key}
              onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addKey(); }} className="grow">
              <IconButton id={id + "-add-key"} icon="plus" label="Add key" variant="solid" onClick={addKey} />
            </SearchBar>
          </div>
          <div className="stack list">
            {state.keys.map((k) => (
              <KeyRow key={k.id} enabled={k.enabled} onToggle={() => op({ op: "toggle_key", id: k.id })}
                lead={<span className={"ic " + (k.enabled ? "ok" : "lock")}><Icon name={k.enabled ? "check" : "lock"} size={18} /></span>}
                title={k.label} sub={"...." + k.tail + (k.cooling.length ? " · cooling" : "")}
                note={(k.enabled ? "Used in rotation." : "Switched off, or rejected by " + title + ".") + (k.cooling.length ? " Cooling down for: " + k.cooling.join(", ") + "." : "")}
                actions={[{ key: "del", label: "Delete key", icon: "trash", variant: "danger", onClick: () => op({ op: "delete_key", id: k.id }),
                  confirm: { text: "Delete this key?", yes: "Yes, delete" } }]} />
            ))}
            {!state.keys.length ? <p className="empty">No keys yet.</p> : null}
          </div>
        </div>
      ) : (
        <div>
          <div className="row">
            <Button variant="ghost" icon="download" onClick={browse}>{browseLabel}</Button>
          </div>
          <div style={{ marginTop: 10 }}>
            <SearchBar id={id + "-model"} icon="skills" placeholder="Or type a model name" value={typed} onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addTyped(); }}>
              <IconButton icon="plus" label="Add model" variant="solid" onClick={addTyped} />
            </SearchBar>
          </div>
          {list ? (
            <>
              <div style={{ marginTop: 10 }}>
                <SearchBar id={id + "-q"} type="search" placeholder="Filter the list" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              <div className="stack list" style={{ marginTop: 10 }}>
                {shown.slice(0, 200).map((m) => (
                  <div className="dcard" key={m.id}>
                    <div className="dhead">
                      <div className="dmain" style={{ cursor: "default" }}>
                        <span className="tt"><code>{m.id}</code>{m.name !== m.id || m.context ? <small>{m.name !== m.id ? m.name : ""}{m.context ? (m.name !== m.id ? " · " : "") + m.context.toLocaleString() + " tokens" : ""}</small> : null}</span>
                      </div>
                      {have.has(m.id)
                        ? <span className="badge ok">Added</span>
                        : <IconButton icon="plus" label={"Add " + m.id} onClick={() => op({ op: "add_model", name: m.id })} />}
                    </div>
                  </div>
                ))}
                {!shown.length ? <p className="empty">No model matches.</p> : null}
                {shown.length > 200 ? <p className="muted small">Showing the first 200. Filter to narrow it down.</p> : null}
              </div>
            </>
          ) : null}
          <h3 style={{ marginTop: 18 }}>Your models</h3>
          <p className="muted small" style={{ margin: "4px 0 0" }}>Tried in this order. Agents can only use models listed here.</p>
          <div className="stack list" style={{ marginTop: 8 }}>
            {state.models.map((m, i) => (
              <KeyRow key={m.name} enabled={m.enabled} onToggle={() => op({ op: "toggle_model", name: m.name })}
                lead={<span className="ic num">{i + 1}</span>} title={m.name} sub={m.enabled ? "On" : "Off"}
                actions={[
                  { key: "up", label: "Move up", icon: "up", onClick: () => op({ op: "move_model", name: m.name, dir: -1 }) },
                  { key: "down", label: "Move down", icon: "down", onClick: () => op({ op: "move_model", name: m.name, dir: 1 }) },
                  { key: "del", label: "Delete model", icon: "trash", variant: "danger", onClick: () => op({ op: "delete_model", name: m.name }),
                    confirm: { text: "Delete this model?", yes: "Yes, delete" } },
                ]} />
            ))}
            {!state.models.length ? <p className="empty">No models yet. Load the list above or type a name.</p> : null}
          </div>
        </div>
      )}
      <Notice tone={message.tone} id={id + "-msg"}>{message.text}</Notice>
    </div>
  );
}
