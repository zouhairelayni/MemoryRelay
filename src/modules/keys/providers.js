// API-key providers. Gemini and OpenRouter are built in. Add the next one here with its own panel.
// When more than one provider exists the Keys screen shows a switcher automatically.
import GeminiPanel from "./GeminiPanel.jsx";
import OpenRouterPanel from "./OpenRouterPanel.jsx";

export const PROVIDERS = [
  { id: "gemini", title: "Gemini", Panel: GeminiPanel },
  { id: "openrouter", title: "OpenRouter", Panel: OpenRouterPanel },
];
