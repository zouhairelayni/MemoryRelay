import { useCallback, useEffect, useState } from "react";
import { diagnostics } from "../../api/endpoints.js";
import { useApp } from "../../shell/AppContext.js";
import PageHead from "../../components/PageHead.jsx";
import Button from "../../components/Button.jsx";
import ScreenSkeleton from "../../components/ScreenSkeleton.jsx";

const PERIODS = [["1h", "1h"], ["1d", "24h"], ["7", "7d"], ["30", "30d"], ["90", "90d"]];
export default function ErrorsScreen({ active = true }) {
  const { go } = useApp();
  const [period, setPeriod] = useState("30"), [offset, setOffset] = useState(0), [data, setData] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const load = useCallback(async () => {
    setBusy(true); setError("");
    try { setData(await diagnostics.list({ period, offset, limit: 50 })); }
    catch (e) { setError(e?.message || "Unable to load diagnostic records"); }
    finally { setBusy(false); }
  }, [period, offset]);
  useEffect(() => { if (active) load(); }, [active, load]);
  useEffect(() => { setOffset(0); }, [period]);
  const exportJson = () => {
    if (!data) return;
    const blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), period, offset, total: data.total, diagnostics: data.diagnostics || [] }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = `memoryrelay-errors-${period}-${Date.now()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <div className="screen errors-screen enter"><PageHead title="Errors" sub="Sanitized diagnostics"><Button small variant="ghost" icon="download" disabled={!data?.diagnostics?.length} onClick={exportJson}>Export JSON</Button></PageHead>
    <Button small variant="ghost" icon="arrow-left" onClick={() => go("home")}>Back to overview</Button>
    <div className="monitor-period-row"><span>Time range</span><div className="monitor-period" role="group" aria-label="Error time range">{PERIODS.map(([v, label]) => <button key={v} type="button" className={period === v ? "on" : ""} aria-pressed={period === v} onClick={() => setPeriod(v)}>{label}</button>)}</div></div>
    {error ? <div className="notice bad" role="alert">{error} <Button small variant="ghost" onClick={load}>Retry</Button></div> : null}
    {!data && !error ? <ScreenSkeleton label="Loading diagnostics" /> : null}
    {data ? <section className="card monitor-figure"><div className="monitor-chart-title"><div><h3>{data.total} recorded errors</h3><p className="muted small">Sensitive request payloads are excluded.</p></div></div>
      {(data.diagnostics || []).length ? data.diagnostics.map(d => <article className="job-row" key={d.id}><b>{d.summary || "Recorded failure"}</b><p>{d.action} · {d.category}</p><small className="muted">{new Date(d.ts).toLocaleString()}</small></article>) : <p className="muted small">No errors in this period.</p>}
      <div className="row" style={{ justifyContent: "space-between", marginTop: 12 }}><Button small variant="ghost" disabled={offset <= 0 || busy} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous</Button><span className="muted small">{data.total ? offset + 1 : 0}–{offset + (data.diagnostics || []).length} of {data.total}</span><Button small variant="ghost" disabled={data.next_offset == null || busy} onClick={() => setOffset(data.next_offset)}>Next</Button></div>
    </section> : null}
  </div>;
}
