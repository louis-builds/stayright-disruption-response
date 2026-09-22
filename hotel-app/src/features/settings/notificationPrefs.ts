import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useState } from "react";

// 三个分类对应 PermissionsScreen.tsx 里对通知权限的说明原文("new-inquiry, guest-confirmed-option,
// and policy-processing alerts"),两处保持同一套用词,不要各写各的。
export interface NotificationPrefs {
  newInquiry: boolean;
  guestConfirmedOption: boolean;
  policyProcessing: boolean;
}

const DEFAULT_PREFS: NotificationPrefs = {
  newInquiry: true,
  guestConfirmedOption: true,
  policyProcessing: true,
};

const KEY = "hotel-app:notificationPrefs";

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
