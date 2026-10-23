import { useCallback, useEffect, useMemo, useState } from "react";
import { useApp } from "../../shell/AppContext.js";
import { useMemories } from "../../hooks/useMemories.js";
import { hasRule } from "../../lib/format.js";
import Button from "../../components/Button.jsx";
import Collapse from "../../components/Collapse.jsx";
import Segmented from "../../components/Segmented.jsx";
import MemoryCard from "./MemoryCard.jsx";
import MemoryEditor from "./MemoryEditor.jsx";
import Housekeeping from "./Housekeeping.jsx";

export default function MemoryScreen({ active }) {
  const { loadCounts } = useApp();
  const mem = useMemories({ onChange: loadCounts });
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  // keep the editor mounted while the drawer animates shut
  const [editorShown, setEditorShown] = useState(false);
  useEffect(() => {
    if (adding) { setEditorShown(true); return undefined; }
    const t = setTimeout(() => setEditorShown(false), 500);
    return () => clearTimeout(t);
  }, [adding]);

  // load when the tab becomes visible, and again after a pause in typing
  useEffect(() => { if (active) mem.load(q); }, [active]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = setTimeout(() => mem.load(q), 250);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = useMemo(
    () => mem.items.filter((m) => filter === "all" || (filter === "rules") === hasRule(m.tags)),
    [mem.items, filter]
  );
  const reload = useCallback(() => mem.load(q), [mem, q]);

  const saveNew = async (body) => { await mem.add(body, q); setAdding(false); };
  const saveEdit = async (id, body) => { await mem.edit(id, body, q); setEditing(null); };

  return (
    <div className="screen">
      <div className="head">
        <div className="eyebrow">Memory</div>
        <h2>Shared memory</h2>
        <p className="lede">What your agents know. Rules are protected: only you can change or delete them.</p>
      </div>

      <div className="toolbar">
        <input id="q" className="fld" type="search" placeholder="Search memories" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button id="add-open" icon="plus" onClick={() => setAdding((a) => !a)}>{adding ? "Close" : "Add"}</Button>
      </div>

      <Collapse open={adding}>
        <div className="card" id="add-box">
          {editorShown ? (
            <MemoryEditor idPrefix="add" autoFocus={adding} saveLabel="Save memory" initial={{ text: "", tags: "", rule: false }}
              onSave={saveNew} onCancel={() => setAdding(false)} />
          ) : null}
        </div>
      </Collapse>

      <div className="filter">
        <Segmented label="Filter" value={filter} onChange={setFilter} options={[
          { value: "all", label: "All" }, { value: "rules", label: "Rules" }, { value: "memories", label: "Memories" },
        ]} />
        <span className="muted small" id="count">
          {filter === "all" ? mem.items.length + " memories" : list.length + " of " + mem.items.length + " memories"}
        </span>
      </div>

      <div id="items" className="stack">
        {mem.error ? <p className="notice small bad">{mem.error}</p> : null}
        {list.map((m) => (
          <MemoryCard key={m.id} m={m} editing={editing === m.id}
            onEdit={setEditing} onCancel={() => setEditing(null)} onSave={saveEdit} onDelete={(id) => mem.remove(id, q)} />
        ))}
        {!list.length && mem.loaded && !mem.error ? <p className="empty">Nothing to show here.</p> : null}
      </div>

      <Housekeeping onApplied={reload} onUsedGemini={loadCounts} />
    </div>
  );
}
