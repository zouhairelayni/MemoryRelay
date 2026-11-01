import { useCallback, useMemo, useRef } from "react";
import { AppContext } from "./AppContext.js";
import { TABS, TAB_IDS } from "../modules/index.js";
import { useHashRoute } from "../hooks/useHashRoute.js";
import { useOverview } from "../hooks/useOverview.js";
import { usePersistent } from "../hooks/usePersistent.js";
import { useTheme } from "../hooks/useTheme.js";
import SettingsSheet from "../settings/SettingsSheet.jsx";
import Pager from "./Pager.jsx";
import TabBar from "./TabBar.jsx";
import TopBar from "./TopBar.jsx";

const ROUTES = [...TAB_IDS, "settings"];

export default function AppShell({ email, logout }) {
  const { route, go, back } = useHashRoute(ROUTES, "home");
  const [theme, setTheme] = useTheme();
  const [swipeTabs, setSwipeTabs] = usePersistent("relay.swipeTabs", true);
  const overview = useOverview(true);

  // Settings is a layer on top of the last tab, so the tab underneath does not change.
  const lastTab = useRef("home");
  const settingsOpen = route === "settings";
  if (!settingsOpen) lastTab.current = route;
  const tabId = lastTab.current;
  const index = Math.max(0, TAB_IDS.indexOf(tabId));

  const openSettings = useCallback(() => go("settings"), [go]);
  const closeSettings = useCallback(() => { if (window.history.length > 1) back(); else go(lastTab.current, { replace: true }); }, [back, go]);

  const select = useCallback((id) => {
    if (id === tabId) {
      const pane = document.querySelector('[data-pane="' + id + '"]');
      if (pane) pane.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    go(id);
  }, [go, tabId]);

  // Logging out also forgets where you were, so the next login starts on Home.
  const doLogout = useCallback(async () => { window.history.replaceState(null, "", "#/home"); await logout(); }, [logout]);

  const ctx = useMemo(() => ({
    counts: overview.counts, status: overview.status, loadCounts: overview.loadCounts, test: overview.test,
    go: select, email, logout: doLogout, theme, setTheme, swipeTabs, setSwipeTabs,
  }), [overview.counts, overview.status, overview.loadCounts, overview.test, select, email, doLogout, theme, setTheme, swipeTabs, setSwipeTabs]);

  const panes = TABS.map((m) => ({ id: m.id, title: m.title, node: <m.Screen active={m.id === tabId && !settingsOpen} /> }));

  return (
    <AppContext.Provider value={ctx}>
      <div className="shell">
        <TopBar onSettings={openSettings} />
        <main className="main">
          <Pager panes={panes} index={index} onChange={go} swipe={swipeTabs && !settingsOpen} />
        </main>
        <TabBar tabs={TABS} activeId={tabId} onSelect={select} />
        <SettingsSheet open={settingsOpen} onClose={closeSettings} />
      </div>
    </AppContext.Provider>
  );
}
