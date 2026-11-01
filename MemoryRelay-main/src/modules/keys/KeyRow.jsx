import { useState } from "react";
import Collapse from "../../components/Collapse.jsx";
import Icon from "../../components/Icon.jsx";
import Switch from "../../components/Switch.jsx";
import ActionRow from "../../components/ActionRow.jsx";

// A rotating item (a key or a model): header with a switch, drawer with the details and actions.
// lead: React node for the round icon. title/sub: text. actions: for ActionRow.
export default function KeyRow({ lead, title, sub, enabled, onToggle, note, actions }) {
  const [open, setOpen] = useState(false);
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
          <ActionRow actions={actions} className="row" />
        </div>
      </Collapse>
    </div>
  );
}
