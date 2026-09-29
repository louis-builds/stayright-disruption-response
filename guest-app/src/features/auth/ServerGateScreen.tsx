import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Pressable } from "react-native";
import { ServerAddressCard } from "./ServerAddressCard";

// 登录页在 RootNavigator 里排在这个 App 自己的引导页(PermissionsScreen)之前——那是
// 因为通知权限的推送 token 注册需要登录态,故意这么排的(见 PermissionsScreen 顶部注释)。
// 但服务器地址跟登录态无关,而且地址填错了连登录请求都发不出去——所以单独切一个只管这一件事、
// 排在登录之前的极简步骤,只在"从没确认过地址"的第一次打开时出现,确认过一次后面就不再挡路,
// 直接进正常的登录流程。
export function ServerGateScreen({ onContinue }: { onContinue: () => void }) {
  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.centerWrap}>
        <Text style={styles.title}>Before you sign in</Text>
        <Text style={styles.subtitle}>Set the address of the backend this app should talk to. You can change this again later from the notifications step.</Text>
        <ServerAddressCard onSaved={onContinue} />
        <Pressable onPress={onContinue} style={({ pressed }) => [styles.skipButton, pressed && styles.skipButtonPressed]}>
          <Text style={styles.skipButtonText}>Use this address and continue</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f8fafc" },
  centerWrap: { flexGrow: 1, justifyContent: "center", padding: 24, gap: 16 },
  title: { fontSize: 20, fontWeight: "700", color: "#0f172a", marginBottom: 4 },
  subtitle: { fontSize: 13, color: "#64748b", marginBottom: 8 },
  skipButton: { backgroundColor: "#0f172a", borderRadius: 10, paddingVertical: 14, alignItems: "center", marginTop: 8 },
  skipButtonPressed: { backgroundColor: "#1e293b" },
  skipButtonText: { color: "#fff", fontWeight: "700", fontSize: 15 },
});
