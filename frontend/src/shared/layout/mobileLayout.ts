/** 竖屏，或窄屏（手机横屏宽度通常仍 ≤768）。首页用这个决定是否进入 M 站 layout。 */
const PORTRAIT = "(orientation: portrait)";
const NARROW = "(max-width: 768px)";

export function isMobileLayout(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia(PORTRAIT).matches || window.matchMedia(NARROW).matches || window.innerWidth <= 768;
}

export function loginPath(): string {
  return isMobileLayout() ? "/m/login" : "/login";
}

export function registerPath(): string {
  return isMobileLayout() ? "/m/register" : "/register";
}

export function isAuthPath(pathname: string): boolean {
  return pathname === "/login" || pathname === "/m/login" || pathname === "/register" || pathname === "/m/register";
}

export function subscribeMobileLayout(onChange: (mobile: boolean) => void): () => void {
  const portrait = window.matchMedia(PORTRAIT);
  const narrow = window.matchMedia(NARROW);
  const update = () => onChange(isMobileLayout());
  update();
  portrait.addEventListener("change", update);
  narrow.addEventListener("change", update);
  window.addEventListener("resize", update);
  return () => {
    portrait.removeEventListener("change", update);
    narrow.removeEventListener("change", update);
    window.removeEventListener("resize", update);
  };
}
