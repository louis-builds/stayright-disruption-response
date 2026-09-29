import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { isMobileLayout, subscribeMobileLayout } from "./mobileLayout";

const MobileLayoutContext = createContext(false);

export function MobileLayoutProvider({ children }: { children: ReactNode }) {
  const [isMobile, setIsMobile] = useState(isMobileLayout);

  useEffect(() => subscribeMobileLayout(setIsMobile), []);

  useEffect(() => {
    document.documentElement.classList.toggle("m-site", isMobile);
    return () => document.documentElement.classList.remove("m-site");
  }, [isMobile]);

  return <MobileLayoutContext.Provider value={isMobile}>{children}</MobileLayoutContext.Provider>;
}

export function useMobileLayout(): boolean {
  return useContext(MobileLayoutContext);
}
