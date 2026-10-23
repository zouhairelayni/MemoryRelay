import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { CARD_THRESHOLD, LOCK_PX } from "../lib/gesture.js";

// One card at a time with the Memory Atlas exit / enter animation.
// Animation classes are applied straight to the wrapper element (see styles/cards.css).
export function useSwipeDeck({ count, index, onIndex }) {
  const wrapRef = useRef(null);
  const live = useRef({ count, index });
  const busy = useRef(false);
  const dragging = useRef(false);
  const timers = useRef([]);
  live.current = { count, index };

  useLayoutEffect(() => {
    if (wrapRef.current) wrapRef.current.classList.toggle("swipeable", count > 1);
  }, [count]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const later = (fn, ms) => { timers.current.push(setTimeout(fn, ms)); };

  const go = useCallback((target, dir) => {
    const { count: n, index: cur } = live.current;
    const wrap = wrapRef.current;
    if (n < 2 || !wrap) return;
    const next = ((target % n) + n) % n;
    if (busy.current || next === cur) return;
    busy.current = true;
    wrap.classList.add(dir > 0 ? "exit-left" : "exit-right");
    later(() => {
      onIndex(next);
      wrap.classList.remove("exit-left", "exit-right");
      wrap.classList.add(dir > 0 ? "enter-from-right" : "enter-from-left");
      requestAnimationFrame(() => requestAnimationFrame(() => {
        wrap.classList.remove("enter-from-right", "enter-from-left");
        later(() => { busy.current = false; }, 280);
      }));
    }, 240);
  }, [onIndex]);

  const s = useRef({ drag: false, captured: false, x: 0, dx: 0 });
  const blocked = () => busy.current || live.current.count < 2 || !!(wrapRef.current && wrapRef.current.querySelector(".confirming"));

  const onPointerDown = (e) => {
    if (blocked()) return;
    Object.assign(s.current, { drag: true, captured: false, x: e.clientX, dx: 0 });
    wrapRef.current.style.transition = "none";
  };
  const onPointerMove = (e) => {
    const st = s.current;
    if (!st.drag) return;
    st.dx = e.clientX - st.x;
    const wrap = wrapRef.current;
    if (!st.captured && Math.abs(st.dx) > LOCK_PX - 2) {
      try { wrap.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      st.captured = true;
      dragging.current = true;
      wrap.classList.add("dragging");
    }
    if (st.captured) {
      wrap.style.transform = "translateX(" + st.dx + "px)";
      wrap.style.opacity = String(1 - Math.min(Math.abs(st.dx) / 400, 0.5));
    }
  };
  const end = () => {
    const st = s.current;
    if (!st.drag) return;
    st.drag = false;
    dragging.current = false;
    const wrap = wrapRef.current;
    wrap.classList.remove("dragging");
    wrap.style.transition = ""; wrap.style.transform = ""; wrap.style.opacity = "";
    const d = st.dx;
    st.dx = 0;
    const { index: cur } = live.current;
    if (d < -CARD_THRESHOLD) go(cur + 1, 1);
    else if (d > CARD_THRESHOLD) go(cur - 1, -1);
  };
  const onKeyDown = (e) => {
    if (wrapRef.current && wrapRef.current.querySelector(".confirming")) return;
    const { index: cur } = live.current;
    if (e.key === "ArrowRight") go(cur + 1, 1);
    if (e.key === "ArrowLeft") go(cur - 1, -1);
  };

  return {
    go,
    isBusy: () => busy.current || dragging.current,
    wrapProps: { ref: wrapRef, onPointerDown, onPointerMove, onPointerUp: end, onPointerCancel: end, onKeyDown },
  };
}
