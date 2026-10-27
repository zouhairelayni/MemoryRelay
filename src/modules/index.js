// The module registry. Each entry becomes a tab in the bottom bar.
// Order follows how the app is used: look (Live), content (Memory, Skills), plumbing (Agents, Models).
// To add a module: create modules/<id>/<Id>Screen.jsx and add one line here.
//
//   id      route name (#/id) and unique key (kept stable so saved links keep working)
//   title   shown in the bottom bar
//   icon    a name from components/Icon.jsx
//   blurb   one line describing the module
//   Screen  component; receives { active } (true while it is the visible tab)
//   tab     false hides it from the bottom bar
import HomeScreen from "./home/HomeScreen.jsx";
import MemoryScreen from "./memory/MemoryScreen.jsx";
import SkillsScreen from "./skills/SkillsScreen.jsx";
import AgentsScreen from "./agents/AgentsScreen.jsx";
import KeysScreen from "./keys/KeysScreen.jsx";

export const MODULES = [
  { id: "home", title: "Live", icon: "live", blurb: "What is happening now and what needs you", Screen: HomeScreen, tab: true },
  { id: "memory", title: "Memory", icon: "memory", blurb: "Facts and rules every agent can read", Screen: MemoryScreen, tab: true },
  { id: "skills", title: "Skills", icon: "skills", blurb: "Choose which skills your agents can use", Screen: SkillsScreen, tab: true },
  { id: "agents", title: "Agents", icon: "agents", blurb: "Connect agents and set what each may do", Screen: AgentsScreen, tab: true },
  { id: "keys", title: "Models", icon: "models", blurb: "AI keys, routing and sub-agents", Screen: KeysScreen, tab: true },
];

export const TABS = MODULES.filter((m) => m.tab);
export const TAB_IDS = TABS.map((m) => m.id);
