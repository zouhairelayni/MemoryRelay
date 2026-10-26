import Badge from "../../components/Badge.jsx";
import ActionRow from "../../components/ActionRow.jsx";
import MemoryEditor from "./MemoryEditor.jsx";
import { hasRule, splitTags } from "../../lib/format.js";

export default function MemoryCard({ m, editing, onEdit, onCancel, onSave, onDelete }) {
  const rule = hasRule(m.tags);
  const meta = (
    <div className="meta">
      {rule ? <Badge tone="rule">Rule</Badge> : null}
      {splitTags(m.tags).map((t) => <Badge key={t} tone="tag">{t}</Badge>)}
      <span>{m.time}</span>
      <span className="mono">{m.id}</span>
    </div>
  );

  if (editing) {
    return (
      <div className={"mem" + (rule ? " is-rule" : "")}>
        <MemoryEditor idPrefix="edit" autoFocus saveLabel="Save" initial={{ text: m.text, tags: rule ? "" : m.tags, rule }}
          onSave={(body) => onSave(m.id, body)} onCancel={onCancel} />
        {meta}
      </div>
    );
  }
  return (
    <div className={"mem" + (rule ? " is-rule" : "")}>
      <div className="mt">{m.text}</div>
      <div className="mem-foot">
        {meta}
        <ActionRow className="acts" actions={[
          { key: "edit", label: "Edit memory", icon: "pencil", onClick: () => onEdit(m.id) },
          { key: "del", label: "Delete memory", icon: "trash", variant: "danger", onClick: () => onDelete(m.id),
            confirm: { text: rule ? "Delete this rule?" : "Delete this memory?", yes: "Yes, delete" } },
        ]} />
      </div>
    </div>
  );
}
