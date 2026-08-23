import { useState, type ChangeEvent, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { MapPicker } from "./MapPicker";
import { PasswordField } from "../../shared/components/PasswordField";
import type { Language, Role, RoomTypeInput } from "./types";
import "./RegisterPage.css";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9]{7,15}$/;
const DEFAULT_AVATAR =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Ccircle cx='32' cy='32' r='32' fill='%23cbd8e4'/%3E%3Ccircle cx='32' cy='24' r='12' fill='%23f7fafc'/%3E%3Cpath d='M10 58c4-14 16-20 22-20s18 6 22 20' fill='%23f7fafc'/%3E%3C/svg%3E";

function emptyRoomType(): RoomTypeInput {
  return { name: "", description: "", amenities: [], capacity: 2, priceAmount: 0, currency: "NZD", imageUrls: [] };
}

/** 只是一个粗启发式（长度 + 字符类别数），不接后端也不装模作样精确评分——
   够用来给用户一个即时的"这个密码够不够"的方向感就行。 */
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

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(undefined);
  const [nickname, setNickname] = useState("");
  const [gender, setGender] = useState("unspecified");
  const [language, setLanguage] = useState<Language>("en");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [role, setRole] = useState<Role>("guest");

  const [hotelName, setHotelName] = useState("");
  const [hotelAddress, setHotelAddress] = useState("");
  const [hotelLat, setHotelLat] = useState(0);
  const [hotelLng, setHotelLng] = useState(0);
  const [roomTypes, setRoomTypes] = useState<RoomTypeInput[]>([emptyRoomType()]);

  const [submitting, setSubmitting] = useState(false);
  const [succeeded, setSucceeded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avatarJustUpdated, setAvatarJustUpdated] = useState(false);

  const emailError = email && !EMAIL_RE.test(email) ? "Invalid email format" : null;
  const phoneError = phone && !PHONE_RE.test(phone) ? "Invalid phone format" : null;
  const passwordMismatch = confirmPassword.length > 0 && password !== confirmPassword;
  const strength = passwordStrength(password);

  function handleAvatarChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setError("Avatar file must be under 2MB");
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

  function updateRoomType(index: number, patch: Partial<RoomTypeInput>) {
    setRoomTypes((prev) => prev.map((rt, i) => (i === index ? { ...rt, ...patch } : rt)));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (emailError || phoneError) {
      setError("Please fix the errors in the form");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setSubmitting(true);
    try {
      await register({
        email,
        phone,
        nickname,
        gender,
        language,
        password,
        confirmPassword,
        role,
        avatarUrl,
        hotel:
          role === "hotel"
            ? { name: hotelName, address: hotelAddress, lat: hotelLat, lng: hotelLng, roomTypes }
            : undefined,
      });
      setSubmitting(false);
      setSucceeded(true);
      window.setTimeout(() => navigate("/login", { state: { registered: true } }), 420);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
      setSubmitting(false);
    }
  }

  return (
    <div className="register-page">
      <div className="register-bg-decor" aria-hidden="true" />
      <div className="register-layout">
      <form onSubmit={handleSubmit} className="register-card">
        <h1>Register</h1>

        <div className="register-avatar-row">
          <img
            src={avatarUrl || DEFAULT_AVATAR}
            alt="Avatar preview"
            className={`register-avatar-preview ${avatarJustUpdated ? "register-avatar-updated" : ""}`}
          />
          <label className="register-avatar-upload">
            Upload avatar
            <input type="file" accept="image/*" onChange={handleAvatarChange} hidden />
          </label>
        </div>

        <div className="register-grid">
          <label className="register-field">
            <span>Nickname</span>
            <input value={nickname} onChange={(e) => setNickname(e.target.value)} required />
          </label>

          <label className="register-field">
            <span>Gender</span>
            <select value={gender} onChange={(e) => setGender(e.target.value)}>
              <option value="unspecified">Prefer not to say</option>
              <option value="female">Female</option>
              <option value="male">Male</option>
            </select>
          </label>

          <label className="register-field">
            <span>Language</span>
            <select value={language} onChange={(e) => setLanguage(e.target.value as Language)}>
              <option value="en">English</option>
              <option value="zh">中文</option>
              <option value="mi">Māori</option>
            </select>
          </label>

          <label className="register-field">
            <span>Email</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            {emailError && <em className="register-field-error">{emailError}</em>}
          </label>

          <label className="register-field">
            <span>Phone</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} required placeholder="+64211234567" />
            {phoneError && <em className="register-field-error">{phoneError}</em>}
          </label>

          <label className="register-field">
            <span>Password</span>
            <PasswordField value={password} onChange={setPassword} required minLength={8} />
            {password && (
              <div className="register-strength">
                <div className="register-strength-track">
                  <div
                    className={`register-strength-fill register-strength-fill-${strength.tier}`}
                    style={{ width: `${strength.pct}%` }}
                  />
                </div>
                <span className="register-strength-label">{strength.label}</span>
              </div>
            )}
          </label>

          <label className="register-field">
            <span>Confirm password</span>
            <PasswordField value={confirmPassword} onChange={setConfirmPassword} required />
            {passwordMismatch && <em className="register-field-error">Passwords do not match</em>}
          </label>
        </div>

        <fieldset className="register-role">
          <legend>Register as</legend>
          {(["guest", "coordinator", "hotel"] as const).map((r) => (
            <label key={r} className="register-role-option">
              <input type="radio" name="role" checked={role === r} onChange={() => setRole(r)} />
              {r === "guest" ? "Guest" : r === "coordinator" ? "Coordinator" : "Hotel"}
            </label>
          ))}
        </fieldset>

        {role === "hotel" && (
          <fieldset className="register-hotel">
            <legend>Hotel profile</legend>

            <label className="register-field">
              <span>Hotel name</span>
              <input value={hotelName} onChange={(e) => setHotelName(e.target.value)} required />
            </label>

            <MapPicker
              lat={hotelLat}
              lng={hotelLng}
              onPick={(lat, lng, address) => {
                setHotelLat(lat);
                setHotelLng(lng);
                if (address) setHotelAddress(address);
              }}
            />

            <label className="register-field">
              <span>Address</span>
              <input value={hotelAddress} onChange={(e) => setHotelAddress(e.target.value)} required />
            </label>

            <div className="register-roomtypes">
              <div className="register-roomtypes-header">
                <span>Room types</span>
                <button type="button" onClick={() => setRoomTypes((prev) => [...prev, emptyRoomType()])}>
                  + Add room type
                </button>
              </div>

              {roomTypes.map((rt, i) => (
                <div key={i} className="register-roomtype-card">
                  <div className="register-roomtype-grid">
                    <label className="register-field">
                      <span>Room type name</span>
                      <input value={rt.name} onChange={(e) => updateRoomType(i, { name: e.target.value })} required />
                    </label>
                    <label className="register-field">
                      <span>Price (NZD/night)</span>
                      <input
                        type="number"
                        min={0}
                        value={rt.priceAmount}
                        onChange={(e) => updateRoomType(i, { priceAmount: Number(e.target.value) })}
                        required
                      />
                    </label>
                    <label className="register-field">
                      <span>Capacity</span>
                      <input
                        type="number"
                        min={1}
                        value={rt.capacity}
                        onChange={(e) => updateRoomType(i, { capacity: Number(e.target.value) })}
                      />
                    </label>
                    <label className="register-field register-field-wide">
                      <span>Description & features</span>
                      <input value={rt.description} onChange={(e) => updateRoomType(i, { description: e.target.value })} />
                    </label>
                    <label className="register-field register-field-wide">
                      <span>Amenities (comma-separated, e.g. wifi,breakfast)</span>
                      <input
                        value={rt.amenities.join(",")}
                        onChange={(e) =>
                          updateRoomType(i, { amenities: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })
                        }
                      />
                    </label>
                    <label className="register-field register-field-wide">
                      <span>Image URLs (comma-separated)</span>
                      <input
                        value={rt.imageUrls.join(",")}
                        onChange={(e) =>
                          updateRoomType(i, { imageUrls: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })
                        }
                      />
                    </label>
                  </div>
                  {roomTypes.length > 1 && (
                    <button
                      type="button"
                      className="register-roomtype-remove"
                      onClick={() => setRoomTypes((prev) => prev.filter((_, idx) => idx !== i))}
                    >
                      Remove this room type
                    </button>
                  )}
                </div>
              ))}
            </div>
          </fieldset>
        )}

        {error && <p className="register-error">{error}</p>}

        <button
          type="submit"
          className={`register-submit ${succeeded ? "register-submit-success" : ""}`}
          disabled={submitting || succeeded}
        >
          {succeeded ? (
            <span className="register-check" aria-hidden="true">
              ✓
            </span>
          ) : submitting ? (
            <span className="register-spinner" aria-hidden="true" />
          ) : (
            "Register"
          )}
        </button>

        <p className="register-footer">
          Already have an account? <a href="/login">Sign in</a>
        </p>
      </form>

      <ul className="register-benefits">
        <li>
          <span className="register-benefit-icon" aria-hidden="true">⚡</span>
          <div>
            <p className="register-benefit-title">Guests</p>
            <p className="register-benefit-body">Get matched to disruptions automatically and pick a fix in one click.</p>
          </div>
        </li>
        <li>
          <span className="register-benefit-icon" aria-hidden="true">🏨</span>
          <div>
            <p className="register-benefit-title">Hotels</p>
            <p className="register-benefit-body">Respond to deferral requests and offer perks straight from the dashboard.</p>
          </div>
        </li>
        <li>
          <span className="register-benefit-icon" aria-hidden="true">🧑‍💼</span>
          <div>
            <p className="register-benefit-title">Coordinators</p>
            <p className="register-benefit-body">Triage escalations and track resolution across every active case.</p>
          </div>
        </li>
      </ul>
      </div>
    </div>
  );
}
