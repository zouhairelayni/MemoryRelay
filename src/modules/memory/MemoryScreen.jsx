import { useCallback, useEffect, useState } from "react";
import { useApp } from "../../shell/AppContext.js";
import { useMemories } from "../../hooks/useMemories.js";
import Collapse from "../../components/Collapse.jsx";
import IconButton from "../../components/IconButton.jsx";
import PageHead from "../../components/PageHead.jsx";
import SearchBar from "../../components/SearchBar.jsx";
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
  useEffect(() => { if (active) mem.load(q, filter); }, [active]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = setTimeout(() => { if (active) mem.load(q, filter); }, 250);
    return () => clearTimeout(t);
  }, [q, filter, active]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = mem.items;
  const reload = useCallback(() => mem.load(q, filter), [mem.load, q, filter]);

  const saveNew = async (body) => { await mem.add(body); setAdding(false); };
  const saveEdit = async (id, body) => { await mem.edit(id, body); setEditing(null); };

  return (
    <div className="screen memory-screen">
      <PageHead icon="memory" title="Memory" sub="What your agents know. Rules are yours alone." />

      <SearchBar id="q" type="search" placeholder="Search memories" value={q} onChange={(e) => setQ(e.target.value)}>
        <IconButton id="add-open" icon={adding ? "x" : "plus"} label={adding ? "Close" : "Add a memory"} variant="solid" size="lg" onClick={() => setAdding((a) => !a)} />
      </SearchBar>

      <Collapse open={adding}>
        <div className="card" id="add-box">
          {editorShown ? (
            <MemoryEditor idPrefix="add" autoFocus={adding} saveLabel="Save memory" initial={{ text: "", tags: "", description: "", metadata: {}, rule: false }}
              onSave={saveNew} onCancel={() => setAdding(false)} />
          ) : null}
        </div>
      </Collapse>

      <div className="filter">
        <Segmented label="Filter" value={filter} onChange={setFilter} options={[
          { value: "all", label: "All" },
          { value: "rules", label: "Rules" },
          { value: "memories", label: "Memories" },
        ]} />
      </div>

      <div className="memory-index-count" role="status">{mem.loaded ? `${mem.total} matching ${filter === "all" ? "entries" : filter} · ${mem.items.length} loaded` : "Searching library…"}</div>
      <div id="items" className={"stack" + (list.length || !mem.loaded ? " list" : "")}>
        {mem.error ? <p className="notice small bad">{mem.error}</p> : null}
        {!mem.loaded && !mem.error ? [0, 1, 2].map((k) => <div className="skel" key={k} />) : null}
        {list.map((m) => (
          <MemoryCard key={m.id} m={m} editing={editing === m.id}
            onEdit={setEditing} onCancel={() => setEditing(null)} onSave={saveEdit} onDelete={(id) => mem.remove(id)} />
        ))}
        {!list.length && mem.loaded && !mem.error ? <p className="empty">Nothing to show here.</p> : null}
      </div>

      {mem.nextOffset !== null ? <button type="button" className="memory-load-more" disabled={mem.busy} onClick={mem.loadMore}>
        {mem.busy ? "Loading…" : `Show more (${mem.total - mem.items.length} remaining)`}
      </button> : null}
      <Housekeeping onApplied={reload} onUsedGemini={loadCounts} />
    </div>
  );
}
