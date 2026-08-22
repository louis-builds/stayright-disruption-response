import { useCallback, useEffect, useState } from "react";
import * as api from "./api";
import type { CaseSummary } from "./types";

const POLL_INTERVAL_MS = 30_000;

export function useMyCases() {
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const res = await api.fetchMyCases(false);
    if (res.code === 0) setCases(res.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  return { cases, loading, refresh };
}
