import { StatusBar } from "expo-status-bar";
import { Platform, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { enableScreens } from "react-native-screens";
import { AuthProvider } from "./src/features/auth";
import { CallProvider } from "./src/features/calls/CallProvider";
import { RootNavigator } from "./src/navigation/RootNavigator";
import { OfflineBanner } from "./src/shared/network/OfflineBanner";

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
  }
}

export default function App() {
  return (
    <SafeAreaProvider style={{ flex: 1 }}>
      <View style={{ flex: 1 }}>
        <OfflineBanner />
        <AuthProvider>
          <CallProvider><RootNavigator /></CallProvider>
        </AuthProvider>
      </View>
      <StatusBar style="auto" />
    </SafeAreaProvider>
  );
}
