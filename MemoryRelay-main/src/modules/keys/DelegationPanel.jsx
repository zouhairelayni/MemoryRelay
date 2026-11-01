import { useCallback, useEffect, useState } from "react";
import { delegation } from "../../api/endpoints.js";
import Badge from "../../components/Badge.jsx";
import Icon from "../../components/Icon.jsx";
import Notice from "../../components/Notice.jsx";
import Segmented from "../../components/Segmented.jsx";
import Switch from "../../components/Switch.jsx";
import ActionRow from "../../components/ActionRow.jsx";
import Button from "../../components/Button.jsx";
import Collapse from "../../components/Collapse.jsx";
import IconButton from "../../components/IconButton.jsx";
import { copyText } from "../../lib/clipboard.js";

// Sub-agents: agents hand self-contained jobs to the models you added below. This card is the control room.
const KINDS = ["snippet", "function", "feature", "tests", "refactor", "review", "debug", "explain"];

export default function DelegationPanel({ active }) {
  const [d, setD] = useState(null);
  const [view, setView] = useState("");            // "" | "try" | "guide"
  const [guide, setGuide] = useState("");
  const [copied, setCopied] = useState(false);
  const [job, setJob] = useState({ kind: "function", task: "", acceptance: "", verify: false });
  const [run, setRun] = useState({ busy: false, text: "", bad: false });
  const [message, setMessage] = useState({ text: "", tone: "muted" });
  const say = (text, tone = "muted") => setMessage({ text, tone });

  const load = useCallback(() => delegation.get().then(setD).catch((e) => say(e.message, "bad")), []);
  useEffect(() => { if (active) load(); }, [active, load]);

  const save = async (patch) => {
    try { setD(await delegation.save(patch)); say(""); } catch (e) { say(e.message, "bad"); load(); }
  };
  const openView = (v) => {
    const next = view === v ? "" : v;
    setView(next);
    if (next === "guide" && !guide) delegation.guide().then(setGuide).catch((e) => say(e.message, "bad"));
  };
  const copyGuide = async () => { setCopied(await copyText(guide)); setTimeout(() => setCopied(false), 1800); };
  const runJob = async () => {
    setRun({ busy: true, text: "", bad: false });
    try { const r = await delegation.tryIt({ ...job, verify: job.verify || undefined }); setRun({ busy: false, text: r.text, bad: false }); load(); }
    catch (e) { setRun({ busy: false, text: e.message, bad: true }); }
  };

  if (!d) return <div className="card"><p className="muted small" style={{ margin: 0 }}>Loading sub-agents...</p></div>;

  const others = d.providers.filter((p) => !d.order.includes(p.id));
  const rows = [...d.order.map((id) => d.providers.find((p) => p.id === id)).filter(Boolean), ...others];
  const move = (id, dir) => {
    const o = [...d.order], i = o.indexOf(id), j = i + dir;
    if (i < 0 || j < 0 || j >= o.length) return;
    [o[i], o[j]] = [o[j], o[i]];
    save({ order: o });
  };
  const toggleIn = (id, on) => save({ order: on ? [...d.order, id] : d.order.filter((x) => x !== id) });
  const failed = d.usage.failed;

  return (
    <div className="card" id="delegation">
      <div className="chead">
        <span className="chip brass"><Icon name="bolt" size={19} /></span>
        <div className="grow"><h3>Sub-agents</h3><div className="sub">Agents hand jobs to your other models and save their own usage</div></div>
        <Switch checked={d.enabled} onChange={(v) => save({ enabled: v })} title="Allow sub-agent requests" id="dg-on" />
      </div>
      <p className="muted small" style={{ margin: "12px 0 0" }}>
        A connection with Read and write access can send one self-contained job (up to {d.max_in_tokens.toLocaleString()} tokens) with the <code>delegate</code> tool.
        The job runs on the first provider that answers, and only the result goes back. Requests that contain keys or passwords are refused.
      </p>

      <div className="filter" style={{ marginTop: 14 }}>
        <Segmented label="Routing" value={d.strategy} onChange={(v) => save({ strategy: v })} options={[
          { value: "spread", label: "Spread" }, { value: "order", label: "In order" },
        ]} />
        <label className="count-pill" htmlFor="dg-hour" title="Sub-agent calls per connection per hour">
          Max / hour <input id="dg-hour" className="mini" type="number" min="1" max="500" defaultValue={d.per_hour} key={d.per_hour}
            onBlur={(e) => { const n = Number(e.target.value); if (n !== d.per_hour) save({ per_hour: n }); }} />
        </label>
      </div>
      <p className="muted small" style={{ margin: "8px 0 0" }}>
        {d.strategy === "spread" ? "Spread: each request starts at the next provider below, so no single free limit is used up." : "In order: always the first provider that works; the next ones are backups."}
      </p>

      <div className="stack list" style={{ marginTop: 12 }}>
        {rows.map((p) => {
          const on = d.order.includes(p.id), ready = p.keys > 0 && p.models > 0;
          const pos = d.order.indexOf(p.id);
          return (
            <div className="dcard" key={p.id}>
              <div className="dhead">
                <div className="dmain" style={{ cursor: "default" }}>
                  <span className={"ic " + (on && ready ? "ok" : "lock")}>{on ? <span className="num-i">{pos + 1}</span> : <Icon name="lock" size={18} />}</span>
                  <span className="tt">
                    <b>{p.title}</b>
                    <small>{p.keys} key{p.keys === 1 ? "" : "s"}, {p.models} model{p.models === 1 ? "" : "s"}{!ready ? ". Add a key and a model." : ""}{p.paid ? " Paid." : ""}</small>
                  </span>
                </div>
                {on ? <ActionRow className="acts" actions={[
                  { key: "up", label: "Earlier", icon: "up", disabled: pos === 0, onClick: () => move(p.id, -1) },
                  { key: "down", label: "Later", icon: "down", disabled: pos === d.order.length - 1, onClick: () => move(p.id, 1) },
                ]} /> : null}
                <Switch checked={on} onChange={(v) => toggleIn(p.id, v)} disabled={on && d.order.length === 1}
                  title={on ? "Used for automatic routing" : p.paid ? "Paid: only used when you switch it on, or when an agent asks for it by name" : "Switch on for automatic routing"} />
              </div>
            </div>
          );
        })}
      </div>
      <p className="muted small" style={{ margin: "8px 0 0" }}>OpenAI is paid. It is used only if you switch it on here, or when an agent names it. Agents can only use models you added.</p>

      <div className="chead" style={{ marginTop: 18 }}>
        <span className="chip"><Icon name="clock" size={18} /></span>
        <div className="grow"><h3 style={{ fontSize: 16 }}>Last 24 hours</h3>
          <div className="sub">{d.usage.calls} call{d.usage.calls === 1 ? "" : "s"}{failed ? ", " + failed + " failed" : ""}</div></div>
      </div>
      {d.usage.by_provider.length ? (
        <div className="cluster" style={{ marginTop: 10 }}>
          {d.usage.by_provider.map((u) => (
            <span className="count-pill" key={u.provider} title={"~" + (u.tokens_in || 0) + " tokens in, ~" + (u.tokens_out || 0) + " out"}>{u.provider}: {u.calls}</span>
          ))}
        </div>
      ) : null}
      {d.recent.length ? (
        <div className="stack list" style={{ marginTop: 10 }}>
          {d.recent.map((r) => (
            <div className="suggest" key={r.id}>
              <b>{r.agent || "connection"}, {r.kind || "job"} <Badge tone={r.ok ? "ok" : "bad"}>{r.ok ? "Done" : "Failed"}</Badge></b>
              <small>{r.ok ? r.provider + " / " + r.model + ", about " + r.tokens_in + " tokens in and " + r.tokens_out + " out, " + Math.round(r.ms / 100) / 10 + "s" : r.error}</small>
            </div>
          ))}
        </div>
      ) : <p className="empty">No sub-agent calls yet.</p>}
      <div className="cluster" style={{ marginTop: 14 }}>
        <Button variant={view === "try" ? "solid" : "ghost"} icon="bolt" onClick={() => openView("try")}>Try it</Button>
        <Button variant={view === "guide" ? "solid" : "ghost"} icon="skills" onClick={() => openView("guide")}>Instructions for agents</Button>
      </div>

      <Collapse open={view === "try"}>
        <div className="stack" style={{ marginTop: 12 }}>
          <p className="muted small" style={{ margin: 0 }}>Runs the same pipeline an agent uses: the brief, the quality rules, the automatic checks and, for features, the independent review.</p>
          <div className="cluster">
            {KINDS.map((k) => <button key={k} type="button" className={"count-pill kind" + (job.kind === k ? " on" : "")} aria-pressed={job.kind === k} onClick={() => setJob({ ...job, kind: k })}>{k}</button>)}
          </div>
          <textarea className="fld" style={{ minHeight: 84 }} placeholder="Task: what must exist when it is done" value={job.task} onChange={(e) => setJob({ ...job, task: e.target.value })} />
          <textarea className="fld" style={{ minHeight: 60 }} placeholder="Acceptance: how you will check it (examples, tests)" value={job.acceptance} onChange={(e) => setJob({ ...job, acceptance: e.target.value })} />
          <div className="row">
            <Switch checked={job.verify} onChange={(v) => setJob({ ...job, verify: v })}>Independent review</Switch>
            <Button id="dg-run" onClick={runJob} disabled={run.busy || job.task.trim().length < 8}>{run.busy ? "Working..." : "Run"}</Button>
          </div>
          {run.text ? <pre className={"codebox" + (run.bad ? " bad" : "")}>{run.text}</pre> : null}
        </div>
      </Collapse>

      <Collapse open={view === "guide"}>
        <div className="stack" style={{ marginTop: 12 }}>
          <p className="muted small" style={{ margin: 0 }}>Agents get this from the <code>get_delegation_brief</code> tool and from the built-in skill <code>delegating-to-subagents</code>. Paste it into an agent's own instructions (for example a project's CLAUDE.md) so it delegates well from the first message.</p>
          <div className="row"><IconButton icon={copied ? "check" : "copy"} label={copied ? "Copied" : "Copy the instructions"} variant={copied ? "on" : ""} onClick={copyGuide} disabled={!guide} /></div>
          <pre className="codebox">{guide || "Loading..."}</pre>
        </div>
      </Collapse>
      <Notice tone={message.tone}>{message.text}</Notice>
    </div>
  );
}
