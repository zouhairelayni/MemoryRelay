// API-key providers. Gemini is the first; add the next one here and give it a panel component.
// When more than one provider exists the Keys screen shows a switcher automatically.
import GeminiPanel from "./GeminiPanel.jsx";

export const PROVIDERS = [
  { id: "gemini", title: "Gemini", Panel: GeminiPanel },
];
