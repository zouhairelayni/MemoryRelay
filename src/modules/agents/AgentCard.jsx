import Badge from "../../components/Badge.jsx";
import Collapse from "../../components/Collapse.jsx";
import Icon from "../../components/Icon.jsx";
import ActionRow from "../../components/ActionRow.jsx";
import { fmtBytes, pct } from "../../lib/format.js";

// One connection: counters, a split bar and an animated details drawer.
export default function AgentCard({ s, open, onToggle, onCopy, onRevoke, onDelete }) {
  const total = s.n_read + s.n_write + s.n_delete;
  const actions = s.revoked
    ? [{ key: "delete", label: "Delete", icon: "trash", variant: "danger", onClick: onDelete,
        confirm: { text: "Delete this connection for good?", yes: "Yes, delete" } }]
    : [
        { key: "copy", label: "Copy address", icon: "copy", onClick: onCopy },
        { key: "revoke", label: "Revoke", variant: "danger", onClick: onRevoke,
          confirm: { text: "Revoke " + s.name + "? Its address will stop working.", yes: "Yes, revoke" } },
      ];

  return (
    <article className={"dcard conn" + (s.revoked ? " off" : "") + (open ? " open" : "")}>
      <div className="cpad">
        <div className="top">
          <h3>{s.name}</h3>
          <Badge tone={s.revoked ? "bad" : "ok"}>{s.revoked ? "Revoked" : "Active"}</Badge>
        </div>
        <div className="where">MCP ID {s.id}{s.app ? " · " + s.app : ""}</div>
        <div className="triple">
          <div><b>{s.n_read}</b><span>Reads</span></div>
          <div><b>{s.n_write}</b><span>Writes</span></div>
          <div><b>{s.n_delete}</b><span>Deletes</span></div>
        </div>
        <div className="split" aria-hidden="true">
          <i className="r" style={{ width: pct(s.n_read, total) + "%" }} />
          <i className="w" style={{ width: pct(s.n_write, total) + "%" }} />
          <i className="d" style={{ width: pct(s.n_delete, total) + "%" }} />
        </div>
        <div className="legend"><span>Read</span><span className="w">Write</span><span className="d">Delete</span></div>
      </div>
      <button type="button" className="more" aria-expanded={open} onClick={onToggle}>
        <span>Details</span><span className="chev"><Icon name="chev" size={18} /></span>
      </button>
      <Collapse open={open}>
        <div className="pad">
          <dl className="kv">
            <dt>MCP ID</dt><dd className="mono">{s.id}</dd>
            <dt>App</dt><dd>{s.app || "Not reported yet"}</dd>
            <dt>Requests</dt><dd>{s.requests}</dd>
            <dt>Data in</dt><dd>{fmtBytes(s.bytes_in)}</dd>
            <dt>Data out</dt><dd>{fmtBytes(s.bytes_out)}</dd>
            <dt>Last used</dt><dd>{s.last || "Never used"}</dd>
            <dt>Created</dt><dd>{s.created}</dd>
          </dl>
        </div>
      </Collapse>
      <ActionRow actions={actions} className="acts" />
    </article>
  );
}
