import NetInfo from "@react-native-community/netinfo";
import { useEffect, useState } from "react";

export function useNetworkStatus() {
  // isConnected 初始给 true——冷启动那一瞬间 NetInfo 还没回第一次结果时，
  // 不该让所有按钮先闪一下"离线禁用"的样子。
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      setIsOnline(state.isConnected !== false);
    });
    return () => unsubscribe();
  }, []);

  return isOnline;
}
