import { useEffect, useState } from "react";
import { useAuth } from "./hooks/useAuth.js";
import { useTheme } from "./hooks/useTheme.js";
import AppShell from "./shell/AppShell.jsx";
import WelcomeSplash from "./components/WelcomeSplash.jsx";
import AuthGate from "./shell/AuthGate.jsx";

export default function App() {
  const auth = useAuth();
  useTheme(); // Applies saved appearance before sign-in too.
  const [welcomeComplete, setWelcomeComplete] = useState(false);
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Keep the brand visible briefly once on startup, not between tabs or on refresh.
    const id = window.setTimeout(() => setWelcomeComplete(true), reduced ? 0 : 1250);
    return () => window.clearTimeout(id);
  }, []);
  if (auth.phase === "loading" || !welcomeComplete) return <WelcomeSplash loading={auth.phase === "loading"} />;
  if (auth.phase === "gate") return <AuthGate setup={auth.setup} tokenRequired={auth.tokenRequired} locked={auth.setupLocked} onSubmit={auth.submit} />;
  return <AppShell email={auth.email} logout={auth.logout} />;
}
