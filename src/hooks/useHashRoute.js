import { useCallback, useEffect, useState } from "react";

const read = (valid, fallback) => {
  const id = window.location.hash.replace(/^#\/?/, "");
  return valid.includes(id) ? id : fallback;
};

// The current screen lives in the URL hash (#/agents), so the Android back button works
// and a refresh keeps you where you were.
export function useHashRoute(valid, fallback) {
  const [route, setRoute] = useState(() => read(valid, fallback));

  useEffect(() => {
    const onHash = () => setRoute(read(valid, fallback));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [valid, fallback]);

  const go = useCallback((id, { replace = false } = {}) => {
    const url = "#/" + id;
    if (replace) window.history.replaceState(null, "", url);
    else if (window.location.hash !== url) window.history.pushState(null, "", url);
    setRoute(id);
  }, []);

  const back = useCallback(() => window.history.back(), []);
  return { route, go, back };
}
