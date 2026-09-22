import { getRecordingPermissionsAsync } from "expo-audio";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { useEffect, useRef, useState } from "react";
import { Animated, AppState, Easing, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { changePassword, useAuth } from "../auth";
import { getMediaLibraryAudioPermission } from "../auth/mediaPermissions";
import { getCallsConfig } from "../calls/api";
import { hasAllFilesAccess, requestAllFilesAccess } from "../calls/findLatestRecording";
import type { CallsConfig } from "../calls/types";
import { BASE_URL } from "../../shared/api/client";
import { useNotificationPrefs } from "./notificationPrefs";

// 通用功能优化需求.txt 的分页/搜索/图表几条对设置页不适用(单用户配置页,没有列表可分页/搜索),
// 跳过不硬加。

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
  const messageFade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    messageFade.setValue(0);
    if (message) Animated.timing(messageFade, { toValue: 1, duration: 250, useNativeDriver: true }).start();
  }, [message, messageFade]);

  async function submit() {
    if (!current || next.length < 8) {
      setMessage({ ok: false, text: "New password must be at least 8 characters" });
      return;
    }
    setSubmitting(true);
    setMessage(null);
    const res = await changePassword(current, next);
    if (res.code === 0) {
      setMessage({ ok: true, text: "Password updated" });
      setCurrent("");
      setNext("");
    } else {
      setMessage({ ok: false, text: res.message || "Update failed" });
    }
    setSubmitting(false);
  }

  return (
    <View style={styles.card}>
      <Text style={styles.cardLabel}>Change Password</Text>
      <TextInput style={styles.input} placeholder="Current password" secureTextEntry value={current} onChangeText={setCurrent} />
      <TextInput style={styles.input} placeholder="New password (min 8 characters)" secureTextEntry value={next} onChangeText={setNext} />
      {message && (
        <Animated.Text style={[message.ok ? styles.successText : styles.errorText, { opacity: messageFade }]}>{message.text}</Animated.Text>
      )}
      <Pressable
        style={({ pressed }) => [styles.primaryButton, submitting && styles.buttonDisabled, pressed && !submitting && styles.primaryButtonPressed]}
        disabled={submitting}
        onPress={() => void submit()}
      >
        <Text style={styles.primaryButtonText}>{submitting ? "Updating…" : "Update Password"}</Text>
      </Pressable>
    </View>
  );
}

export function SettingsScreen() {
  const { user, logout } = useAuth();
  const { prefs, update, loaded } = useNotificationPrefs();
  const [micStatus, setMicStatus] = useState("Checking…");
  const [notifStatus, setNotifStatus] = useState("Checking…");
  const [mediaStatus, setMediaStatus] = useState("Checking…");
  const [filesStatus, setFilesStatus] = useState("Checking…");
  const [callsConfig, setCallsConfig] = useState<CallsConfig | null>(null);
  const entrance = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const refresh = () => {
      void getRecordingPermissionsAsync().then((r) => setMicStatus(r.granted ? "Granted" : "Not granted"));
      void Notifications.getPermissionsAsync().then((r) => setNotifStatus(r.granted ? "Granted" : "Not granted"));
      void getMediaLibraryAudioPermission().then((r) => setMediaStatus(r.granted ? "Granted" : "Not granted"));
      setFilesStatus(hasAllFilesAccess() ? "Granted" : "Not granted");
    };
    refresh();
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") refresh();
    });
    void getCallsConfig().then((res) => {
      if (res.code === 0) setCallsConfig(res.data);
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    Animated.timing(entrance, { toValue: 1, duration: 350, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [entrance]);

  const initials = (user?.nickname ?? "C").slice(0, 1).toUpperCase();

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Animated.View style={{ opacity: entrance, gap: 12 }}>
      <View style={styles.card}>
        <View style={styles.profileRow}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <View>
            <Text style={styles.name}>{user?.nickname ?? "Coordinator"}</Text>
            <Text style={styles.email}>{user?.email}</Text>
            <Text style={styles.email}>{user?.phone}</Text>
          </View>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Notifications</Text>
        {loaded && (
          <>
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>New escalated case</Text>
              <Switch value={prefs.newCase} onValueChange={(v) => update("newCase", v)} />
            </View>
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Incoming call</Text>
              <Switch value={prefs.incomingCall} onValueChange={(v) => update("incomingCall", v)} />
            </View>
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Transcript / summary ready</Text>
              <Switch value={prefs.transcriptDone} onValueChange={(v) => update("transcriptDone", v)} />
            </View>
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Failure alerts</Text>
              <Switch value={prefs.failureAlert} onValueChange={(v) => update("failureAlert", v)} />
            </View>
          </>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Calling</Text>
        <Text style={styles.aboutText}>
          Dialer: {callsConfig?.dialer ?? "…"} · Recordings: {callsConfig?.recordingStore ?? "…"}
        </Text>
        <Text style={styles.aboutText}>API: {BASE_URL}</Text>
        <Text style={styles.aboutText}>
          Change CALLS_DIALER / CALLS_RECORDING_STORE in the server .env. Twilio needs a paid account for NZ numbers.
        </Text>
      </View>

      <ChangePasswordCard />

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Permission Status</Text>
        <PermissionRow label="Microphone" status={micStatus} />
        <PermissionRow label="Media library" status={mediaStatus} />
        <Pressable
          style={({ pressed }) => pressed && { opacity: 0.6 }}
          onPress={() => {
            void requestAllFilesAccess().then(() => {
              setFilesStatus(hasAllFilesAccess() ? "Granted" : "Not granted");
            });
          }}
        >
          <PermissionRow label="All files access" status={filesStatus} />
        </Pressable>
        <PermissionRow label="Notifications" status={notifStatus} />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>About</Text>
        <Text style={styles.aboutText}>App version {Constants.expoConfig?.version ?? "—"}</Text>
      </View>

      <Pressable style={({ pressed }) => [styles.logoutButton, pressed && styles.logoutButtonPressed]} onPress={() => void logout()}>
        <Text style={styles.logoutButtonText}>Sign Out</Text>
      </Pressable>
      </Animated.View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f1f5f9" },
  content: { padding: 12, gap: 12, paddingBottom: 40 },
  card: { backgroundColor: "#fff", borderRadius: 12, padding: 14, gap: 10 },
  profileRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: "#eef2ff", alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 18, fontWeight: "800", color: "#4f46e5" },
  name: { fontSize: 18, fontWeight: "700", color: "#0f172a" },
  email: { fontSize: 12, color: "#64748b" },
  cardLabel: { fontSize: 13, fontWeight: "700", color: "#0f172a" },
  switchRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  switchLabel: { fontSize: 12, color: "#334155" },
  input: { borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 12 },
  successText: { color: "#0f766e", fontSize: 11 },
  errorText: { color: "#dc2626", fontSize: 11 },
  primaryButton: { backgroundColor: "#4f46e5", borderRadius: 8, paddingVertical: 10, alignItems: "center" },
  primaryButtonPressed: { backgroundColor: "#4338ca" },
  primaryButtonText: { color: "#fff", fontWeight: "700", fontSize: 12 },
  buttonDisabled: { opacity: 0.5 },
  permissionRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  permissionLabel: { fontSize: 12, color: "#334155" },
  permissionValue: { flexDirection: "row", alignItems: "center", gap: 6 },
  permissionDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#cbd5e1" },
  permissionDotGranted: { backgroundColor: "#22c55e" },
  permissionStatus: { fontSize: 12, color: "#64748b", fontWeight: "600" },
  aboutText: { fontSize: 12, color: "#64748b" },
  logoutButton: { backgroundColor: "#dc2626", borderRadius: 10, paddingVertical: 14, alignItems: "center" },
  logoutButtonPressed: { backgroundColor: "#b91c1c" },
  logoutButtonText: { color: "#fff", fontWeight: "700", fontSize: 15 },
});
