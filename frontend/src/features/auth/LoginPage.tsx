import { useEffect, useRef, useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthContext";
import * as authApi from "./api";
import { RETURN_URL_KEY } from "../../shared/api/client";
import { PasswordField } from "../../shared/components/PasswordField";
import { TypingIllustration } from "./TypingIllustration";
import "./LoginPage.css";

const TYPED_LINES = [
  "Checking flight status…",
  "Contacting Queenstown Lakeview Hotel…",
  "Drafting reschedule options…",
];

const FEATURES = [
  { icon: "⚡", title: "Real-time disruption alerts", body: "Weather, flight and road signals matched to your booking automatically." },
  { icon: "🤖", title: "AI-assisted support", body: "Ask questions any time — a human coordinator steps in when it matters." },
  { icon: "🔁", title: "One-click rebook or refund", body: "Pick a new date, a new hotel, or a refund — we handle the rest." },
];

/** 健康检查轮询：登录页本来就要连一次后端才知道能不能登录，顺手把这次连通性变成
 * 一个可见的"系统状态"指示，比闷头等用户提交失败才发现后端没起来更早暴露问题。 */
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

const REMEMBER_COOKIE = "remembered_login";

function readRememberedLogin(): { identifier: string; password: string } | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${REMEMBER_COOKIE}=([^;]*)`));
  if (!match) return null;
  try {
    return JSON.parse(decodeURIComponent(match[1])) as { identifier: string; password: string };
  } catch {
    return null;
  }
}

function writeRememberedLogin(identifier: string, password: string) {
  const value = encodeURIComponent(JSON.stringify({ identifier, password }));
  document.cookie = `${REMEMBER_COOKIE}=${value}; path=/; max-age=${60 * 60 * 24 * 30}`;
}

function clearRememberedLogin() {
  document.cookie = `${REMEMBER_COOKIE}=; path=/; max-age=0`;
}

export function LoginPage() {
  const { login, user, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { from?: string; registered?: boolean } | null;
  // 落地页一挂载就把 sessionStorage 里的返回地址读掉清空(不是等提交成功才清)——
  // 不然共用同一个浏览器标签的两个人依次登录时,第一个人被 401 弹回登录页存下的旧地址,
  // 会在第二个人根本没提交过表单、只是打开这个标签重新登录时,原封不动地"继承"过去,
  // 把人带到跟自己毫不相关的旧页面上,而不是各自角色的首页。用 useState 的惰性初始化
  // 保证这个读取+清空只在挂载时发生一次，本次挂载期间不会因为重渲染又变回去。
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
      // 关闭时先播完淡出动画再真正卸载，不是"啪"一下消失。
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
      const user = await login({ identifier, password, rememberMe });
      if (rememberMe) writeRememberedLogin(identifier, password);
      else clearRememberedLogin();
      setSubmitting(false);
      setSucceeded(true);
      // 成功后短暂停留展示"完成"态,再跳转——不是提交完立刻无声无息地换页。
      window.setTimeout(() => navigate(resolveDestination(user)), 420);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
      setSubmitting(false);
    }
  }

  // 断线/切标签页回来时被弹回登录页,再登回去还接着看刚才那页——这个"接着看"只对 guest 有意义
  // (比如从邮件通知点进某个 case,session 过期要求重新登录,登完当然该回到那个 case)。
  // hotel/coordinator 是员工操作台,登录就是"打开今天的任务队列",不该被某个残留的
  // 旧 case 链接劫持,固定回自己角色的首页。
  function resolveDestination(user: { role: string; homeRoute: string }): string {
    return user.role === "guest" ? from || user.homeRoute : user.homeRoute;
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

  // Remember me 签的是持久 cookie，浏览器重开/过一阵子再回到 /login 时 session 其实还有效——
  // 之前这里没检查，会照样傻乎乎地把登录表单摆出来，让人以为 remember me 没生效，实际是页面没识别"已登录"。
  //
  // 加 !succeeded 这个条件是因为踩过一个坑：login() 内部会同步 setUser(...)，这一步比
  // handleSubmit 自己的 setSucceeded(true) 更早生效（同一次 await 之后的续行里，setUser 在前）。
  // 没有这个条件时，user 一变真就立刻命中这条 early return 跳走，succeeded 为 true 那一支的
  // 对勾动画根本没机会画出来——代码注释里说的"短暂停留展示完成态"从来没真正发生过，截图会
  // 一直看到从表单直接跳目标页，抓不到中间那帧。
  if (!loading && user && !succeeded) return <Navigate to={resolveDestination(user)} replace />;

  return (
    <div className="login-page">
      <div className="login-visual" aria-hidden="true">
        <div className="login-visual-glow" />
        <div className="login-snow">
          {Array.from({ length: 22 }).map((_, i) => (
            <span
              key={i}
              className="login-snowflake"
              style={{
                left: `${(i * 37) % 100}%`,
                animationDelay: `${(i * 0.83) % 9}s`,
                animationDuration: `${8 + (i % 5) * 1.6}s`,
                opacity: 0.25 + (i % 4) * 0.12,
              }}
            />
          ))}
        </div>
        <TypingIllustration />
        <div className="login-typer">
          {TYPED_LINES.map((line, i) => (
            <p key={line} className="login-typer-line" style={{ animationDelay: `${i * 1.5}s` }}>
              <span className="login-typer-caret">▍</span> {line}
            </p>
          ))}
        </div>
        <div className="login-status">
          <span className={`login-status-dot login-status-dot-${health}`} />
          {health === "checking" ? "Checking system status…" : health === "up" ? "All systems live" : "Backend unreachable"}
        </div>
        <p className="login-visual-caption">Travel Disruption Agent</p>
      </div>

      <div className="login-panel">
        <svg className="login-route" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <path className="login-route-path" d="M -5 78 C 25 58, 40 92, 68 55 S 95 15, 108 22" />
          <circle className="login-route-dot" r="1.4" />
        </svg>
        <div className="login-panel-inner">
          <div className="login-card">
            <h1>Sign in</h1>
            <p className="login-subtitle">Sign in with your username or email</p>
            {state?.registered && <p className="login-success">Registration successful, please sign in.</p>}

            <form onSubmit={handleSubmit} className="login-form">
              <label className="login-field">
                <span>Username / Email</span>
                <input
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  required
                  autoComplete="username"
                  placeholder="Alice or alice@example.com"
                />
              </label>

              <label className="login-field">
                <span>Password</span>
                <PasswordField value={password} onChange={setPassword} required autoComplete="current-password" />
              </label>

              <div className="login-row">
                <label className="login-checkbox">
                  <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} />
                  Remember me
                </label>
                <button type="button" className="login-link" onClick={toggleForgot}>
                  Forgot password?
                </button>
              </div>

              {error && <p className="login-error">{error}</p>}

              <button
                type="submit"
                className={`login-submit ${succeeded ? "login-submit-success" : ""}`}
                disabled={submitting || succeeded}
              >
                {succeeded ? (
                  <span className="login-check" aria-hidden="true">
                    ✓
                  </span>
                ) : submitting ? (
                  <span className="login-spinner" aria-hidden="true" />
                ) : (
                  "Sign in"
                )}
              </button>
            </form>

            {forgotRendered && (
              <form
                onSubmit={handleForgotSubmit}
                className={`login-forgot ${showForgot ? "login-forgot-open" : "login-forgot-closing"}`}
              >
                <label className="login-field">
                  <span>Enter your registered email to get a reset link</span>
                  <input
                    type="email"
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    required
                    placeholder="you@example.com"
                  />
                </label>
                <button type="submit" className="login-forgot-submit" disabled={forgotSubmitting}>
                  {forgotSubmitting ? <span className="login-spinner login-spinner-sm" aria-hidden="true" /> : forgotSucceeded ? "Sent ✓" : "Send reset link"}
                </button>
                {forgotStatus && <p className="login-forgot-status">{forgotStatus}</p>}
              </form>
            )}

            <p className="login-footer">
              Don't have an account? <a href="/register">Register</a>
            </p>
          </div>

          <ul className="login-features">
            {FEATURES.map((f) => (
              <li key={f.title} className="login-feature">
                <span className="login-feature-icon" aria-hidden="true">
                  {f.icon}
                </span>
                <div>
                  <p className="login-feature-title">{f.title}</p>
                  <p className="login-feature-body">{f.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
