import { useEffect, useState } from "react";

// 通用页面优化需求.txt 第7条：数据早于0.2秒返回时也让loading多展示到满0.2秒，避免闪屏；
// 数据晚于0.2秒返回时不额外拖延，一到就显示。
export function useMinLoadingDuration(isLoading: boolean, ms = 200): boolean {
  const [floorElapsed, setFloorElapsed] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setFloorElapsed(true), ms);
    return () => clearTimeout(timer);
  }, [ms]);
  return isLoading || !floorElapsed;
}
