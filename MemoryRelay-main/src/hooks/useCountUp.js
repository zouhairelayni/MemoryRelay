import { useEffect, useRef, useState } from "react";

// Counts a number up to its value with an ease-out curve (about 600 ms). Jumps straight there when motion is reduced.
export function useCountUp(value, ms = 600) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const to = Number(value) || 0;
    const reduce = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || from.current === to) { from.current = to; setShown(to); return undefined; }
    const start = performance.now(), a = from.current;
    let raf = 0;
    const tick = (t) => {
      const k = Math.min(1, (t - start) / ms), e = 1 - Math.pow(1 - k, 4);
      setShown(Math.round(a + (to - a) * e));
      if (k < 1) raf = requestAnimationFrame(tick); else from.current = to;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return shown;
}
