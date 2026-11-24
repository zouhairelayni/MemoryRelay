// Every agent gets one stable cable colour, used everywhere that agent shows up (rows, memory sources, logs).
// The same name always maps to the same colour; the palette lives in styles/tokens.css (--cable-0 .. --cable-7).
export function cableColor(name) {
  const s = String(name || "");
  if (!s) return "var(--muted)";
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return "var(--cable-" + (h % 8) + ")";
}

// A memory's source is "agent:<connection name>", "owner", "dashboard" or "import". Only agents get a cable colour.
export function sourceInfo(source) {
  const s = String(source || "");
  if (s.startsWith("agent:")) { const name = s.slice(6) || "agent"; return { name, color: cableColor(name), agent: true }; }
  return { name: s || "dashboard", color: "var(--muted)", agent: false };
}
