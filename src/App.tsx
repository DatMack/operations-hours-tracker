import { useEffect, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import TrackerApp from "./TrackerApp";
import { supabase } from "./lib/supabase";

const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    let inactivityTimer = window.setTimeout(() => void supabase.auth.signOut({ scope: "local" }), INACTIVITY_TIMEOUT_MS);
    const resetTimer = () => {
      window.clearTimeout(inactivityTimer);
      inactivityTimer = window.setTimeout(() => void supabase.auth.signOut({ scope: "local" }), INACTIVITY_TIMEOUT_MS);
    };
    const events: Array<keyof WindowEventMap> = ["pointerdown", "keydown", "touchstart"];
    events.forEach((eventName) => window.addEventListener(eventName, resetTimer, { passive: true }));
    return () => {
      window.clearTimeout(inactivityTimer);
      events.forEach((eventName) => window.removeEventListener(eventName, resetTimer));
    };
  }, [session]);

  if (!ready) return <AuthLoading />;
  if (!session) return <LoginScreen />;

  return <TrackerApp onSignOut={() => supabase.auth.signOut()} />;
}

function AuthLoading() {
  return (
    <main className="loading-shell">
      <div className="loading-card">
        <div className="brand-box">OT</div>
        <h1>Operations Hours Tracker</h1>
        <span className="loader" />
        <p>Opening the secure tracker…</p>
      </div>
    </main>
  );
}

function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (signInError) setError(signInError.message);
    setBusy(false);
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="auth-brand">
          <div className="brand-box">OT</div>
          <div>
            <p className="eyebrow">Secure operations portal</p>
            <h1>Operations Hours Tracker</h1>
          </div>
        </div>
        <p className="auth-copy">Sign in with an approved company account to manage overtime, PTO, employees, and the shift calendar.</p>
        {error && <div className="alert error"><span>!</span>{error}</div>}
        <form className="auth-form" onSubmit={(event) => void signIn(event)}>
          <label>
            <span>Email address</span>
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" required autoFocus />
          </label>
          <label>
            <span>Password</span>
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
          </label>
          <button className="primary-button full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        </form>
        <div className="privacy-note">
          <strong>Approved access only</strong>
          <span>Accounts are created by the tracker administrator. Employee information is protected by Supabase authentication and database security policies. Inactive sessions sign out after 30 minutes.</span>
        </div>
      </section>
    </main>
  );
}
