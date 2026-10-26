import { useEffect, useMemo, useState } from "react";
import { useSkills } from "../../hooks/useSkills.js";
import { skills as api } from "../../api/endpoints.js";
import { useApp } from "../../shell/AppContext.js";
import Button from "../../components/Button.jsx";
import IconButton from "../../components/IconButton.jsx";
import SearchBar from "../../components/SearchBar.jsx";
import Badge from "../../components/Badge.jsx";
import Notice from "../../components/Notice.jsx";
import Switch from "../../components/Switch.jsx";
import ActionRow from "../../components/ActionRow.jsx";
import Collapse from "../../components/Collapse.jsx";
import Segmented from "../../components/Segmented.jsx";
import Icon from "../../components/Icon.jsx";
import SkillStudio from "./SkillStudio.jsx";

// The Skill Genie. Agents send their request; the Genie returns only the skills that fit.
export default function SkillSelector({ active }) {
  const { loadCounts } = useApp();
  const sk = useSkills();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [tryText, setTryText] = useState("");
  const [trying, setTrying] = useState(null);
  const [open, setOpen] = useState({});
  const [studio, setStudio] = useState(null);
  const [template, setTemplate] = useState("");
  const [limit, setLimit] = useState(5000);
  useEffect(() => { if (active) api.list().then((d) => { setTemplate(d.template); setLimit(d.max_tokens); }).catch(() => {}); }, [active]);

  useEffect(() => { if (active) sk.load(); }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = useMemo(() => sk.items.filter((s) => {
    if (filter === "on" && !s.enabled) return false;
    if (filter === "off" && s.enabled) return false;
    const hay = (s.name + " " + s.description).toLowerCase();
    return !q || hay.includes(q.toLowerCase());
  }), [sk.items, filter, q]);
  const enabledCount = sk.items.filter((s) => s.enabled).length;
  const pendingCount = sk.items.filter((s) => s.pending).length;

  const readFile = (f) => f.text().then((t) => sk.add(t, "file"));
  const addText = async () => { if (await sk.add(text, "paste")) { setText(""); setAdding(false); } };

  const runTry = async () => {
    setTrying({ busy: true });
    try { setTrying(await api.try(tryText)); }
    catch (e) { setTrying({ error: e.message }); }
    loadCounts();
  };

  return (
    <div className="stack">
      <SearchBar id="sk-q" type="search" placeholder="Search skills" value={q} onChange={(e) => setQ(e.target.value)}>
        <IconButton id="sk-gen" icon="wand" label="Write a skill with AI" size="lg" onClick={() => setStudio({ fresh: true })} />
        <IconButton id="sk-add-open" icon={adding ? "x" : "plus"} label={adding ? "Close" : "Add a skill"} variant="solid" size="lg" onClick={() => setAdding((a) => !a)} />
      </SearchBar>

      <div className="card">
        <Collapse open={adding}>
          {adding ? (
            <div className="editor" style={{ marginTop: 12 }}>
              <textarea id="sk-text" className="fld" style={{ minHeight: 160, fontFamily: "var(--mono)", fontSize: 13 }}
                placeholder={"---\nname: my-skill\ndescription: Use when ...\n---\nInstructions..."} value={text} onChange={(e) => setText(e.target.value)} />
              <p className="muted small" style={{ margin: 0 }}>Max {limit} tokens. Start the description with "Use when ...".</p>
              <div className="row">
                <Button id="sk-save" onClick={addText}>Save skill</Button>
                <Button variant="ghost" id="sk-template" onClick={() => setText(template)}>Use template</Button>
                <label className="fld" style={{ width: "auto", cursor: "pointer", padding: "9px 14px" }}>
                  Choose .md file
                  <input type="file" accept=".md,text/markdown,text/plain" hidden onChange={(e) => e.target.files[0] && readFile(e.target.files[0])} />
                </label>
              </div>
            </div>
          ) : null}
        </Collapse>
        <div className="filter">
          <Segmented label="Filter skills" value={filter} onChange={setFilter} options={[
            { value: "all", label: "All", count: sk.items.length }, { value: "on", label: "On", count: enabledCount },
            { value: "off", label: "Off", count: sk.items.length - enabledCount },
          ]} />
          <div className="cluster">
            {pendingCount ? <Badge tone="rule">{pendingCount} to review</Badge> : null}
            <label className="count-pill" htmlFor="sk-max" title="Skills sent per request">
              Max <input id="sk-max" className="mini" type="number" min="1" max="8" value={sk.max} onChange={(e) => sk.saveMax(e.target.value)} />
            </label>
          </div>
        </div>
        <Notice tone={sk.message.tone} id="sk-msg">{sk.message.text}</Notice>
      </div>

      <div id="sk-list" className="stack list">
        {list.map((s) => {
          const key = s.name, isOpen = !!open[key];
          return (
            <div className={"dcard" + (isOpen ? " open" : "")} key={s.name}>
              <div className="dhead">
                <button type="button" className="dmain" aria-expanded={isOpen} onClick={() => setOpen((o) => ({ ...o, [key]: !o[key] }))}>
                  <span className={"ic " + (s.enabled ? "ok" : "lock")}><Icon name={s.enabled ? "skills" : "lock"} size={18} /></span>
                  <span className="tt"><code>{s.name}</code><small>{s.pending ? "Pending review · " : ""}{s.core ? "Always on · " : ""}{s.tokens} tokens · {s.source}</small></span>
                  <span className="chev"><Icon name="chev" size={18} /></span>
                </button>
                <Switch checked={s.enabled} onChange={(v) => sk.toggle(s.name, "enabled", v)} title={s.pending ? "Approve and enable" : "Enable or disable"} />
              </div>
              <Collapse open={isOpen}>
                <div className="pad">
                  <p className="small" style={{ margin: 0, color: "var(--ink2)" }}>{s.description}</p>
                  {s.warnings && s.warnings.length ? <Notice tone="bad">Check before use: {s.warnings.join("; ")}.</Notice> : null}
                  <ActionRow className="row" actions={[
                    { key: "edit", label: "Edit skill", icon: "pencil", onClick: () => setStudio({ name: s.name }) },
                    { key: "core", label: s.core ? "Stop always sending it" : "Always send it", icon: "bolt", on: s.core,
                      onClick: () => sk.toggle(s.name, "core", !s.core) },
                    { key: "del", label: "Delete skill", icon: "trash", variant: "danger", onClick: () => sk.remove(s.name),
                      confirm: { text: "Delete the skill " + s.name + "?", yes: "Yes, delete" } },
                  ]} />
                </div>
              </Collapse>
            </div>
          );
        })}
        {!list.length && sk.loaded ? <p className="empty">{sk.items.length ? "No skill matches." : "No skills yet. Add one above."}</p> : null}
      </div>

      <div className="card">
        <div className="chead">
          <span className="chip brass"><Icon name="skills" size={19} /></span>
          <div className="grow"><h3>Try it</h3><div className="sub">See which skills an agent would receive for a request</div></div>
        </div>
        <div style={{ marginTop: 12 }}>
          <SearchBar id="sk-try" icon="skills" placeholder="for example: make a remotion video" value={tryText} onChange={(e) => setTryText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && tryText.trim()) runTry(); }}>
            <IconButton id="sk-try-go" icon="up" label="Ask" variant="solid" size="lg" onClick={runTry} disabled={!tryText.trim() || trying?.busy} />
          </SearchBar>
        </div>
        {trying && !trying.busy ? (
          <div className="stack" style={{ marginTop: 12 }}>
            {trying.error ? <Notice tone="bad">{trying.error}</Notice> : null}
            {trying.picks && !trying.picks.length ? <Notice>No skill is needed for that request.</Notice> : null}
            {(trying.picks || []).map((p) => (
              <div className="suggest" key={p.name}><b>{p.name}</b><small>{p.why}</small></div>
            ))}
            {trying.picks ? <p className="muted small" style={{ margin: 0 }}>
              {trying.mode === "ai" ? "Chosen by an AI model" : "Chosen by keywords"}{trying.note ? " · " + trying.note : ""}
            </p> : null}
          </div>
        ) : null}
      </div>
      <SkillStudio target={studio} onClose={() => setStudio(null)}
        onSaved={(m, warn) => { sk.say(m, warn ? "bad" : "ok"); sk.load(); loadCounts(); }} />
    </div>
  );
}
