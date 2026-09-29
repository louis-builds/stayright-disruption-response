import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, Easing, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { registerPushToken } from "./api";
import { EXPO_PUSH_TOKEN_KEY } from "./AuthContext";
import { ServerAddressCard } from "./ServerAddressCard";

type PermissionState = "unknown" | "granted" | "denied";

const PREVIEW_EXAMPLES = [
  { icon: "❄️", title: "New disruption alerts", body: "Heavy snow may affect your stay at Queenstown Lakeview Hotel. Tap to review your options.", time: "now" },
  { icon: "💬", title: "Case status changes", body: "Your case has been escalated to a coordinator for review.", time: "2h ago" },
  { icon: "✅", title: "Options ready", body: "3 recovery options are ready for you to review.", time: "1d ago" },
];

function statusLabel(state: PermissionState) {
  if (state === "granted") return "Granted";
  if (state === "denied") return "Denied";
  return "Not requested";
}

// 只请求通知权限——这个 App 没有麦克风/呼叫需求,权限集合比协调员App简单。
export function PermissionsScreen({ onContinue }: { onContinue: () => void }) {
  const [notifState, setNotifState] = useState<PermissionState>("unknown");
  const [requesting, setRequesting] = useState(false);

  const entrance = useRef(new Animated.Value(0)).current;
  const bump = useRef(new Animated.Value(1)).current;
  const prevState = useRef(notifState);

  useEffect(() => {
    Animated.timing(entrance, { toValue: 1, duration: 450, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [entrance]);

  useEffect(() => {
    if (notifState === "granted" && prevState.current !== "granted") {
      bump.setValue(0.7);
      Animated.spring(bump, { toValue: 1, useNativeDriver: true, friction: 4 }).start();
    }
    prevState.current = notifState;
  }, [notifState, bump]);

  const requestNotifications = useCallback(async () => {
    setRequesting(true);
    try {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== "granted") {
        setNotifState("denied");
        return;
      }
      setNotifState("granted");

      // Web 不支持 Expo push token(getExpoPushTokenAsync 在 web 上会抛错),
      // 拿不到 token 就跳过注册,不阻断权限引导流程本身。
      if (Platform.OS === "web") return;
      try {
        const { data: expoPushToken } = await Notifications.getExpoPushTokenAsync();
        await registerPushToken(expoPushToken, Platform.OS === "ios" ? "ios" : "android");
        await AsyncStorage.setItem(EXPO_PUSH_TOKEN_KEY, expoPushToken);
      } catch (err) {
        console.warn("Failed to register device for push notifications", err);
      }
    } finally {
      setRequesting(false);
    }
  }, []);

  return (
    <View style={styles.screen}>
      {/* 通用页面优化需求.txt 第6条(背景设计):这页信息量天然少,TC-P06-2 实测宽视口下
         垂直留白仍有 40%+，但这个页面的性质就是"一次性单一操作的过渡页"，硬堆更多信息
         块是为了凑数而不是为了有用——用品牌色装饰性光晕（跟登录页 brandGlow 同一视觉语言）
         把剩余留白变成有意设计的呼吸空间，而不是放着不管。 */}
      <View pointerEvents="none" style={styles.bgGlowTopLeft} />
      <View pointerEvents="none" style={styles.bgGlowBottomRight} />
      <ScrollView contentContainerStyle={styles.centerWrap}>
      <Animated.View
        style={{ opacity: entrance, transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }}
      >
        <Text style={styles.title}>Stay informed about your trip</Text>
        <Text style={styles.subtitle}>We'll let you know the moment a disruption affects your booking.</Text>

        <ServerAddressCard />

        <View style={styles.row}>
          <Animated.View style={[styles.rowIcon, notifState === "granted" && styles.rowIconGranted, { transform: [{ scale: bump }] }]}>
            <Text style={styles.rowIconText}>🔔</Text>
          </Animated.View>
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>Notifications</Text>
            <Text style={styles.rowDesc}>Needed for disruption alerts and case updates.</Text>
            <View style={styles.statusRow}>
              <View style={[styles.statusDot, notifState === "granted" && styles.statusDotGranted, notifState === "denied" && styles.statusDotDenied]} />
              <Text style={styles.rowStatus}>{statusLabel(notifState)}</Text>
            </View>
            {notifState === "denied" && (
              <Pressable onPress={() => Linking.openSettings()} style={({ pressed }) => pressed && styles.pressedDim}>
                <Text style={styles.settingsLink}>Open system settings to enable →</Text>
              </Pressable>
            )}
          </View>
          <Pressable
            style={({ pressed }) => [styles.actionButton, pressed && styles.actionButtonPressed]}
            onPress={() => void requestNotifications()}
            disabled={requesting}
          >
            {requesting ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.actionButtonText}>{notifState === "unknown" ? "Request" : "Retry"}</Text>}
          </Pressable>
        </View>

        {/* 通用页面优化需求.txt 第5条:这页只有一张权限卡片,内容天然稀薄。补真实预览卡
           而不是拿颜色/装饰凑数——让客人在授权前就看到通知长什么样,本身也是通用功能优化
           需求.txt第4条要求的"额外实用功能"。另外把整块内容+按钮从"顶部内容+marginTop:auto
           按钮"改成垂直居中布局(参考Login/Register已经验证过的做法)。
           TC-P06-2(1440×900 宽视口)实测：单条预览卡仍留出接近 60% 的垂直死区，超过测试
           用例定的 30% 上限——通用页面优化需求.txt 第5条明确要求补真实内容而不是靠背景/
           颜色糊弄。改成 3 条预览，一一对应 Settings 页真实存在的 3 个通知分类开关
           （newDisruption/caseStatusChange/optionReady，见 SettingsScreen.tsx 的
           NOTIFY_CATEGORIES），客人授权前就能看到这 3 类通知分别长什么样，不是凑数量。 */}
        <View style={styles.previewCard}>
          <Text style={styles.previewLabel}>WHAT YOU'LL SEE</Text>
          {PREVIEW_EXAMPLES.map((ex) => (
            <View key={ex.title} style={styles.previewNotice}>
              <Text style={styles.previewNoticeIcon}>{ex.icon}</Text>
              <View style={styles.previewNoticeText}>
                <Text style={styles.previewNoticeTitle}>{ex.title}</Text>
                <Text style={styles.previewNoticeBody}>{ex.body}</Text>
              </View>
              <Text style={styles.previewNoticeTime}>{ex.time}</Text>
            </View>
          ))}
          <Text style={styles.previewHint}>Alerts like this land the moment a disruption is matched to one of your bookings — usually within 15 minutes.</Text>
        </View>
      </Animated.View>

      <Pressable style={({ pressed }) => [styles.continueButton, pressed && styles.continueButtonPressed]} onPress={onContinue}>
        <Text style={styles.continueButtonText}>Continue</Text>
      </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f8fafc", overflow: "hidden" },
  bgGlowTopLeft: { position: "absolute", top: -120, left: -120, width: 320, height: 320, borderRadius: 160, backgroundColor: "#a78bfa", opacity: 0.12 },
  bgGlowBottomRight: { position: "absolute", bottom: -140, right: -140, width: 360, height: 360, borderRadius: 180, backgroundColor: "#7628e8", opacity: 0.08 },
  centerWrap: { flexGrow: 1, justifyContent: "center", padding: 24, gap: 20 },
  title: { fontSize: 20, fontWeight: "700", color: "#0f172a", marginBottom: 4 },
  subtitle: { fontSize: 13, color: "#64748b", marginBottom: 20 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 12, backgroundColor: "#fff", borderRadius: 12, padding: 16 },
  rowIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: "#f1f5f9", alignItems: "center", justifyContent: "center" },
  rowIconGranted: { backgroundColor: "#d1fae5" },
  rowIconText: { fontSize: 16 },
  rowText: { flex: 1, gap: 4 },
  rowTitle: { fontSize: 15, fontWeight: "700", color: "#0f172a" },
  rowDesc: { fontSize: 12, color: "#64748b" },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#cbd5e1" },
  statusDotGranted: { backgroundColor: "#22c55e" },
  statusDotDenied: { backgroundColor: "#ef4444" },
  rowStatus: { fontSize: 12, color: "#334155" },
  settingsLink: { fontSize: 12, color: "#7628e8", fontWeight: "600", marginTop: 4 },
  pressedDim: { opacity: 0.5 },
  actionButton: { backgroundColor: "#7628e8", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8, minWidth: 64, alignItems: "center" },
  actionButtonPressed: { backgroundColor: "#6220ca" },
  actionButtonText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  previewCard: { marginTop: 16, backgroundColor: "#fff", borderRadius: 12, padding: 16, gap: 12 },
  previewLabel: { fontSize: 11, fontWeight: "700", color: "#94a3b8", letterSpacing: 1 },
  previewNotice: { flexDirection: "row", alignItems: "flex-start", gap: 10, backgroundColor: "#f1ebff", borderRadius: 10, borderWidth: 1, borderColor: "#c9b5f2", padding: 12 },
  previewNoticeIcon: { fontSize: 18 },
  previewNoticeText: { flex: 1, gap: 2 },
  previewNoticeTitle: { fontSize: 13, fontWeight: "700", color: "#0f172a" },
  previewNoticeBody: { fontSize: 12, color: "#475569" },
  previewNoticeTime: { fontSize: 10, color: "#94a3b8" },
  previewHint: { fontSize: 12, color: "#64748b" },
  continueButton: { backgroundColor: "#0f172a", borderRadius: 10, paddingVertical: 14, alignItems: "center" },
  continueButtonPressed: { backgroundColor: "#1e293b" },
  continueButtonText: { color: "#fff", fontWeight: "700", fontSize: 15 },
});
