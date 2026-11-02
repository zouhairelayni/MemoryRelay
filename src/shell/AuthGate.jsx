import { useState } from "react";
import Logo from "../components/Logo.jsx";
import Button from "../components/Button.jsx";

export default function AuthGate({ setup, tokenRequired = false, onSubmit }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError("");
    try { await onSubmit(email, password, token); setPassword(""); setToken(""); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="gate">
      <div className="gate-intro" aria-hidden="true"><div className="gate-intro-inner"><span className="gate-overline">Your private control plane</span><h2>One place for every agent.</h2><p>Memory, skills, routing and access. Always under your control.</p><div className="gate-rule"/><span>Memory Relay / Workspace</span></div></div>
      <form className="card gate-card" onSubmit={submit}>
        <div className="gate-logo"><Logo size={52} /></div>
        <div className="eyebrow">Memory Relay</div>
        <h1>{setup ? "Create your workspace" : "Access your workspace"}</h1>
        <div className="eyebrow" id="gate-title" style={{ marginTop: 18 }}>{setup ? "Create your account" : "Log in"}</div>
        <label className="lbl" htmlFor="email">Email address</label>
        <input id="email" className="fld" type="email" placeholder="Email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        <label className="lbl" htmlFor="password">Password</label>
        <input id="password" className="fld" type="password" placeholder="Password (12+ characters)" autoComplete={setup ? "new-password" : "current-password"}
          value={password} onChange={(e) => setPassword(e.target.value)} />
        {setup && tokenRequired ? <input id="setup-token" className="fld" type="password" placeholder="Setup token (from your Worker secret)" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} /> : null}
        <Button id="gate-btn" type="submit" disabled={busy}>{setup ? "Create account" : "Log in"}</Button>
        {setup ? <p className="muted small" style={{ margin: 0 }}>First run: this account becomes the owner. Only one account can be created.</p> : null}
        {error ? <p className="notice small bad" id="gate-err" role="alert">{error}</p> : null}
      </form>
    </div>
  );
}
