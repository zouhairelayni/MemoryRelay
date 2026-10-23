import { useHousekeeping } from "../../hooks/useMemories.js";
import Button from "../../components/Button.jsx";

// Asks Gemini for duplicates, shows only the merged text, then Fix Duplicate / Cancel.
export default function Housekeeping({ onApplied, onUsedGemini }) {
  const hk = useHousekeeping({ onApplied, onUsedGemini });
  return (
    <div className="card">
      <div className="top">
        <h3>Clean up</h3>
      </div>
      <p className="muted small" style={{ margin: "4px 0 0" }}>
        Gemini looks for duplicate memories and suggests one merged text. Rules are never touched.
      </p>
      <div className="row">
        <Button id="check" icon="broom" disabled={hk.phase === "checking" || hk.phase === "applying"} onClick={hk.check}>
          {hk.phase === "checking" ? "Checking..." : "Check duplicates"}
        </Button>
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
              <Button id="hk-fix" onClick={hk.apply}>Fix Duplicate</Button>
              <Button id="hk-cancel" variant="ghost" onClick={hk.cancel}>Cancel</Button>
            </div>
          </>
        ) : null}
        {hk.phase === "done" || hk.phase === "error" ? (
          <p className={"notice small " + (hk.phase === "error" ? "bad" : /^Fixed/.test(hk.text) ? "ok" : "muted")}>{hk.text}</p>
        ) : null}
      </div>
    </div>
  );
}
