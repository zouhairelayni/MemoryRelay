import { useCallback, useEffect, useState } from "react";

export const ACCENTS = Object.freeze([
  { id: "purple", name: "Purple", color: "#a99bff", dark: "#b3aaff", soft: "#302c56" },
  { id: "orange", name: "Orange", color: "#f58e30", dark: "#ffb04e", soft: "#4a2b18" },
  { id: "coral", name: "Coral", color: "#ef6380", dark: "#ff8ca1", soft: "#462536" },
  { id: "mint", name: "Mint", color: "#18b994", dark: "#6cf4c9", soft: "#11382f" },
  { id: "energy-green", name: "Energy Green", color: "#78c900", dark: "#b0fa45", soft: "#263916" },
  { id: "aqua-blue", name: "Aqua Blue", color: "#168ed6", dark: "#5cd9ff", soft: "#17334a" },
]);
const KEY = "relay.accent";
export const validAccent = (value) => ACCENTS.some((a) => a.id === value) ? value : "purple";
export const getAccent = () => {
  try { return validAccent(window.localStorage.getItem(KEY)); } catch { return "purple"; }
};
export const iconFor = (accent, size = 192) => `/icons/${validAccent(accent)}-${size}.png`;

// Do not pretend changing an installed icon also changes Android's launcher cache.
export function applyAccent(value) {
  const accent = validAccent(value);
  document.documentElement.dataset.accent = accent;
  document.querySelector('link[rel="manifest"]')?.setAttribute("href", `/manifest-${accent}.webmanifest`);
  document.querySelector('link[data-relay-icon]')?.setAttribute("href", iconFor(accent, 32));
  document.querySelector('link[rel="apple-touch-icon"]')?.setAttribute("href", `/icons/${accent}-apple.png`);
  window.dispatchEvent(new CustomEvent("relay:accent-changed", { detail: accent }));
}

export function useAccent() {
  const [accent, set] = useState(getAccent);
  useEffect(() => {
    applyAccent(getAccent());
    const changed = (event) => set(validAccent(event.detail));
    window.addEventListener("relay:accent-changed", changed);
    return () => window.removeEventListener("relay:accent-changed", changed);
  }, []);
  const setAccent = useCallback((next) => {
    const value = validAccent(next);
    try { window.localStorage.setItem(KEY, value); } catch (_) {}
    set(value);
    applyAccent(value);
  }, []);
  return [accent, setAccent];
}
