import { useState } from "react";
import "./PasswordField.css";

interface PasswordFieldProps {
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
}

/** 睁眼(明文可见)。跟 EyeOffIcon 是同一个眼睛轮廓，只是没有那道斜杠——切换时看起来是同一个图标变化，
 * 不是两个不相关的符号，比 emoji(🙈 是猴子不是眼睛)更准确对应"看得见/看不见"。 */
function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z" />
      <circle cx="12" cy="12" r="3" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  );
}

/** 密码输入框统一加个小眼睛，点一下切换明文/密文，登录和注册共用这一份。 */
export function PasswordField({ value, onChange, autoComplete, required, minLength }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="password-field-wrap">
      <input
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        required={required}
        minLength={minLength}
      />
      <button
        type="button"
        className="password-field-toggle"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        tabIndex={-1}
      >
        {visible ? <EyeIcon /> : <EyeOffIcon />}
      </button>
    </div>
  );
}
