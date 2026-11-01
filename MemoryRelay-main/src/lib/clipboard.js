// Clipboard helpers that fall back to a hidden textarea when the Clipboard API is blocked.
function legacyCopy(text) {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export async function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  }
  return legacyCopy(text);
}

export async function readText() {
  if (!navigator.clipboard || !navigator.clipboard.readText) throw new Error("unsupported");
  return navigator.clipboard.readText();
}
