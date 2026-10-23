// The module registry. Each entry becomes a tab in the bottom bar AND a card on Home.
// To add a new module: create modules/<id>/<Id>Screen.jsx and add one line here.
//
//   id      route name (#/id) and unique key
//   title   shown in the bottom bar and the top bar
//   icon    a name from components/Icon.jsx
//   blurb   one line shown on the Home screen
//   Screen  component; receives { active } (true while it is the visible tab)
//   tab     false hides it from the bottom bar (still reachable from Home)
import HomeScreen from "./home/HomeScreen.jsx";
import AgentsScreen from "./agents/AgentsScreen.jsx";
import MemoryScreen from "./memory/MemoryScreen.jsx";
import KeysScreen from "./keys/KeysScreen.jsx";
import SkillsScreen from "./skills/SkillsScreen.jsx";

export const MODULES = [
  { id: "home", title: "Home", icon: "home", blurb: "", Screen: HomeScreen, tab: true },
  { id: "agents", title: "Agents", icon: "agents", blurb: "Connect agents and see what each one does", Screen: AgentsScreen, tab: true },
  { id: "memory", title: "Memory", icon: "memory", blurb: "Facts and rules every agent can read", Screen: MemoryScreen, tab: true },
  { id: "keys", title: "Keys", icon: "keys", blurb: "API keys and models that rotate on their own", Screen: KeysScreen, tab: true },
  { id: "skills", title: "Skills", icon: "skills", blurb: "Choose which skills your agents can use", Screen: SkillsScreen, tab: true },
];

export const TABS = MODULES.filter((m) => m.tab);
export const TAB_IDS = TABS.map((m) => m.id);
