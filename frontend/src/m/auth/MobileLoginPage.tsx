import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../features/auth/AuthContext";
import * as authApi from "../../features/auth/api";
import {
  clearRememberedLogin,
  readRememberedLogin,
  resolveLoginDestination,
  writeRememberedLogin,
} from "../../features/auth/loginSession";
import { RETURN_URL_KEY } from "../../shared/api/client";
import { PasswordField } from "../../shared/components/PasswordField";
import "./MobileLoginPage.css";

function useSystemHealth() {
  const [status, setStatus] = useState<"checking" | "up" | "down">("checking");

  useEffect(() => {
    let cancelled = false;
    async function ping() {
      try {
        const res = await authApi.fetchHealth();
        if (!cancelled) setStatus(res.data?.status === "ok" ? "up" : "down");
      } catch {
        if (!cancelled) setStatus("down");
      }
    }
    void ping();
    const id = window.setInterval(ping, 20000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return status;
}

export function MobileLoginPage() {
  const { login, user, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { from?: string; registered?: boolean } | null;
  const [from] = useState(() => {
    const initial = state?.from || sessionStorage.getItem(RETURN_URL_KEY);
    sessionStorage.removeItem(RETURN_URL_KEY);
    return initial;
  });

  const remembered = readRememberedLogin();
  const [identifier, setIdentifier] = useState(remembered?.identifier ?? "");
  const [password, setPassword] = useState(remembered?.password ?? "");
  const [rememberMe, setRememberMe] = useState(!!remembered);
  const [submitting, setSubmitting] = useState(false);
  const [succeeded, setSucceeded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showForgot, setShowForgot] = useState(false);
  const [forgotRendered, setForgotRendered] = useState(false);
  const forgotCloseTimer = useRef<number | undefined>(undefined);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotStatus, setForgotStatus] = useState<string | null>(null);
  const [forgotSubmitting, setForgotSubmitting] = useState(false);
  const [forgotSucceeded, setForgotSucceeded] = useState(false);

  const health = useSystemHealth();

  function toggleForgot() {
    if (showForgot) {
      setShowForgot(false);
      window.clearTimeout(forgotCloseTimer.current);
      forgotCloseTimer.current = window.setTimeout(() => setForgotRendered(false), 220);
    } else {
      window.clearTimeout(forgotCloseTimer.current);
      setForgotRendered(true);
      setShowForgot(true);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const nextUser = await login({ identifier, password, rememberMe });
      if (rememberMe) writeRememberedLogin(identifier, password);
      else clearRememberedLogin();
      setSubmitting(false);
      setSucceeded(true);
      window.setTimeout(() => navigate(resolveLoginDestination(nextUser, from)), 420);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
      setSubmitting(false);
    }
  }

  async function handleForgotSubmit(e: FormEvent) {
    e.preventDefault();
    setForgotSubmitting(true);
    setForgotStatus(null);
    setForgotSucceeded(false);
    try {
      await authApi.forgotPassword(forgotEmail);
      setForgotStatus("Reset link generated — check the server log (demo environment, no real email sent).");
      setForgotSucceeded(true);
    } catch {
      setForgotStatus("Failed to generate reset link, please try again later.");
    } finally {
      setForgotSubmitting(false);
    }
  }

  if (!loading && user && !succeeded) return <Navigate to={resolveLoginDestination(user, from)} replace />;

  return (
    <div className="m-login">
      <div className="m-login-glow" aria-hidden="true" />
      <header className="m-login-brand">
        <span className="m-login-mark" aria-hidden="true">
          <span />
        </span>
        <strong>StayRight NZ</strong>
        <small>Travel recovery, connected</small>
      </header>

      <section className="m-login-card">
        <h1>Sign in</h1>
        <p className="m-login-subtitle">Use your username or email</p>
        {state?.registered && <p className="m-login-success">Registration successful, please sign in.</p>}

        <form onSubmit={handleSubmit} className="m-login-form">
          <label className="m-login-field">
            <span>Username / Email</span>
            <input
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              required
              autoComplete="username"
              placeholder="Alice or alice@example.com"
              inputMode="email"
            />
          </label>

          <label className="m-login-field">
            <span>Password</span>
            <PasswordField value={password} onChange={setPassword} required autoComplete="current-password" />
          </label>

          <div className="m-login-row">
            <label className="m-login-checkbox">
              <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} />
              Remember me
            </label>
            <button type="button" className="m-login-link" onClick={toggleForgot}>
              Forgot password?
            </button>
          </div>

          {error && <p className="m-login-error">{error}</p>}

          <button
            type="submit"
            className={`m-login-submit ${succeeded ? "m-login-submit-success" : ""}`}
            disabled={submitting || succeeded}
          >
            {succeeded ? "✓" : submitting ? <span className="m-login-spinner" aria-hidden="true" /> : "Sign in"}
          </button>
        </form>

        {forgotRendered && (
          <form
            onSubmit={handleForgotSubmit}
            className={`m-login-forgot ${showForgot ? "m-login-forgot-open" : "m-login-forgot-closing"}`}
          >
            <label className="m-login-field">
              <span>Registered email</span>
              <input
                type="email"
                value={forgotEmail}
                onChange={(e) => setForgotEmail(e.target.value)}
                required
                placeholder="you@example.com"
              />
            </label>
            <button type="submit" className="m-login-forgot-submit" disabled={forgotSubmitting}>
              {forgotSubmitting ? <span className="m-login-spinner m-login-spinner-sm" aria-hidden="true" /> : forgotSucceeded ? "Sent ✓" : "Send reset link"}
            </button>
            {forgotStatus && <p className="m-login-forgot-status">{forgotStatus}</p>}
          </form>
        )}

        <p className="m-login-footer">
          Don't have an account? <Link to="/m/register">Register</Link>
        </p>
      </section>

      <p className="m-login-status">
        <span className={`m-login-status-dot m-login-status-dot-${health}`} />
        {health === "checking" ? "Checking system…" : health === "up" ? "All systems live" : "Backend unreachable"}
      </p>
    </div>
  );
}
