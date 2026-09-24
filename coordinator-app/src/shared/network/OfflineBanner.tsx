import { StyleSheet, Text, View } from "react-native";
import { useNetworkStatus } from "./useNetworkStatus";

// 挂在导航容器上方的全局横幅——断网时任何页面都能看到,不用每个页面各自判断要不要显示。
export function OfflineBanner() {
  const isOnline = useNetworkStatus();
  if (isOnline) return null;

  return (
    <View style={styles.banner}>
      <Text style={styles.text}>No internet connection — calls and messages are unavailable</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { backgroundColor: "#dc2626", paddingVertical: 6, alignItems: "center" },
  text: { color: "#fff", fontSize: 11, fontWeight: "700" },
});
