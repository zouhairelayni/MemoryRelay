import { useAuth } from "./hooks/useAuth.js";
import { useTheme } from "./hooks/useTheme.js";
import AppShell from "./shell/AppShell.jsx";
import AuthGate from "./shell/AuthGate.jsx";

export default function App() {
  const auth = useAuth();
  useTheme(); // applies the saved theme before login too
  if (auth.phase === "loading") return <div className="boot" aria-busy="true"><span className="pulse" /></div>;
  if (auth.phase === "gate") return <AuthGate setup={auth.setup} tokenRequired={auth.tokenRequired} onSubmit={auth.submit} />;
  return <AppShell email={auth.email} logout={auth.logout} />;
}
