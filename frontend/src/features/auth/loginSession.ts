export const REMEMBER_COOKIE = "remembered_login";

export function readRememberedLogin(): { identifier: string; password: string } | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${REMEMBER_COOKIE}=([^;]*)`));
  if (!match) return null;
  try {
    return JSON.parse(decodeURIComponent(match[1])) as { identifier: string; password: string };
  } catch {
    return null;
  }
}

export function writeRememberedLogin(identifier: string, password: string) {
  const value = encodeURIComponent(JSON.stringify({ identifier, password }));
  document.cookie = `${REMEMBER_COOKIE}=${value}; path=/; max-age=${60 * 60 * 24 * 30}`;
}

export function clearRememberedLogin() {
  document.cookie = `${REMEMBER_COOKIE}=; path=/; max-age=0`;
}

export function resolveLoginDestination(
  user: { role: string; homeRoute: string },
  from: string | null | undefined,
): string {
  return user.role === "guest" ? from || user.homeRoute : user.homeRoute;
}
