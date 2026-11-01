import { useHousekeeping } from "../../hooks/useMemories.js";
import Button from "../../components/Button.jsx";
import Icon from "../../components/Icon.jsx";
import IconButton from "../../components/IconButton.jsx";

// Asks the AI for duplicates, shows only the merged text, then Fix Duplicate / Cancel.
export default function Housekeeping({ onApplied, onUsedGemini }) {
  const hk = useHousekeeping({ onApplied, onUsedGemini });
  const busy = hk.phase === "checking" || hk.phase === "applying";
  return (
    <div className="card">
      <div className="chead">
        <span className="chip brass"><Icon name="broom" size={19} /></span>
        <div className="grow"><h3>Clean up</h3><div className="sub">Finds duplicates and suggests one merged text. Rules are never touched.</div></div>
        <IconButton id="check" icon="search" label={hk.phase === "checking" ? "Checking" : "Check for duplicates"} variant="solid" size="lg" disabled={busy} onClick={hk.check} />
      </div>
      <div id="hk">
        {hk.phase === "proposed" ? (
          <>
            {hk.groups.map((g) => (
              <div className="suggest" key={g.keep}>
                <b>{g.merged_text || g.keep_text}</b>
                <small>Merges {g.drop.length + 1} memories into this one</small>
              </div>
            ))}
            <div className="row">
              <Button id="hk-fix" icon="check" onClick={hk.apply}>Fix duplicates</Button>
              <Button id="hk-cancel" variant="ghost" onClick={hk.cancel}>Cancel</Button>
            </div>
          </>
        ) : null}
        {hk.phase === "checking" ? <p className="notice small muted">Checking...</p> : null}
        {hk.phase === "done" || hk.phase === "error" ? (
          <p className={"notice small " + (hk.phase === "error" ? "bad" : /^Fixed/.test(hk.text) ? "ok" : "muted")}>{hk.text}</p>
        ) : null}
      </div>
    </div>
  );
}
