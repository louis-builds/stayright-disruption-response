import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { getBaseUrl, setServerUrlOverride } from "../../shared/api/client";

// 登录前(ServerGateScreen)和登录后的引导页(PermissionsScreen)都要能改服务器地址——
// 前者解决"第一次打开、地址就是错的、连登录都发不出去"，后者解决"用了一段时间后网络变了"。
// 两处共用同一份 UI/逻辑，不重复写。
export function ServerAddressCard({ onSaved }: { onSaved?: (url: string) => void }) {
  const [serverUrl, setServerUrl] = useState(() => getBaseUrl());
  const [serverTest, setServerTest] = useState<"idle" | "testing" | "ok" | "unreachable">("idle");

  const saveServerUrl = useCallback(async () => {
    const url = serverUrl.trim();
    setServerTest("testing");
    await setServerUrlOverride(url || null);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      await fetch(`${getBaseUrl()}/api/auth/me`, { signal: controller.signal });
      clearTimeout(timeout);
      setServerTest("ok");
      onSaved?.(url);
    } catch {
      setServerTest("unreachable");
    }
  }, [serverUrl, onSaved]);

  return (
    <View style={styles.row}>
      <View style={styles.rowIcon}>
        <Text style={styles.rowIconText}>🌐</Text>
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>Backend server</Text>
        <Text style={styles.rowDesc}>Point the app at your backend — useful when your laptop's IP or network changes.</Text>
        <TextInput
          style={styles.serverInput}
          value={serverUrl}
          onChangeText={(text) => {
            setServerUrl(text);
            setServerTest("idle");
          }}
          placeholder="http://192.168.1.10:5080"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        {serverTest === "ok" && <Text style={styles.serverOk}>Reachable</Text>}
        {serverTest === "unreachable" && <Text style={styles.serverFail}>Could not reach this address</Text>}
      </View>
      <Pressable
        style={({ pressed }) => [styles.actionButton, pressed && styles.actionButtonPressed]}
        onPress={() => void saveServerUrl()}
        disabled={serverTest === "testing"}
      >
        {serverTest === "testing" ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.actionButtonText}>Save</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start", gap: 12, backgroundColor: "#fff", borderRadius: 12, padding: 16 },
  rowIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: "#f1f5f9", alignItems: "center", justifyContent: "center" },
  rowIconText: { fontSize: 16 },
  rowText: { flex: 1, gap: 4 },
  rowTitle: { fontSize: 15, fontWeight: "700", color: "#0f172a" },
  rowDesc: { fontSize: 12, color: "#64748b" },
  serverInput: { marginTop: 8, borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, color: "#0f172a", backgroundColor: "#f8fafc" },
  serverOk: { fontSize: 12, color: "#16a34a", fontWeight: "600", marginTop: 4 },
  serverFail: { fontSize: 12, color: "#dc2626", fontWeight: "600", marginTop: 4 },
  actionButton: { backgroundColor: "#7628e8", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8, minWidth: 64, alignItems: "center" },
  actionButtonPressed: { backgroundColor: "#6220ca" },
  actionButtonText: { color: "#fff", fontSize: 12, fontWeight: "700" },
});
