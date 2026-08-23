import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../features/auth";
import "./AvatarMenu.css";

const DEFAULT_AVATAR =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Ccircle cx='32' cy='32' r='32' fill='%23cbd8e4'/%3E%3Ccircle cx='32' cy='24' r='12' fill='%23f7fafc'/%3E%3Cpath d='M10 58c4-14 16-20 22-20s18 6 22 20' fill='%23f7fafc'/%3E%3C/svg%3E";

export function AvatarMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  if (!user) return null;

  return (
    <div className="avatar-menu" ref={ref}>
      <button className="avatar-trigger" onClick={() => setOpen((v) => !v)}>
        <img src={user.avatarUrl || DEFAULT_AVATAR} alt="" className="avatar-img" />
        <span className="avatar-nickname">{user.nickname}</span>
      </button>

      {open && (
        <div className="avatar-dropdown">
          <button
            className="avatar-dropdown-item"
            onClick={() => {
              setOpen(false);
              navigate("/profile");
            }}
          >
            Profile
          </button>
          <button
            className="avatar-dropdown-item"
            onClick={() => {
              setOpen(false);
              void logout().then(() => navigate("/login"));
            }}
          >
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
