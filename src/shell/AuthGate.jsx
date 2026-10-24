import { useState } from "react";
import Button from "../components/Button.jsx";

export default function AuthGate({ setup, onSubmit }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError("");
    try { await onSubmit(email, password); setPassword(""); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="gate">
      <form className="card gate-card" onSubmit={submit}>
        <div className="eyebrow">Memory Relay</div>
        <h1>One space. <em>Every</em> agent.</h1>
        <div className="eyebrow" id="gate-title" style={{ marginTop: 18 }}>{setup ? "Create your account" : "Log in"}</div>
        <input id="email" className="fld" type="email" placeholder="Email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input id="password" className="fld" type="password" placeholder="Password (12+ characters)" autoComplete={setup ? "new-password" : "current-password"}
          value={password} onChange={(e) => setPassword(e.target.value)} />
        <Button id="gate-btn" type="submit" disabled={busy}>{setup ? "Create account" : "Log in"}</Button>
        {setup ? <p className="muted small" style={{ margin: 0 }}>First run: this account becomes the owner. Only one account can be created.</p> : null}
        {error ? <p className="notice small bad" id="gate-err" role="alert">{error}</p> : null}
      </form>
    </div>
  );
}
