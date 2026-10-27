import { useState } from "react";
import ActionRow from "../../components/ActionRow.jsx";
import Collapse from "../../components/Collapse.jsx";
import Icon from "../../components/Icon.jsx";
import MemoryEditor from "./MemoryEditor.jsx";
import { hasRule, splitTags } from "../../lib/format.js";
import { sourceInfo } from "../../lib/cable.js";

// One memory is one row. Tap it to read all of it and to reveal edit and delete (progressive disclosure: no buttons until needed).
// The thin bar on the left is the colour of the agent that wrote it; rules are amber.
export default function MemoryCard({ m, editing, onEdit, onCancel, onSave, onDelete }) {
  const [open, setOpen] = useState(false);
  const rule = hasRule(m.tags);
  const src = sourceInfo(m.source);
  const tags = splitTags(m.tags).filter((t) => t !== "rules");

  if (editing) {
    return (
      <div className={"mem open" + (rule ? " is-rule" : "")}>
        <div className="pad">
          <MemoryEditor idPrefix="edit" autoFocus saveLabel="Save" initial={{ text: m.text, tags: rule ? "" : m.tags, rule }}
            onSave={(body) => onSave(m.id, body)} onCancel={onCancel} />
        </div>
      </div>
    );
  }
  return (
    <div className={"mem" + (open ? " open" : "") + (rule ? " is-rule" : "")} style={{ "--cable": src.agent ? src.color : "transparent" }}>
      <button type="button" className="mem-main" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="mt">{m.text}</span>
        <span className="meta">
          {rule ? <span className="tag-rule"><Icon name="lock" size={13} />Rule</span> : <span className="src"><i className="cd" style={{ "--cable": src.color }} />{src.name}</span>}
          {tags.map((t) => <span key={t}>#{t}</span>)}
          <span>{m.time}</span>
        </span>
      </button>
      <Collapse open={open}>
        <div className="mem-acts">
          <span className="id mono">{m.id}</span>
          <ActionRow className="acts" actions={[
            { key: "edit", label: "Edit memory", icon: "pencil", onClick: () => onEdit(m.id) },
            { key: "del", label: "Delete memory", icon: "trash", variant: "danger", onClick: () => onDelete(m.id),
              confirm: { text: rule ? "Delete this rule?" : "Delete this memory?", yes: "Yes, delete" } },
          ]} />
        </div>
      </Collapse>
    </div>
  );
}
