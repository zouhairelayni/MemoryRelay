import { useState } from "react";
import { useApp } from "../../shell/AppContext.js";
import { services as servicesApi, skills as skillsApi } from "../../api/endpoints.js";
import { usePolling } from "../../hooks/usePolling.js";
import { useCountUp } from "../../hooks/useCountUp.js";
import { useInstallPrompt } from "../../hooks/useInstallPrompt.js";
import { cableColor } from "../../lib/cable.js";
import { copyText } from "../../lib/clipboard.js";
import Icon from "../../components/Icon.jsx";
import IconButton from "../../components/IconButton.jsx";
import Button from "../../components/Button.jsx";

// Live: what is happening now (status, agents) and what needs you. One orchestrated entrance, then calm.
export default function HomeScreen({ active }) {
  const { counts, status, test, go } = useApp();
  const install = useInstallPrompt();
  const [agents, setAgents] = useState(null);
  const [skillInfo, setSkillInfo] = useState({ total: 0, pending: 0 });
  const [copied, setCopied] = useState(false);

  usePolling(() => {
    servicesApi.list().then(setAgents).catch(() => {});
    skillsApi.list().then((d) => { const l = d.skills || []; setSkillInfo({ total: l.length, pending: l.filter((s) => s.pending).length }); }).catch(() => {});
  }, 20000, active);

  const memories = useCountUp(counts.memories), rules = useCountUp(counts.rules), skillsN = useCountUp(skillInfo.total), keysN = useCountUp(counts.keys);
  const live = status.live;
  const tone = live === null ? "idle" : live ? "" : "bad";
  const title = live === null ? "Checking" : live ? "Connected" : "Not responding";
  const connected = (agents || []).filter((a) => !a.revoked);

  const attention = [];
  if (live === false) attention.push({ key: "live", bad: true, icon: "x", text: "The connector is not answering", hint: status.text, onClick: test });
  if (agents && !connected.length) attention.push({ key: "agents", icon: "agents", text: "Connect your first agent", hint: "Create a connection or sign in with OAuth", onClick: () => go("agents") });
  if (!counts.keys) attention.push({ key: "keys", icon: "keys", text: "Add an AI key", hint: "Skill picks, Skill Studio and sub-agents need one", onClick: () => go("keys") });
  if (skillInfo.pending) attention.push({ key: "skills", icon: "skills", text: skillInfo.pending + (skillInfo.pending === 1 ? " skill waits" : " skills wait") + " for your review", hint: "An agent uploaded it", onClick: () => go("skills") });

  const copyAddress = async () => { setCopied(await copyText(window.location.origin + "/mcp")); setTimeout(() => setCopied(false), 1800); };
  let i = 0;
  const step = () => ({ "--i": i++ });

  return (
    <div className="screen enter">
      <section className="status" style={step()}>
        <div className={"ring " + tone} aria-hidden="true">
          <svg viewBox="0 0 64 64"><circle className="ring-bg" cx="32" cy="32" r="28" /><circle className="ring-fg" cx="32" cy="32" r="28" /></svg>
          <span className="mark"><Icon name={live === false ? "x" : "check"} size={28} /></span>
        </div>
        <div className="grow">
          <div className="status-t" id="status-text">{title}</div>
          <div className="status-s">
            {connected.length ? connected.length + (connected.length === 1 ? " agent" : " agents") : "No agents yet"}
            {counts.last_call ? ", last request " + counts.last_call : ""}
          </div>
          <div className="status-acts">
            <IconButton icon="refresh" label="Test the connection now" onClick={test} />
            <IconButton icon={copied ? "check" : "link"} label={copied ? "Copied" : "Copy the OAuth address"} variant={copied ? "on" : ""} onClick={copyAddress} />
          </div>
        </div>
      </section>

      {attention.length ? (
        <section style={step()}>
          <h3 className="section-title">Needs you</h3>
          <div className="stack list" style={{ marginTop: 8 }}>
            {attention.map((a) => (
              <button key={a.key} type="button" className={"attn" + (a.bad ? " bad" : "")} onClick={a.onClick}>
                <span className="chip"><Icon name={a.icon} size={18} /></span>
                <span className="tt"><b>{a.text}</b><small>{a.hint}</small></span>
                <Icon name="chev" className="chev-r" />
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section style={step()}>
        <h3 className="section-title">Agents</h3>
        <div className="stack list" style={{ marginTop: 8 }}>
          {agents === null ? [0, 1].map((k) => <div className="skel" key={k} />) : null}
          {connected.slice(0, 4).map((a) => (
            <button key={a.id} type="button" className="agent-row" style={{ "--cable": cableColor(a.name) }} onClick={() => go("agents")}>
              <i className="cd" />
              <span className="tt"><b>{a.name}</b><small>{a.last ? "Last used " + a.last : "Not used yet"}</small></span>
              <span className="rwd" aria-label={a.n_read + " reads, " + a.n_write + " writes, " + a.n_delete + " deletes"}>
                <span><Icon name="eye" size={14} />{a.n_read}</span>
                <span><Icon name="pencil" size={14} />{a.n_write}</span>
                <span><Icon name="trash" size={14} />{a.n_delete}</span>
              </span>
              <Icon name="chev" className="chev-r" />
            </button>
          ))}
          {agents && !connected.length ? <p className="empty">Nothing is connected yet.</p> : null}
          {connected.length > 4 ? (
            <button type="button" className="lib-row" onClick={() => go("agents")}>
              <span className="tt"><b>{connected.length - 4} more</b></span><Icon name="chev" className="chev-r" />
            </button>
          ) : null}
        </div>
      </section>

      <section style={step()}>
        <h3 className="section-title">Library</h3>
        <div className="stack list" style={{ marginTop: 8 }}>
          {[
            { to: "memory", icon: "memory", label: "Memories", n: memories, key: "memories" },
            { to: "memory", icon: "lock", label: "Rules", n: rules, key: "rules" },
            { to: "skills", icon: "skills", label: "Skills", n: skillsN, key: "skills" },
            { to: "keys", icon: "keys", label: "AI keys", n: keysN, key: "keys" },
          ].map((r) => (
            <button key={r.label} type="button" className="lib-row" onClick={() => go(r.to)}>
              <span className="chip"><Icon name={r.icon} size={18} /></span>
              <span className="tt"><b>{r.label}</b></span>
              <span className="lib-n" data-stat={r.key}>{r.n}</span>
              <Icon name="chev" className="chev-r" />
            </button>
          ))}
        </div>
      </section>

      {install.canInstall ? (
        <section className="card tip" style={step()}>
          <div className="tip-t"><span className="chip"><Icon name="phone" size={18} /></span> Install Memory Relay</div>
          <p className="muted small">Add it to your home screen so it opens like an app.</p>
          <Button small onClick={install.install}>Install app</Button>
        </section>
      ) : null}
    </div>
  );
}
