import { useCallback, useEffect, useState } from "react";
import { useApp } from "../../shell/AppContext.js";
import { useServices } from "../../hooks/useServices.js";
import { usePolling } from "../../hooks/usePolling.js";
import { useSwipeDeck } from "../../hooks/useSwipeDeck.js";
import { copyText } from "../../lib/clipboard.js";
import { cableColor } from "../../lib/cable.js";
import IconButton from "../../components/IconButton.jsx";
import Icon from "../../components/Icon.jsx";
import Notice from "../../components/Notice.jsx";
import PageHead from "../../components/PageHead.jsx";
import SearchBar from "../../components/SearchBar.jsx";
import AccessPicker from "../../components/AccessPicker.jsx";
import AgentCard from "./AgentCard.jsx";

export default function AgentsScreen({ active }) {
  const { loadCounts, test } = useApp();
  const refreshAll = useCallback(() => { loadCounts(); test(); }, [loadCounts, test]);
  const svc = useServices({ onChange: refreshAll });
  const { items, focusId } = svc;

  const [idx, setIdx] = useState(0);
  const [open, setOpen] = useState({});
  const [name, setName] = useState("");
  const [access, setAccess] = useState("write");
  const [copied, setCopied] = useState(false);
  const oauthUrl = window.location.origin + "/mcp";

  usePolling(() => svc.load(), 20000, active);

  // jump to a connection we just added; keep the index valid when the list shrinks
  useEffect(() => {
    if (!focusId) return;
    const k = items.findIndex((c) => c.id === focusId);
    if (k >= 0) setIdx(k);
  }, [focusId, items]);
  useEffect(() => { if (idx >= items.length) setIdx(Math.max(0, items.length - 1)); }, [items.length, idx]);

  const deck = useSwipeDeck({ count: items.length, index: idx, onIndex: setIdx });
  const cur = items[idx];
  const toggle = (id) => setOpen((o) => ({ ...o, [id]: !o[id] }));
  const add = async () => { if (await svc.create(name, access)) setName(""); };
  const copyOauth = async () => { setCopied(await copyText(oauthUrl)); setTimeout(() => setCopied(false), 1800); };

  return (
    <div className="screen">
      <PageHead icon="agents" title="Connections" sub="One connection per agent, each with its own access." />

      <div className="card">
        <SearchBar id="svc-name" icon="agents" placeholder="New connection, for example Claude Work" value={name}
          onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }}>
          <IconButton id="svc-add" icon="plus" label="Add connection" variant="solid" size="lg" onClick={add} />
        </SearchBar>
        <AccessPicker value={access} onChange={setAccess} />
        <Notice id="svc-msg">{svc.message}</Notice>
      </div>

      {items.length ? (
        <div className="cables" id="conn-dots" role="tablist" aria-label="Connections">
          {items.map((c, i) => (
            <button key={c.id} type="button" role="tab" aria-selected={i === idx} className={"cable-chip" + (i === idx ? " on" : "")} data-go={i}
              style={{ "--cable": cableColor(c.name) }} onClick={() => deck.go(i, i > idx ? 1 : -1)}>
              <i className="cd" />{c.name}
            </button>
          ))}
        </div>
      ) : null}

      <div id="services" className="agent-card-wrap" tabIndex={0} aria-live="polite"
        data-noswipe={items.length > 1 ? "" : undefined} {...deck.wrapProps}>
        {cur ? (
          <AgentCard key={cur.id} s={cur} open={!!open[cur.id]} onToggle={() => toggle(cur.id)}
            onCopy={() => svc.copyAddress(cur.url)} onRevoke={() => svc.revoke(cur.id)} onDelete={() => svc.remove(cur.id)}
            onAccess={(a) => svc.setAccess(cur.id, a)} onSignOut={() => svc.signOut(cur.id)} />
        ) : (
          <p className="empty">{svc.loaded ? "No connections yet. Add one above." : "Loading..."}</p>
        )}
      </div>

      {items.length > 1 ? <p className="agent-hint" id="conn-hint">Swipe the card or tap a name to switch</p> : null}

      <div className="card">
        <div className="chead">
          <span className="chip brass"><Icon name="link" size={19} /></span>
          <div className="grow"><h3>Sign in with OAuth</h3><div className="sub">For apps that support it, such as a Claude custom connector</div></div>
        </div>
        <div className="addr">
          <code id="oauth-url">{oauthUrl}</code>
          <IconButton icon={copied ? "check" : "copy"} label={copied ? "Copied" : "Copy address"} variant={copied ? "on" : ""} onClick={copyOauth} />
        </div>
        <ol className="steps">
          <li>Paste this address into the app as a remote MCP server.</li>
          <li>The app opens a page here. Pick a connection (or make a new one) and approve with your password.</li>
          <li>That connection's access level and statistics apply. Revoke it any time to end the sign-in.</li>
        </ol>
      </div>
    </div>
  );
}
