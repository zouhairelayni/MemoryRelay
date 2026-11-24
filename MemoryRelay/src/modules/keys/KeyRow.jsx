import { useState } from "react";
import Collapse from "../../components/Collapse.jsx";
import Icon from "../../components/Icon.jsx";
import Switch from "../../components/Switch.jsx";
import ActionRow from "../../components/ActionRow.jsx";
import Button from "../../components/Button.jsx";

// A rotating item (a key or a model): header with a switch, drawer with the details and actions.
// lead: React node for the round icon. title/sub: text. actions: for ActionRow.
// onEdit({ label, key }) (keys only): shows an Edit form to rename the key or paste a replacement. Resolves true when saved.
export default function KeyRow({ lead, title, sub, enabled, onToggle, note, actions, onEdit }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(title);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { if (await onEdit({ label: label.trim() === title ? "" : label.trim(), key: key.trim() })) { setEditing(false); setKey(""); } }
    finally { setBusy(false); }
  };
  return (
    <div className={"dcard" + (open ? " open" : "")}>
      <div className="dhead">
        <button type="button" className="dmain" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {lead}
          <span className="tt"><code>{title}</code><small>{sub}</small></span>
          <span className="chev"><Icon name="chev" size={18} /></span>
        </button>
        <Switch checked={enabled} onChange={onToggle} title="Enable or disable" />
      </div>
      <Collapse open={open}>
        <div className="pad">
          {note ? <p className="small muted" style={{ margin: 0 }}>{note}</p> : null}
          <ActionRow actions={onEdit ? [{ key: "edit", label: "Edit key", icon: "pencil", onClick: () => { setLabel(title); setKey(""); setEditing((e) => !e); }, on: editing }, ...actions] : actions} className="row" />
          {onEdit && editing ? (
            <div className="stack" style={{ gap: 8, marginTop: 10 }}>
              <input className="fld" aria-label="Key label" placeholder="Label" maxLength={40} value={label} onChange={(e) => setLabel(e.target.value)} />
              <input className="fld" aria-label="New API key" type="password" autoComplete="off" placeholder="Paste a new key to replace this one (optional)" value={key} onChange={(e) => setKey(e.target.value)} />
              <p className="small muted" style={{ margin: 0 }}>Leave the key empty to only rename. A replaced key is switched back on and its cooldowns are cleared.</p>
              <div className="row"><Button small disabled={busy || (!key.trim() && (!label.trim() || label.trim() === title))} onClick={save}>{busy ? "Saving…" : "Save"}</Button><Button small variant="ghost" onClick={() => { setEditing(false); setKey(""); }}>Cancel</Button></div>
            </div>
          ) : null}
        </div>
      </Collapse>
    </div>
  );
}
