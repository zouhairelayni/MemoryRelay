import { useCallback, useEffect, useState } from "react";
import { useApp } from "../../shell/AppContext.js";
import { useServices } from "../../hooks/useServices.js";
import { usePolling } from "../../hooks/usePolling.js";
import { useSwipeDeck } from "../../hooks/useSwipeDeck.js";
import Button from "../../components/Button.jsx";
import Notice from "../../components/Notice.jsx";
import AgentCard from "./AgentCard.jsx";

export default function AgentsScreen({ active }) {
  const { loadCounts, test } = useApp();
  const refreshAll = useCallback(() => { loadCounts(); test(); }, [loadCounts, test]);
  const svc = useServices({ onChange: refreshAll });
  const { items, focusId } = svc;

  const [idx, setIdx] = useState(0);
  const [open, setOpen] = useState({});
  const [name, setName] = useState("");

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

  const add = async () => { if (await svc.create(name)) setName(""); };

  return (
    <div className="screen">
      <div className="head">
        <div className="eyebrow">Agents</div>
        <h2>Connections</h2>
        <p className="lede">One address per agent. Swipe the cards to see each agent's reads, writes and deletes.</p>
      </div>

      <div className="card">
        <label className="lbl" htmlFor="svc-name">New connection</label>
        <div className="row" style={{ marginTop: 6 }}>
          <input id="svc-name" className="fld grow" placeholder="Agent name, for example Claude Work" value={name}
            onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
          <Button id="svc-add" icon="plus" onClick={add}>Add</Button>
        </div>
        <Notice id="svc-msg">{svc.message}</Notice>
      </div>

      <div id="services" className="agent-card-wrap" tabIndex={0} aria-live="polite"
        data-noswipe={items.length > 1 ? "" : undefined} {...deck.wrapProps}>
        {cur ? (
          <AgentCard key={cur.id} s={cur} open={!!open[cur.id]} onToggle={() => toggle(cur.id)}
            onCopy={() => svc.copyAddress(cur.url)} onRevoke={() => svc.revoke(cur.id)} onDelete={() => svc.remove(cur.id)} />
        ) : (
          <p className="empty">{svc.loaded ? "No connections yet. Add one above." : "Loading..."}</p>
        )}
      </div>

      <div className="agent-dots" id="conn-dots">
        {items.length > 1 ? items.map((c, i) => (
          <button key={c.id} type="button" className={"dot-i" + (i === idx ? " on" : "")} data-go={i}
            aria-label={"Show " + c.name} onClick={() => deck.go(i, i > idx ? 1 : -1)} />
        )) : null}
      </div>
      {items.length > 1 ? <p className="agent-hint" id="conn-hint">Swipe left or right to browse</p> : null}
    </div>
  );
}
