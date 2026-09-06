import { useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import type { AuthUser, Language } from "../auth/types";
import * as api from "./api";
import { AppShell } from "../../shared/components/AppShell";
import { RoleTopNav } from "../../shared/components/RoleTopNav";
import { CoordinatorDashboardShell } from "../coordinator/CoordinatorDashboardShell";
import { GuestDashboardShell } from "../home/GuestDashboardShell";
import "./ProfilePage.css";

const PHONE_RE = /^\+?[0-9]{7,15}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLE_BLURB: Record<AuthUser["role"], string> = {
  guest: "You get matched to disruptions automatically and can pick a rebooking, hotel move, or refund in one click.",
  coordinator: "You triage escalations, review AI-drafted options, and close out cases the AI couldn't resolve alone.",
  hotel: "You respond to deferral requests and guest selections, and manage your room types and perks catalog.",
};

function formatJoinDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-NZ", { year: "numeric", month: "long", day: "numeric" });
}
const DEFAULT_AVATAR =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Ccircle cx='32' cy='32' r='32' fill='%23cbd8e4'/%3E%3Ccircle cx='32' cy='24' r='12' fill='%23f7fafc'/%3E%3Cpath d='M10 58c4-14 16-20 22-20s18 6 22 20' fill='%23f7fafc'/%3E%3C/svg%3E";

function ProfileSectionIcon({ type }: { type: "person" | "account" | "email" | "lock" }) {
  const paths = {
    person: <><circle cx="12" cy="8" r="3" /><path d="M6 21v-2a6 6 0 0 1 12 0v2" /></>,
    account: <><path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z" /><path d="m9 12 2 2 4-4" /></>,
    email: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>,
    lock: <><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[type]}</svg>;
}

/** 粗启发式(长度+字符类别数)，跟 RegisterPage 里那份逻辑一致但没抽公共 util——
   两边各自独立一个纯函数比为了 4 行逻辑新开一个共享模块更划算。 */
function passwordStrength(pw: string): { pct: number; label: string; tier: "weak" | "fair" | "strong" } {
  if (!pw) return { pct: 0, label: "", tier: "weak" };
  let classes = 0;
  if (/[a-z]/.test(pw)) classes++;
  if (/[A-Z]/.test(pw)) classes++;
  if (/[0-9]/.test(pw)) classes++;
  if (/[^a-zA-Z0-9]/.test(pw)) classes++;
  const lengthScore = Math.min(pw.length / 12, 1);
  const score = lengthScore * 0.6 + (classes / 4) * 0.4;
  if (score < 0.4) return { pct: Math.max(score * 100, 8), label: "Weak", tier: "weak" };
  if (score < 0.7) return { pct: score * 100, label: "Fair", tier: "fair" };
  return { pct: 100, label: "Strong", tier: "strong" };
}

/** user is guaranteed non-null by ProtectedRoute; split into two components purely to avoid breaking the Rules of Hooks. */
export function ProfilePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;
  if (user.role === "coordinator") {
    return (
      <CoordinatorDashboardShell
        user={user}
        active="reports"
        onNavigate={() => navigate("/coordinator/home")}
        onSearch={() => navigate("/coordinator/home")}
      >
        <div className="profile-coordinator-stage">
          <ProfilePageContent user={user} embedded />
        </div>
      </CoordinatorDashboardShell>
    );
  }
  if (user.role === "guest") {
    return (
      <GuestDashboardShell active="profile">
        <div className="profile-guest-stage profile-coordinator-stage"><ProfilePageContent user={user} embedded /></div>
      </GuestDashboardShell>
    );
  }
  return <ProfilePageContent user={user} />;
}

function ProfilePageContent({ user, embedded = false }: { user: AuthUser; embedded?: boolean }) {
  const { updateUser, logout } = useAuth();
  const accountRole = user.role === "guest" ? "Traveller" : `${user.role.charAt(0).toUpperCase()}${user.role.slice(1)}`;
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl ?? undefined);
  const [nickname, setNickname] = useState(user.nickname);
  const [gender, setGender] = useState(user.gender);
  const [language, setLanguage] = useState<Language>(user.language);
  const [phone, setPhone] = useState(user.phone);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [avatarJustUpdated, setAvatarJustUpdated] = useState(false);
  const phoneError = phone && !PHONE_RE.test(phone) ? "Invalid phone format" : null;

  const completeness = useMemo(() => {
    const fields = [avatarUrl, nickname, gender !== "unspecified", language, phone && !phoneError];
    const filled = fields.filter(Boolean).length;
    return Math.round((filled / fields.length) * 100);
  }, [avatarUrl, nickname, gender, language, phone, phoneError]);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);

  const [newEmail, setNewEmail] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [emailStage, setEmailStage] = useState<"idle" | "code-sent">("idle");
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailMessage, setEmailMessage] = useState<string | null>(null);
  const newEmailError = newEmail && !EMAIL_RE.test(newEmail) ? "Invalid email format" : null;

  function handleAvatarChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setProfileMessage("Avatar file must be under 2MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setAvatarUrl(reader.result as string);
      setAvatarJustUpdated(true);
      window.setTimeout(() => setAvatarJustUpdated(false), 400);
    };
    reader.readAsDataURL(file);
  }

  async function handleProfileSubmit(e: FormEvent) {
    e.preventDefault();
    if (phoneError) return;
    setProfileSaving(true);
    setProfileMessage(null);
    try {
      const res = await api.updateProfile({ nickname, gender, language, phone, avatarUrl });
      if (res.code !== 0) throw new Error(res.message);
      updateUser(res.data);
      setProfileMessage("Profile saved");
    } catch (err) {
      setProfileMessage(err instanceof Error ? err.message : "Save failed");
    } finally {
      setProfileSaving(false);
    }
  }

  async function handlePasswordSubmit(e: FormEvent) {
    e.preventDefault();
    setPasswordSaving(true);
    setPasswordMessage(null);
    try {
      const res = await api.changePassword({ currentPassword, newPassword });
      if (res.code !== 0) throw new Error(res.message);
      setPasswordMessage("Password changed");
      setCurrentPassword("");
      setNewPassword("");
    } catch (err) {
      setPasswordMessage(err instanceof Error ? err.message : "Change failed");
    } finally {
      setPasswordSaving(false);
    }
  }

  async function handleSendCode() {
    setEmailSaving(true);
    setEmailMessage(null);
    try {
      const res = await api.requestEmailChange(newEmail);
      if (res.code !== 0) throw new Error(res.message);
      setEmailStage("code-sent");
      setEmailMessage(`Verification code generated (demo environment): ${res.data.devCode}`);
    } catch (err) {
      setEmailMessage(err instanceof Error ? err.message : "Send failed");
    } finally {
      setEmailSaving(false);
    }
  }

  async function handleConfirmEmail(e: FormEvent) {
    e.preventDefault();
    setEmailSaving(true);
    setEmailMessage(null);
    try {
      const res = await api.confirmEmailChange(newEmail, emailCode);
      if (res.code !== 0) throw new Error(res.message);
      updateUser(res.data);
      setEmailStage("idle");
      setNewEmail("");
      setEmailCode("");
      setEmailMessage("Email updated");
    } catch (err) {
      setEmailMessage(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setEmailSaving(false);
    }
  }

  const content = (
      <div className="profile-page">
        <header className="profile-page-hero">
          <div><small>ACCOUNT</small><h1>Profile</h1><p>Manage your personal details, email credentials, and security preferences.</p></div>
          <span>{user.role === "coordinator" ? "Authenticated Coordinator" : `${accountRole} account`}</span>
        </header>
        {user.mustChangePassword && (
          <div className="profile-force-password-banner">
            Your password was reset by a coordinator. Please set a new password below before continuing.
          </div>
        )}
        <div className="profile-columns">
        <div className="profile-col">
        <section className="profile-card">
          <div className="profile-card-header-row">
            <div className="profile-section-title"><i><ProfileSectionIcon type="person" /></i><div><h2>Basic info</h2><p>{user.role === "guest" ? "Personal details and contact information" : "Basic identity and operational information"}</p></div></div>
            <div className="profile-completeness" title={`${completeness}% complete`}>
              <div className="profile-completeness-track">
                <div className="profile-completeness-fill" style={{ width: `${completeness}%` }} />
              </div>
              <span className="profile-completeness-label">{completeness}% complete</span>
            </div>
          </div>
          <form onSubmit={handleProfileSubmit} className="profile-form">
            <div className="profile-avatar-row">
              <img
                src={avatarUrl || DEFAULT_AVATAR}
                alt="Avatar preview"
                className={`profile-avatar-preview ${avatarJustUpdated ? "profile-avatar-updated" : ""}`}
              />
              <label className="profile-avatar-upload">
                Change avatar
                <input type="file" accept="image/*" onChange={handleAvatarChange} hidden />
              </label>
            </div>

            <div className="profile-grid">
              <label className="profile-field">
                <span>Nickname</span>
                <input value={nickname} onChange={(e) => setNickname(e.target.value)} required />
              </label>
              <label className="profile-field">
                <span>Gender</span>
                <select value={gender} onChange={(e) => setGender(e.target.value)}>
                  <option value="unspecified">Prefer not to say</option>
                  <option value="female">Female</option>
                  <option value="male">Male</option>
                </select>
              </label>
              <label className="profile-field">
                <span>Language</span>
                <select value={language} onChange={(e) => setLanguage(e.target.value as Language)}>
                  <option value="en">English</option>
                  <option value="zh">中文</option>
                  <option value="mi">Māori</option>
                </select>
              </label>
              <label className="profile-field">
                <span>Phone</span>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} required />
                {phoneError && <em className="profile-field-error">{phoneError}</em>}
              </label>
              <label className="profile-field">
                <span>Account type</span>
                <input value={accountRole} disabled />
              </label>
            </div>

            {profileMessage && <p className="profile-message">{profileMessage}</p>}
            <button type="submit" className="profile-submit" disabled={profileSaving}>
              {profileSaving ? <span className="profile-spinner" aria-hidden="true" /> : "Save Profile Changes"}
            </button>
          </form>
        </section>
        </div>

        <div className="profile-col">
        <section className="profile-card">
          <div className="profile-section-title"><i><ProfileSectionIcon type="email" /></i><div><h2>Email</h2><p>Primary notification and sign-in email</p></div></div>
          <div className="profile-current-email"><small>Current email</small><strong>{user.email}</strong></div>
          {emailStage === "idle" ? (
            <div className="profile-form">
              <label className="profile-field">
                <span>New email</span>
                <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="new@example.com" />
                {newEmailError && <em className="profile-field-error">{newEmailError}</em>}
              </label>
              <button
                type="button"
                className="profile-secondary"
                disabled={!newEmail || !!newEmailError || emailSaving}
                onClick={() => void handleSendCode()}
              >
                {emailSaving ? "Sending…" : "Send verification code"}
              </button>
            </div>
          ) : (
            <form onSubmit={handleConfirmEmail} className="profile-form">
              <label className="profile-field">
                <span>Verification code</span>
                <input value={emailCode} onChange={(e) => setEmailCode(e.target.value)} required />
              </label>
              <button type="submit" className="profile-submit" disabled={emailSaving}>
                {emailSaving ? "Verifying…" : "Confirm change"}
              </button>
            </form>
          )}
          {emailMessage && <p className="profile-message">{emailMessage}</p>}
        </section>

        <section className="profile-card">
          <div className="profile-section-title"><i><ProfileSectionIcon type="lock" /></i><div><h2>Change password</h2><p>Manage authentication credentials</p></div></div>
          <form onSubmit={handlePasswordSubmit} className="profile-form">
            <label className="profile-field">
              <span>Current password</span>
              <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
            </label>
            <label className="profile-field">
              <span>New password</span>
              <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8} />
              {newPassword && (
                <div className="profile-strength">
                  <div className="profile-strength-track">
                    <div
                      className={`profile-strength-fill profile-strength-fill-${passwordStrength(newPassword).tier}`}
                      style={{ width: `${passwordStrength(newPassword).pct}%` }}
                    />
                  </div>
                  <span className="profile-strength-label">{passwordStrength(newPassword).label}</span>
                </div>
              )}
            </label>
            {passwordMessage && <p className="profile-message">{passwordMessage}</p>}
            <button type="submit" className="profile-submit" disabled={passwordSaving}>
              {passwordSaving ? <span className="profile-spinner" aria-hidden="true" /> : "Update Password"}
            </button>
          </form>
        </section>

        <section className="profile-card profile-account-card">
          <div className="profile-section-title"><i><ProfileSectionIcon type="account" /></i><div><h2>Account</h2><p>Membership and account access</p></div></div>
          <dl className="profile-account-list">
            <div><dt>Member since</dt><dd>{formatJoinDate(user.createdAt)}</dd></div>
            <div><dt>Account type</dt><dd className="profile-account-role">{accountRole}</dd></div>
          </dl>
          <div className="profile-operational-scope"><strong>{user.role === "guest" ? "Traveller services" : "Operational Scope"}</strong><p>{ROLE_BLURB[user.role]}</p></div>
        </section>

        </div>
        </div>

        <button className="profile-logout" onClick={() => void logout()}>
          Log out
        </button>
      </div>
  );

  if (embedded) return content;
  return <AppShell centerContent={<RoleTopNav role={user.role} />}>{content}</AppShell>;
}
