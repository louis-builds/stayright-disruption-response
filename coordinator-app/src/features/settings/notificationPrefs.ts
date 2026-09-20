import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useState } from "react";

export interface NotificationPrefs {
  newCase: boolean;
  incomingCall: boolean;
  transcriptDone: boolean;
  failureAlert: boolean;
}

const DEFAULT_PREFS: NotificationPrefs = {
  newCase: true,
  incomingCall: true,
  transcriptDone: true,
  failureAlert: true,
};

const KEY = "coordinator-app:notificationPrefs";

export function useNotificationPrefs() {
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_PREFS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void AsyncStorage.getItem(KEY).then((raw) => {
      if (raw) {
        try {
          setPrefs({ ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<NotificationPrefs>) });
        } catch {
          // 本地存储损坏就当没存过,用默认值——这几个开关不值得因为解析失败卡住整个设置页。
        }
      }
      setLoaded(true);
    });
  }, []);

  const update = useCallback(<K extends keyof NotificationPrefs>(key: K, value: NotificationPrefs[K]) => {
    setPrefs((prev) => {
      const next = { ...prev, [key]: value };
      void AsyncStorage.setItem(KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return { prefs, update, loaded };
}
