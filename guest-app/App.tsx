import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { ActivityIndicator, Platform, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { enableScreens } from "react-native-screens";
import { AuthProvider } from "./src/features/auth";
import { CallProvider } from "./src/features/calls/CallProvider";
import { RootNavigator } from "./src/navigation/RootNavigator";
import { loadServerUrlOverride } from "./src/shared/api/client";

if (Platform.OS === "web") {
  enableScreens(false);
  if (typeof window !== "undefined") {
    const pinViewport = () => {
      const h = `${window.innerHeight}px`;
      document.documentElement.style.height = h;
      document.documentElement.style.maxHeight = h;
      document.body.style.height = h;
      document.body.style.maxHeight = h;
      document.body.style.overflow = "hidden";
      document.body.style.margin = "0";
      const root = document.getElementById("root");
      if (root) {
        root.style.height = h;
        root.style.maxHeight = h;
        root.style.overflow = "hidden";
        root.style.display = "flex";
        root.style.flexDirection = "column";
      }
    };
    pinViewport();
    window.addEventListener("resize", pinViewport);
    if (!document.getElementById("stayright-guest-tabs")) {
      const style = document.createElement("style");
      style.id = "stayright-guest-tabs";
      style.textContent = `
        #guest-tabbar {
          position: fixed !important;
          left: 0 !important;
          right: 0 !important;
          bottom: 0 !important;
          z-index: 2147483647 !important;
          background: #fff !important;
        }
      `;
      document.head.appendChild(style);
    }
  }
}

export default function App() {
  const [configReady, setConfigReady] = useState(false);
  useEffect(() => {
    void loadServerUrlOverride().finally(() => setConfigReady(true));
  }, []);

  if (!configReady) {
    return (
      <SafeAreaProvider style={{ flex: 1 }}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator size="large" />
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider style={{ flex: 1 }}>
      <View style={{ flex: 1 }}>
        <AuthProvider>
          <CallProvider><RootNavigator /></CallProvider>
        </AuthProvider>
      </View>
      <StatusBar style="auto" />
    </SafeAreaProvider>
  );
}
