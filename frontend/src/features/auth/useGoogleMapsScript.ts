import { useEffect, useState } from "react";

declare global {
  interface Window {
    google?: typeof google;
    gm_authFailure?: () => void;
  }
}

const AUTH_FAILURE_MESSAGE = "Google Maps rejected this API key at runtime (billing or the Maps JavaScript API product isn't enabled for it in Google Cloud Console) — this needs fixing in Google Cloud, not in the app.";

let loadPromise: Promise<void> | null = null;
let authFailed = false;
// ponytail: google.maps.Map() 内部认证失败(计费没开/Maps JavaScript API 没启用)不会抛异常，只在控制台打印，
// script 标签本身照样 onload 成功——得挂 gm_authFailure 这个 Google 官方钩子才能捕捉到，光等 script onerror 逮不到。
const authFailureListeners = new Set<() => void>();
if (typeof window !== "undefined") {
  window.gm_authFailure = () => {
    authFailed = true;
    authFailureListeners.forEach((fn) => fn());
  };
}

function loadScript(apiKey: string): Promise<void> {
  if (window.google?.maps) return Promise.resolve();
  loadPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Google Maps"));
    document.head.appendChild(script);
  });
  return loadPromise;
}

export function useGoogleMapsScript() {
  const [ready, setReady] = useState(!!window.google?.maps);
  const [error, setError] = useState<string | null>(authFailed ? AUTH_FAILURE_MESSAGE : null);

  useEffect(() => {
    const onAuthFailure = () => setError(AUTH_FAILURE_MESSAGE);
    authFailureListeners.add(onAuthFailure);
    return () => {
      authFailureListeners.delete(onAuthFailure);
    };
  }, []);

  useEffect(() => {
    if (ready) return;
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      setError("Missing VITE_GOOGLE_MAPS_API_KEY configuration");
      return;
    }
    loadScript(apiKey)
      .then(() => setReady(true))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load map"));
  }, [ready]);

  return { ready, error };
}
