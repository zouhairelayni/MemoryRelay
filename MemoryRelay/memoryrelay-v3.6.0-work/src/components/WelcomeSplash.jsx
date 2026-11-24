import Logo from "./Logo.jsx";

/** One-time welcome while the app initializes. No loading dots, timers, or looping animations. */
export default function WelcomeSplash({ loading = false }) {
  return <div className="welcome-screen" role="status" aria-live="polite" aria-busy={loading}>
    <div className="welcome-stage">
      <div className="welcome-emblem"><Logo size={128} animated /></div>
      <div className="welcome-brand">
        <span className="welcome-wordmark">Memory Relay</span>
        <span className="welcome-subtitle">Knowledge, connected.</span>
      </div>
    </div>
    {loading ? <div className="welcome-loading" aria-label="Loading workspace">
      <span className="skeleton-line"/><span className="skeleton-line"/>
    </div> : null}
    <span className="welcome-footer">YOUR AGENTS. ONE MEMORY.</span>
  </div>;
}
