import { useCallback, useState } from "react";
import { overview } from "../api/endpoints.js";
import { usePolling } from "./usePolling.js";

const EMPTY = { memories: 0, rules: 0, connections: 0, keys: 0, last_call: "" };

// Counts for the home screen plus the live check of the connector (refreshes every 20 s).
export function useOverview(active) {
  const [counts, setCounts] = useState(EMPTY);
  const [status, setStatus] = useState({ live: null, text: "Checking...", meta: "" });

  const loadCounts = useCallback(() => overview.settings().then(setCounts).catch(() => {}), []);

  const test = useCallback(async () => {
    try {
      const d = await overview.test();
      setStatus({
        live: !!d.live,
        text: d.message ? "Not live: " + d.message : d.live ? "Live" : "Not responding (HTTP " + d.http + ")",
        meta: (d.service ? "Tested via " + d.service + ". " : "") + (d.checked ? "Checked " + d.checked + "." : ""),
      });
    } catch (e) {
      setStatus({ live: false, text: e.message, meta: "" });
    }
  }, []);

  usePolling(() => { loadCounts(); test(); }, 20000, active);
  return { counts, status, loadCounts, test };
}
