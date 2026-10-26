// API-key providers. Add the next one here. The Keys screen shows a switcher between them.
import GeminiPanel from "./GeminiPanel.jsx";
import CompatPanel from "./CompatPanel.jsx";

const compat = (props) => function Panel({ active }) { return <CompatPanel {...props} active={active} />; };

export const PROVIDERS = [
  { id: "gemini", title: "Gemini", Panel: GeminiPanel },
  { id: "openrouter", title: "OpenRouter", Panel: compat({ id: "openrouter", title: "OpenRouter", keyHint: "sk-or-...", browseLabel: "Browse free models",
    intro: "Paste keys from openrouter.ai. Browsing lists free models only, so nothing you add will bill you. Rate limits (429) move on to the next key or model." }) },
  { id: "nvidia", title: "NVIDIA", Panel: compat({ id: "nvidia", title: "NVIDIA", keyHint: "nvapi-...", browseLabel: "Load NVIDIA models",
    intro: "Paste keys from build.nvidia.com (they start with nvapi-). The list shows chat models; pick the ones you want. Keys and models rotate like the others." }) },
  { id: "openai", title: "OpenAI", Panel: compat({ id: "openai", title: "OpenAI", keyHint: "sk-...", browseLabel: "Load OpenAI models",
    intro: "Paste keys from platform.openai.com. OpenAI is paid, so it is used only when you switch it on for automatic routing or an agent asks for it by name." }) },
];
