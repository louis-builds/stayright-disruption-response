import Constants from "expo-constants";
import { LinearGradient } from "expo-linear-gradient";
import * as Notifications from "expo-notifications";
import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { Animated, Easing, Pressable, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { changePassword, useAuth } from "../../features/auth";
import { theme } from "../../shared/theme";
import { useNotificationPrefs } from "./notificationPrefs";

function PermissionRow({ label, status }: { label: string; status: string }) {
  const granted = status === "Granted";
  return (
    <View style={styles.permissionRow}>
      <Text style={styles.permissionLabel}>{label}</Text>
      <View style={styles.permissionValue}>
        <View style={[styles.permissionDot, granted && styles.permissionDotGranted]} />
        <Text style={styles.permissionStatus}>{status}</Text>
      </View>
    </View>
  );
}

function ChangePasswordCard() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (!current) {
      setMessage({ ok: false, text: "Enter your current password" });
      return;
    }
    if (next.length < 8) {
      setMessage({ ok: false, text: "New password must be at least 8 characters" });
      return;
    }
    setSubmitting(true);
    setMessage(null);
    try {
      const res = await changePassword(current, next);
      if (res.code === 0) {
        setMessage({ ok: true, text: "Password updated" });
        setCurrent("");
        setNext("");
      } else {
        setMessage({ ok: false, text: res.message || "Update failed" });
      }
    } catch {
      setMessage({ ok: false, text: "Couldn't reach the server. Please try again." });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.cardLabel}>Change password</Text>
      <TextInput
        style={styles.input}
        placeholder="Current password"
        secureTextEntry
        autoComplete="current-password"
        textContentType="password"
        value={current}
        onChangeText={(v) => { setCurrent(v); setMessage(null); }}
      />
      <TextInput
        style={styles.input}
        placeholder="New password (min 8 characters)"
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        value={next}
        onChangeText={(v) => { setNext(v); setMessage(null); }}
      />
      {message && <Text style={message.ok ? styles.successText : styles.errorText}>{message.text}</Text>}
      <Pressable
        style={({ pressed }) => [styles.primaryButton, submitting && styles.buttonDisabled, pressed && styles.buttonPressed]}
        disabled={submitting}
        onPress={() => void submit()}
      >
        <Text style={styles.primaryButtonText}>{submitting ? "Updating…" : "Update password"}</Text>
      </Pressable>
    </View>
  );
}

export function SettingsScreen() {
  const { user, logout } = useAuth();
  const { prefs, update, loaded } = useNotificationPrefs();
  const [notifStatus, setNotifStatus] = useState("Checking…");
  const [loggingOut, setLoggingOut] = useState(false);
  const [prefsSaved, setPrefsSaved] = useState(false);
  const prefsSavedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 权限可能是员工离开去系统设置里改的，只在挂载时查一次会读到过期状态——
  // 每次这页重新拿到焦点都重新查一遍，跟 InboxScreen/HistoryScreen 轮询"数据可能已经变了"是同一个道理。
  useFocusEffect(
    useCallback(() => {
      void Notifications.getPermissionsAsync().then((r) => setNotifStatus(r.granted ? "Granted" : "Not granted"));
    }, []),
  );

  function updatePref<K extends keyof typeof prefs>(key: K, value: (typeof prefs)[K]) {
    update(key, value);
    setPrefsSaved(true);
    if (prefsSavedTimer.current) clearTimeout(prefsSavedTimer.current);
    prefsSavedTimer.current = setTimeout(() => setPrefsSaved(false), 1500);
  }

  // 本页没有整屏 loading 态(profile/password/permission/about 卡片都立即渲染真实内容)，
  // 挂载动画照 PermissionsScreen/LoginScreen 的约定纯 mount 触发；notificationPrefs 的
  // AsyncStorage 读只门控 Notifications 卡片内的 3 行 switch,不该拖住整页淡入。
  const entrance = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(entrance, { toValue: 1, duration: 450, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [entrance]);

  const initials = (user?.nickname ?? "H").slice(0, 1).toUpperCase();
  const appVersion = Constants.expoConfig?.version ?? "—";

  return (
    <LinearGradient colors={[theme.background, theme.accentSoft, theme.background]} locations={[0, 0.4, 1]} style={styles.screen}>
      <Animated.ScrollView
        style={{ opacity: entrance, transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }}
        contentContainerStyle={styles.content}
      >
        <View style={styles.card}>
          <View style={styles.profileRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials}</Text>
            </View>
            <View>
              <Text style={styles.name}>{user?.nickname ?? "Hotel staff"}</Text>
              <Text style={styles.email}>{user?.email}</Text>
              {!!user?.phone && <Text style={styles.email}>{user.phone}</Text>}
            </View>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>Notifications</Text>
          {loaded && (
            <>
              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>New inquiry</Text>
                <Switch value={prefs.newInquiry} onValueChange={(v) => updatePref("newInquiry", v)} />
              </View>
              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>Guest confirmed an option</Text>
                <Switch value={prefs.guestConfirmedOption} onValueChange={(v) => updatePref("guestConfirmedOption", v)} />
              </View>
              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>Policy processing updates</Text>
                <Switch value={prefs.policyProcessing} onValueChange={(v) => updatePref("policyProcessing", v)} />
              </View>
              {prefsSaved && <Text style={styles.successText}>Saved</Text>}
            </>
          )}
        </View>

        <ChangePasswordCard />

        <View style={styles.card}>
          <Text style={styles.cardLabel}>Permission status</Text>
          <PermissionRow label="Notifications" status={notifStatus} />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>About</Text>
          <Text style={styles.aboutText}>App version {appVersion}</Text>
        </View>

        <Pressable
          style={({ pressed }) => [styles.logoutButton, loggingOut && styles.buttonDisabled, pressed && styles.buttonPressed]}
          disabled={loggingOut}
          onPress={async () => {
            setLoggingOut(true);
            await logout();
          }}
        >
          <Text style={styles.logoutButtonText}>{loggingOut ? "Signing out…" : "Sign out"}</Text>
        </Pressable>
      </Animated.ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.background },
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  card: { backgroundColor: theme.surface, borderRadius: 14, padding: 16, gap: 10, borderWidth: 1, borderColor: theme.borderLight },
  profileRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: theme.accentSoft, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 20, fontWeight: "800", color: theme.accent },
  name: { fontSize: 17, fontWeight: "800", color: theme.ink },
  email: { fontSize: 12, color: theme.muted },
  cardLabel: { fontSize: 14, fontWeight: "800", color: theme.ink },
  switchRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  switchLabel: { fontSize: 13, color: theme.mutedDark },
  input: { borderWidth: 1, borderColor: theme.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, color: theme.ink, textAlignVertical: "center" },
  successText: { color: theme.success, fontSize: 12, fontWeight: "600" },
  errorText: { color: theme.danger, fontSize: 12, fontWeight: "600" },
  primaryButton: { backgroundColor: theme.accent, borderRadius: 8, paddingVertical: 11, alignItems: "center" },
  primaryButtonText: { color: theme.surface, fontWeight: "700", fontSize: 13 },
  buttonDisabled: { opacity: 0.5 },
  buttonPressed: { opacity: 0.7 },
  permissionRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  permissionLabel: { fontSize: 13, color: theme.mutedDark },
  permissionValue: { flexDirection: "row", alignItems: "center", gap: 6 },
  permissionDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: theme.border },
  permissionDotGranted: { backgroundColor: theme.success },
  permissionStatus: { fontSize: 12, color: theme.muted, fontWeight: "600" },
  aboutText: { fontSize: 13, color: theme.muted },
  logoutButton: { backgroundColor: theme.danger, borderRadius: 10, paddingVertical: 14, alignItems: "center", marginTop: 12 },
  logoutButtonText: { color: theme.surface, fontWeight: "700", fontSize: 15 },
});
