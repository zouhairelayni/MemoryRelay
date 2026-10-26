import Badge from "../../components/Badge.jsx";
import Collapse from "../../components/Collapse.jsx";
import Icon from "../../components/Icon.jsx";
import IconButton from "../../components/IconButton.jsx";
import ActionRow from "../../components/ActionRow.jsx";
import AccessPicker from "../../components/AccessPicker.jsx";
import { fmtBytes, pct } from "../../lib/format.js";

// One connection: who it is, what it did, what it may do, and its few actions.
export default function AgentCard({ s, open, onToggle, onCopy, onRevoke, onDelete, onAccess, onSignOut }) {
  const total = s.n_read + s.n_write + s.n_delete;
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
          <span className={"chip " + (s.revoked ? "lock" : "")}><Icon name="agents" size={19} /></span>
          <div className="grow">
            <h3>{s.name}</h3>
            <div className="sub">{s.app || "No app reported yet"}{s.sessions ? " · " + s.sessions + " signed in" : ""}</div>
          </div>
          <Badge tone={s.revoked ? "bad" : "ok"}>{s.revoked ? "Revoked" : "Active"}</Badge>
        </div>
        <div className="metrics">
          <div className="metric"><Icon name="eye" size={17} /><div><b>{s.n_read}</b><span>Reads</span></div></div>
          <div className="metric"><Icon name="pencil" size={17} /><div><b>{s.n_write}</b><span>Writes</span></div></div>
          <div className="metric"><Icon name="trash" size={17} /><div><b>{s.n_delete}</b><span>Deletes</span></div></div>
        </div>
        <div className="split" aria-hidden="true">
          <i className="r" style={{ width: pct(s.n_read, total) + "%" }} />
          <i className="w" style={{ width: pct(s.n_write, total) + "%" }} />
          <i className="d" style={{ width: pct(s.n_delete, total) + "%" }} />
        </div>
        {!s.revoked ? <AccessPicker value={s.access} onChange={onAccess} /> : null}
      </div>
      <Collapse open={open}>
        <div className="pad">
          <dl className="kv">
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
