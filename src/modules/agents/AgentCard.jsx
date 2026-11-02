import {useState} from "react";
import Badge from "../../components/Badge.jsx";
import Collapse from "../../components/Collapse.jsx";
import Icon from "../../components/Icon.jsx";
import Brand from "../../components/Brand.jsx";
import IconButton from "../../components/IconButton.jsx";
import ActionRow from "../../components/ActionRow.jsx";
import AccessPicker from "../../components/AccessPicker.jsx";
import { fmtBytes } from "../../lib/format.js";
import { cableColor } from "../../lib/cable.js";

// One connection: who it is, what it did, what it may do, and its few actions.
export default function AgentCard({ s, open, onToggle, onCopy, onRevoke, onDelete, onAccess, onSignOut, onRename }) {
  const [draft,setDraft]=useState(s.name);
  const actions = s.revoked
    ? [{ key: "delete", label: "Delete connection", icon: "trash", variant: "danger", onClick: onDelete,
        confirm: { text: "Delete this connection for good?", yes: "Yes, delete" } }]
    : [
        { key: "copy", label: "Copy secret address", icon: "copy", onClick: onCopy },
        ...(s.sessions ? [{ key: "out", label: "Sign out OAuth sessions (" + s.sessions + ")", icon: "signout", onClick: onSignOut,
          confirm: { text: "Sign out " + s.sessions + " OAuth session" + (s.sessions > 1 ? "s" : "") + "?", yes: "Yes, sign out" } }] : []),
        { key: "revoke", label: "Revoke connection", icon: "ban", variant: "danger", onClick: onRevoke,
          confirm: { text: "Revoke " + s.name + "? Its address and sign-ins stop working.", yes: "Yes, revoke" } },
      ];

  return (
    <article className={"dcard conn" + (s.revoked ? " off" : "") + (open ? " open" : "")}>
      <div className="cpad">
        <div className="chead">
          <Brand names={[s.name, s.app]} size={46} cable={cableColor(s.name)} />
          <div className="grow">
            <h3>{s.name}</h3>
            <div className="sub">{s.sessions ? s.sessions + " signed in with OAuth" : s.app || "No app reported yet"}</div>
          </div>
          <Badge tone={s.revoked ? "bad" : "ok"}>{s.revoked ? "Revoked" : "Active"}</Badge>
        </div>
        <div className="metrics">
          <div className="metric"><b>{s.n_read}</b><span><Icon name="eye" size={14} />Reads</span></div>
          <div className="metric"><b>{s.n_write}</b><span><Icon name="pencil" size={14} />Writes</span></div>
          <div className="metric"><b>{s.n_delete}</b><span><Icon name="trash" size={14} />Deletes</span></div>
        </div>
        {!s.revoked ? <AccessPicker value={s.access} onChange={onAccess} /> : null}
      </div>
      <Collapse open={open}>
        <div className="pad">
          <dl className="kv">
            <dt>Name</dt><dd><form onSubmit={e=>{e.preventDefault();if(draft.trim()!==s.name)onRename(draft.trim());}} style={{display:'flex',gap:6}}><input className="fld" aria-label="Connection name" maxLength={60} value={draft} onChange={e=>setDraft(e.target.value)} /><button className="fld" type="submit" disabled={!draft.trim()||draft.trim()===s.name}>Save</button></form></dd>
            <dt>ID</dt><dd className="mono">{s.id}</dd>
            <dt>Requests</dt><dd>{s.requests}</dd>
            <dt>Data in</dt><dd>{fmtBytes(s.bytes_in)}</dd>
            <dt>Data out</dt><dd>{fmtBytes(s.bytes_out)}</dd>
            <dt>Last used</dt><dd>{s.last || "Never used"}</dd>
            <dt>Created</dt><dd>{s.created}</dd>
          </dl>
        </div>
      </Collapse>
      <div className="conn-foot">
        <ActionRow actions={actions} className="acts" />
        <IconButton icon="chev" label={open ? "Hide details" : "Show details"} className="chev-btn" aria-expanded={open} onClick={onToggle} />
      </div>
    </article>
  );
}
