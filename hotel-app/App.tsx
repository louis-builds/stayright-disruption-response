import { StatusBar } from "expo-status-bar";
import { Platform, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider } from "./src/features/auth";
import { RootNavigator } from "./src/navigation/RootNavigator";
import { OfflineBanner } from "./src/shared/network/OfflineBanner";

if (Platform.OS === "web" && typeof document !== "undefined") {
  const id = "stayright-hotel-tabbar";
  if (!document.getElementById(id)) {
    const style = document.createElement("style");
    style.id = id;
    style.textContent = `
      html, body, #root { height: 100% !important; }
      /* 底部 Tab 栏在库内部就是 in-flow 的 flex 列成员(见 @react-navigation/bottom-tabs
         BottomTabBar: "position: absolute" 只在隐藏时用于占位),只要 #root 链高度收住,
         它自然贴在视口底部——千万别再给它的包裹 div 加 position: fixed,那会把栏拉出
         文档流,屏幕区 flex:1 撑满全高,末尾约一屏高的内容被栏永久盖住且滚不出来。 */
    `;
    document.head.appendChild(style);
  }
}

export default function App() {
  return (
    <SafeAreaProvider style={Platform.OS === "web" ? { flex: 1, height: "100%" } : { flex: 1 }}>
      <View style={{ flex: 1 }}>
        <OfflineBanner />
        <AuthProvider>
          <RootNavigator />
        </AuthProvider>
      </View>
      <StatusBar style="auto" />
    </SafeAreaProvider>
  );
}
