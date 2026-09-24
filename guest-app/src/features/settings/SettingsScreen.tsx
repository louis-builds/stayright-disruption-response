import AsyncStorage from "@react-native-async-storage/async-storage";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, Easing, Linking, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { useAuth } from "../auth";
import type { SettingsStackParamList } from "../../navigation/SettingsStack";

// 通用功能优化需求.txt 第1、2条:设置页是纯配置列表,没有可分页/搜索的数据集合,
// 也没有值得图形化的维度——评估后都不适用,不为了凑数硬加。

type Props = NativeStackScreenProps<SettingsStackParamList, "SettingsHome">;

type NotifyCategory = "newDisruption" | "caseStatusChange" | "optionReady";

const NOTIFY_CATEGORY_KEY_PREFIX = "guest-app:notifyPref:";
const NOTIFY_CATEGORIES: { key: NotifyCategory; label: string; description: string }[] = [
  { key: "newDisruption", label: "New disruption alerts", description: "A travel disruption may affect one of your bookings." },
  { key: "caseStatusChange", label: "Case status changes", description: "Your case moves forward (hotel replies, escalation, etc.)." },
  { key: "optionReady", label: "Options ready", description: "A recovery option is ready for you to review." },
];

// 通知分类开关是设备端本地偏好(控制这台设备要不要为该类别弹通知),不是后端概念——
// 后端目前按事件类型无差别建 Notification 行,这几个开关持久化在 AsyncStorage 里就够,
// 不需要为了这个新开一张后端表/接口(YAGNI)。
export function SettingsScreen({ navigation }: Props) {
  const { user, logout } = useAuth();
  const [prefs, setPrefs] = useState<Record<NotifyCategory, boolean>>({ newDisruption: true, caseStatusChange: true, optionReady: true });
  const [notifPermission, setNotifPermission] = useState<"granted" | "denied" | "unknown">("unknown");
  const [signingOut, setSigningOut] = useState(false);

  const entrance = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(entrance, { toValue: 1, duration: 400, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [entrance]);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const entries = await Promise.all(
          NOTIFY_CATEGORIES.map(async (c) => {
            const stored = await AsyncStorage.getItem(NOTIFY_CATEGORY_KEY_PREFIX + c.key);
            return [c.key, stored === null ? true : stored === "true"] as const;
          }),
        );
        setPrefs(Object.fromEntries(entries) as Record<NotifyCategory, boolean>);

        const { status } = await Notifications.getPermissionsAsync();
        setNotifPermission(status === "granted" ? "granted" : "denied");
      })();
    }, []),
  );

  async function togglePref(key: NotifyCategory, value: boolean) {
    setPrefs((prev) => ({ ...prev, [key]: value }));
    await AsyncStorage.setItem(NOTIFY_CATEGORY_KEY_PREFIX + key, String(value));
  }

  const appVersion = Constants.expoConfig?.version ?? "1.0.0";

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await logout();
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <Animated.View style={[styles.screen, { opacity: entrance, transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }]}>
      <Pressable style={({ pressed }) => [styles.profileCard, pressed && styles.profileCardPressed]} onPress={() => navigation.navigate("Profile")}>
        <View style={styles.profileAvatar}>
          <Text style={styles.profileAvatarText}>{user?.nickname?.[0]?.toUpperCase() ?? "?"}</Text>
        </View>
        <View style={styles.profileText}>
          <Text style={styles.profileName}>{user?.nickname}</Text>
          <Text style={styles.profileEmail}>{user?.email}</Text>
        </View>
        <Text style={styles.profileChevron}>Edit profile →</Text>
      </Pressable>

      <Text style={styles.sectionTitle}>Notifications</Text>
      <View style={styles.card}>
        {NOTIFY_CATEGORIES.map((c, i) => (
          <View key={c.key} style={[styles.prefRow, i > 0 && styles.prefRowDivider]}>
            <View style={styles.prefText}>
              <Text style={styles.prefLabel}>{c.label}</Text>
              <Text style={styles.prefDescription}>{c.description}</Text>
            </View>
            <Switch value={prefs[c.key]} onValueChange={(v) => void togglePref(c.key, v)} trackColor={{ true: "#7628e8" }} />
          </View>
        ))}
      </View>

      <Text style={styles.sectionTitle}>Permissions &amp; app info</Text>
      <View style={styles.card}>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Push notifications</Text>
          <View style={styles.statusPill}>
            <View style={[styles.statusDot, notifPermission === "granted" && styles.statusDotGranted, notifPermission === "denied" && styles.statusDotDenied]} />
            <Text style={styles.statusPillText}>{notifPermission === "unknown" ? "Checking…" : notifPermission === "granted" ? "Granted" : "Denied"}</Text>
          </View>
        </View>
        <View style={[styles.infoRow, styles.prefRowDivider]}>
          <Text style={styles.infoLabel}>App version</Text>
          <Text style={styles.infoValue}>{appVersion}</Text>
        </View>
      </View>

      {/* 通用功能优化需求.txt 第4条:客人遇到应用问题时的联系入口——参考 Web 端 Footer 已经在用的
         真实支持邮箱,用 mailto: 打开系统邮件App,不是装饰性占位。 */}
      <Pressable
        style={({ pressed }) => [styles.supportRow, pressed && styles.pressedDim]}
        onPress={() => void Linking.openURL("mailto:support@traveldisruption.example")}
      >
        <Text style={styles.supportText}>Need help? Contact support →</Text>
      </Pressable>

      <Pressable
        style={({ pressed }) => [styles.logoutButton, pressed && !signingOut && styles.logoutButtonPressed]}
        onPress={() => void handleSignOut()}
        disabled={signingOut}
      >
        {signingOut ? <ActivityIndicator color="#fff" /> : <Text style={styles.logoutButtonText}>Sign Out</Text>}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 16, gap: 16, backgroundColor: "#f8fafc" },
  pressedDim: { opacity: 0.5 },
  profileCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#fff", borderRadius: 14, padding: 16 },
  profileCardPressed: { backgroundColor: "#f8fafc" },
  profileAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: "#7628e8", alignItems: "center", justifyContent: "center" },
  profileAvatarText: { color: "#fff", fontWeight: "700", fontSize: 18 },
  profileText: { flex: 1, gap: 2 },
  profileName: { fontSize: 15, fontWeight: "700", color: "#0f172a" },
  profileEmail: { fontSize: 12, color: "#64748b" },
  profileChevron: { fontSize: 12, color: "#7628e8", fontWeight: "700" },
  sectionTitle: { fontSize: 12, fontWeight: "700", color: "#64748b", letterSpacing: 0.5, textTransform: "uppercase" },
  card: { backgroundColor: "#fff", borderRadius: 14, overflow: "hidden" },
  prefRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16 },
  prefRowDivider: { borderTopWidth: 1, borderTopColor: "#f1f5f9" },
  prefText: { flex: 1, gap: 2 },
  prefLabel: { fontSize: 14, fontWeight: "600", color: "#0f172a" },
  prefDescription: { fontSize: 11, color: "#64748b" },
  infoRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16 },
  infoLabel: { fontSize: 14, color: "#0f172a", fontWeight: "600" },
  infoValue: { fontSize: 13, color: "#64748b" },
  statusPill: { flexDirection: "row", alignItems: "center", gap: 6 },
  statusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#cbd5e1" },
  statusDotGranted: { backgroundColor: "#22c55e" },
  statusDotDenied: { backgroundColor: "#ef4444" },
  statusPillText: { fontSize: 12, color: "#334155", fontWeight: "600" },
  supportRow: { alignItems: "center", paddingVertical: 4 },
  supportText: { fontSize: 13, color: "#7628e8", fontWeight: "600" },
  logoutButton: { marginTop: 8, backgroundColor: "#dc2626", borderRadius: 10, paddingVertical: 14, alignItems: "center" },
  logoutButtonPressed: { backgroundColor: "#b91c1c" },
  logoutButtonText: { color: "#fff", fontWeight: "700", fontSize: 15 },
});
