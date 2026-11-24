// Brand marks for the apps that connect to Memory Relay. Shared by the dashboard (src) and the sign-in page (worker).
// These are small simplified marks drawn for this project, used only to tell the connected app apart at a glance.
// Each mark lives on a 24x24 grid. `body` is trusted constant SVG markup, never user input.
export const BRANDS = {
  claude: { label: "Claude", color: "#D97757", body: `<path d="M12.00 9.40L12.00 1.80M13.45 9.84L16.47 5.37M14.25 10.70L20.83 6.90M14.59 12.18L19.98 12.56M14.25 13.30L20.83 17.10M13.14 14.34L15.51 19.19M12.00 14.60L12.00 22.20M10.55 14.16L7.53 18.63M9.75 13.30L3.17 17.10M9.41 11.82L4.02 11.44M9.75 10.70L3.17 6.90M10.86 9.66L8.49 4.81" fill="none" stroke="#D97757" stroke-width="2.3" stroke-linecap="round"/>` },
  chatgpt: { label: "ChatGPT", color: "#10A37F", body: `<g fill="none" stroke="#10A37F" stroke-width="1.5"><circle cx="12.00" cy="7.30" r="4.6"/><circle cx="16.07" cy="9.65" r="4.6"/><circle cx="16.07" cy="14.35" r="4.6"/><circle cx="12.00" cy="16.70" r="4.6"/><circle cx="7.93" cy="14.35" r="4.6"/><circle cx="7.93" cy="9.65" r="4.6"/></g>` },
  gemini: { label: "Gemini", color: "#6E8BF5", body: `<defs><linearGradient id="mr-gem" x1="3" y1="3" x2="21" y2="21" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#4285F4"/><stop offset=".55" stop-color="#9B72CB"/><stop offset="1" stop-color="#D96570"/></linearGradient></defs><path d="M12 2C12.6 7.6 16.4 11.4 22 12C16.4 12.6 12.6 16.4 12 22C11.4 16.4 7.6 12.6 2 12C7.6 11.4 11.4 7.6 12 2Z" fill="url(#mr-gem)"/>` },
  cursor: { label: "Cursor", color: "#7A8499", body: `<path d="M12 2.5 20.5 7.2v9.6L12 21.5 3.5 16.8V7.2L12 2.5ZM12 12 20.5 7.2M12 12v9.5M12 12 3.5 7.2" fill="none" stroke="#7A8499" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/>` },
  copilot: { label: "Copilot", color: "#2F81F7", body: `<path d="M8.5 7 3.5 12l5 5M15.5 7l5 5-5 5M13.4 5.5l-2.8 13" fill="none" stroke="#2F81F7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>` },
  perplexity: { label: "Perplexity", color: "#20808D", body: `<path d="M12 2.5v19M4 7.2l16 9.6M20 7.2 4 16.8M7.2 3.8 12 8.6l4.8-4.8" fill="none" stroke="#20808D" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>` },
  mistral: { label: "Mistral", color: "#FA520F", body: `<g fill="#FA520F"><rect x="3" y="4" width="4" height="4"/><rect x="17" y="4" width="4" height="4"/><rect x="3" y="8" width="4" height="4"/><rect x="7" y="8" width="4" height="4"/><rect x="13" y="8" width="4" height="4"/><rect x="17" y="8" width="4" height="4"/><rect x="3" y="12" width="4" height="4"/><rect x="10" y="12" width="4" height="4"/><rect x="17" y="12" width="4" height="4"/><rect x="3" y="16" width="4" height="4"/><rect x="17" y="16" width="4" height="4"/></g>` },
};

// Which app is this? Looks at the connection name and what the app reported about itself (MCP clientInfo, OAuth client name).
const RULES = [
  ["claude", /claude|anthropic/],
  ["chatgpt", /chatgpt|openai|codex|gpt/],
  ["gemini", /gemini|bard|google ai|genai/],
  ["cursor", /cursor/],
  ["copilot", /copilot|vs ?code|visual studio|github/],
  ["perplexity", /perplexity/],
  ["mistral", /mistral|le chat/],
];
export function detectBrand(...names) {
  const text = names.filter(Boolean).join(" ").toLowerCase();
  const hit = RULES.find(([, re]) => re.test(text));
  return hit ? hit[0] : "";
}

// Static SVG markup for server-rendered pages.
export function brandSvg(id, size = 40) {
  const b = BRANDS[id];
  if (!b) return "";
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">${b.body}</svg>`;
}
