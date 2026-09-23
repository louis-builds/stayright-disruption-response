import { requestRecordingPermissionsAsync } from "expo-audio";
import * as Notifications from "expo-notifications";
import { hasAllFilesAccess, requestAllFilesAccess } from "../calls/findLatestRecording";
import { requestMediaLibraryAudioPermission } from "./mediaPermissions";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, AppState, Easing, Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";

// 通用功能优化需求.txt 的分页/搜索/图表/通知机制几条对权限引导页不适用(这页本身就是
// 一次性引导流程，不是数据列表)，跳过不硬加。

type PermissionState = "unknown" | "granted" | "denied";

function statusLabel(state: PermissionState) {
  if (state === "granted") return "Granted";
  if (state === "denied") return "Denied";
  return "Not requested";
}

function PermissionRow({
  icon,
  title,
  description,
  state,
  requesting,
  onRequest,
}: {
  icon: string;
  title: string;
  description: string;
  state: PermissionState;
  requesting: boolean;
  onRequest: () => void;
}) {
  const bump = useRef(new Animated.Value(1)).current;
  const prevState = useRef(state);
  useEffect(() => {
    if (state === "granted" && prevState.current !== "granted") {
      bump.setValue(0.7);
      Animated.spring(bump, { toValue: 1, useNativeDriver: true, friction: 4 }).start();
    }
    prevState.current = state;
  }, [state, bump]);

  return (
    <View style={styles.row}>
      <Animated.View style={[styles.rowIcon, state === "granted" && styles.rowIconGranted, { transform: [{ scale: bump }] }]}>
        <Text style={styles.rowIconText}>{icon}</Text>
      </Animated.View>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowDesc}>{description}</Text>
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, state === "granted" && styles.statusDotGranted, state === "denied" && styles.statusDotDenied]} />
          <Text style={styles.rowStatus}>{statusLabel(state)}</Text>
        </View>
        {state === "denied" && (
          <Pressable onPress={() => Linking.openSettings()} style={({ pressed }) => pressed && styles.pressedDim}>
            <Text style={styles.settingsLink}>Open system settings to enable →</Text>
          </Pressable>
        )}
      </View>
      <Pressable
        style={({ pressed }) => [styles.actionButton, pressed && styles.actionButtonPressed]}
        onPress={onRequest}
        disabled={requesting}
      >
        {requesting ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={styles.actionButtonText}>{state === "unknown" ? "Request" : "Retry"}</Text>
        )}
      </Pressable>
    </View>
  );
}

export function PermissionsScreen({ onContinue }: { onContinue: () => void }) {
  const [micState, setMicState] = useState<PermissionState>("unknown");
  const [notifState, setNotifState] = useState<PermissionState>("unknown");
  const [mediaState, setMediaState] = useState<PermissionState>("unknown");
  const [filesState, setFilesState] = useState<PermissionState>("unknown");
  const [requestingMic, setRequestingMic] = useState(false);
  const [requestingNotif, setRequestingNotif] = useState(false);
  const [requestingMedia, setRequestingMedia] = useState(false);

  const refreshFilesAccess = useCallback(() => {
    if (Platform.OS !== "android") return;
    setFilesState(hasAllFilesAccess() ? "granted" : "denied");
  }, []);

  useEffect(() => {
    refreshFilesAccess();
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") refreshFilesAccess();
    });
    return () => sub.remove();
  }, [refreshFilesAccess]);

  const entrance = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(entrance, { toValue: 1, duration: 450, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [entrance]);

  const requestMic = useCallback(async () => {
    setRequestingMic(true);
    try {
      const { status } = await requestRecordingPermissionsAsync();
      setMicState(status === "granted" ? "granted" : "denied");
    } finally {
      setRequestingMic(false);
    }
  }, []);

  const requestMedia = useCallback(async () => {
    setRequestingMedia(true);
    try {
      const { status } = await requestMediaLibraryAudioPermission();
      setMediaState(status === "granted" ? "granted" : "denied");
    } finally {
      setRequestingMedia(false);
    }
  }, []);

  const requestNotifications = useCallback(async () => {
    setRequestingNotif(true);
    try {
      const { status } = await Notifications.requestPermissionsAsync();
      setNotifState(status === "granted" ? "granted" : "denied");
    } finally {
      setRequestingNotif(false);
    }
  }, []);

  return (
    <View style={styles.screen}>
      <Animated.View
        style={{ opacity: entrance, transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }}
      >
        <Text style={styles.title}>These permissions are needed to get started</Text>

        <PermissionRow
          icon="🎙️"
          title="Microphone"
          description="Used for calls to guests/hotels. Without it, you cannot place a call."
          state={micState}
          requesting={requestingMic}
          onRequest={() => void requestMic()}
        />
        <PermissionRow
          icon="🎧"
          title="Media library"
          description="Used to pick up the latest system call recording after you hang up."
          state={mediaState}
          requesting={requestingMedia}
          onRequest={() => void requestMedia()}
        />
        {Platform.OS === "android" && (
          <PermissionRow
            icon="📁"
            title="All files"
            description="Xiaomi stores call recordings in MIUI/sound_recorder. Android needs all-files access to read that folder."
            state={filesState}
            requesting={false}
            onRequest={() => {
              void requestAllFilesAccess().then(refreshFilesAccess);
            }}
          />
        )}
        <PermissionRow
          icon="🔔"
          title="Notifications"
          description="Needed for new-case, incoming-call, and transcript-ready alerts."
          state={notifState}
          requesting={requestingNotif}
          onRequest={() => void requestNotifications()}
        />
      </Animated.View>

      <Pressable style={({ pressed }) => [styles.continueButton, pressed && styles.continueButtonPressed]} onPress={onContinue}>
        <Text style={styles.continueButtonText}>Continue</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 24, paddingTop: 64, backgroundColor: "#f8fafc", gap: 20 },
  title: { fontSize: 20, fontWeight: "700", color: "#0f172a", marginBottom: 16 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 12, backgroundColor: "#fff", borderRadius: 12, padding: 16, marginBottom: 12 },
  rowIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: "#f1f5f9", alignItems: "center", justifyContent: "center" },
  rowIconGranted: { backgroundColor: "#dcfce7" },
  rowIconText: { fontSize: 16 },
  rowText: { flex: 1, gap: 4 },
  rowTitle: { fontSize: 15, fontWeight: "700", color: "#0f172a" },
  rowDesc: { fontSize: 12, color: "#64748b" },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#cbd5e1" },
  statusDotGranted: { backgroundColor: "#22c55e" },
  statusDotDenied: { backgroundColor: "#ef4444" },
  rowStatus: { fontSize: 12, color: "#334155" },
  settingsLink: { fontSize: 12, color: "#4f46e5", fontWeight: "600", marginTop: 4 },
  pressedDim: { opacity: 0.5 },
  actionButton: { backgroundColor: "#4f46e5", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8, minWidth: 64, alignItems: "center" },
  actionButtonPressed: { backgroundColor: "#4338ca" },
  actionButtonText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  continueButton: { marginTop: "auto", backgroundColor: "#0f172a", borderRadius: 10, paddingVertical: 14, alignItems: "center" },
  continueButtonPressed: { backgroundColor: "#1e293b" },
  continueButtonText: { color: "#fff", fontWeight: "700", fontSize: 15 },
});
