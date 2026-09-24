import * as Notifications from "expo-notifications";
import { LinearGradient } from "expo-linear-gradient";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, Easing, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { theme } from "../../shared/theme";

// 通用功能优化需求.txt 的分页/搜索/图表/通知机制几条对权限引导页不适用(这页本身就是
// 一次性引导流程，不是数据列表)，跳过不硬加。本 App 没有通话功能，不请求麦克风权限。

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
      Animated.spring(bump, { toValue: 1, useNativeDriver: true, friction: 6 }).start();
    }
    prevState.current = state;
  }, [state, bump]);

  return (
    <View style={styles.row}>
      <Animated.View style={[styles.rowIcon, state === "granted" && styles.rowIconGranted, { transform: [{ scale: bump }] }]}>
        <Text style={styles.rowIconText} accessibilityLabel={title}>{icon}</Text>
      </Animated.View>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowDesc}>{description}</Text>
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, state === "granted" && styles.statusDotGranted, state === "denied" && styles.statusDotDenied]} />
          <Text style={styles.rowStatus} accessibilityLiveRegion="polite">{statusLabel(state)}</Text>
        </View>
        {state === "denied" && (
          <Pressable
            onPress={() => Linking.openSettings()}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={({ pressed }) => pressed && styles.pressedDim}
          >
            <Text style={styles.settingsLink}>Open system settings to enable →</Text>
          </Pressable>
        )}
      </View>
      {state !== "granted" && (
        <Pressable
          style={({ pressed }) => [styles.actionButton, requesting && styles.actionButtonDisabled, pressed && styles.actionButtonPressed]}
          onPress={onRequest}
          disabled={requesting}
        >
          {requesting ? (
            <ActivityIndicator size="small" color={theme.surface} />
          ) : (
            <Text style={styles.actionButtonText}>{state === "unknown" ? "Request" : "Check again"}</Text>
          )}
        </Pressable>
      )}
    </View>
  );
}

const NOTIFICATION_REASONS: { icon: string; label: string; detail: string }[] = [
  { icon: "📥", label: "New inquiry", detail: "A guest's disruption request lands in To-dos and needs a same-day response." },
  { icon: "✅", label: "Guest confirmed an option", detail: "A guest picked a rebooking option — you'll need to action it before check-in." },
  { icon: "📄", label: "Policy processing updates", detail: "Your uploaded refund policy has finished (or failed) AI extraction." },
];

export function PermissionsScreen({ onContinue }: { onContinue: () => void }) {
  const [notifState, setNotifState] = useState<PermissionState>("unknown");
  const [requestingNotif, setRequestingNotif] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);

  const entrance = useRef(new Animated.Value(0)).current;
  const reasonEntrance = useRef(NOTIFICATION_REASONS.map(() => new Animated.Value(0))).current;
  useEffect(() => {
    Animated.timing(entrance, { toValue: 1, duration: 450, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    Animated.stagger(
      90,
      reasonEntrance.map((v) => Animated.timing(v, { toValue: 1, duration: 350, easing: Easing.out(Easing.cubic), useNativeDriver: true })),
    ).start();
  }, [entrance, reasonEntrance]);

  const requestNotifications = useCallback(async () => {
    setRequestingNotif(true);
    setRequestError(null);
    try {
      const { status } = await Notifications.requestPermissionsAsync();
      setNotifState(status === "granted" ? "granted" : "denied");
    } catch {
      setRequestError("Couldn't check notification permission. Please try again.");
    } finally {
      setRequestingNotif(false);
    }
  }, []);

  return (
    <LinearGradient colors={[theme.background, theme.accentSoft, theme.background]} locations={[0, 0.4, 1]} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
      <Animated.View
        style={[styles.body, { opacity: entrance, transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }]}
      >
        <Text style={styles.brandLabel}>StayRight NZ</Text>
        <Text style={styles.title}>These permissions are needed to get started</Text>

        <PermissionRow
          icon="🔔"
          title="Notifications"
          description="Turn this on to get alerted the moment a guest needs you."
          state={notifState}
          requesting={requestingNotif}
          onRequest={() => void requestNotifications()}
        />
        {requestError && <Text style={styles.requestError}>{requestError}</Text>}

        <Text style={styles.sectionLabel}>What you'll be notified about</Text>
        {NOTIFICATION_REASONS.map((reason, i) => (
          <Animated.View
            key={reason.label}
            style={[
              styles.reasonRow,
              { opacity: reasonEntrance[i], transform: [{ translateY: reasonEntrance[i].interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] },
            ]}
          >
            <View style={styles.reasonIcon}>
              <Text style={styles.reasonIconText} accessibilityLabel={reason.label}>{reason.icon}</Text>
            </View>
            <View style={styles.reasonText}>
              <Text style={styles.reasonLabel}>{reason.label}</Text>
              <Text style={styles.reasonDetail}>{reason.detail}</Text>
            </View>
          </Animated.View>
        ))}

        <Text style={styles.footnote}>
          You can turn this on or off later from your phone's system settings — it won't block you from using the app either way.
        </Text>

        <Pressable style={({ pressed }) => [styles.continueButton, pressed && styles.continueButtonPressed]} onPress={onContinue}>
          <Text style={styles.continueButtonText}>Continue</Text>
        </Pressable>
      </Animated.View>
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.background },
  scrollContent: { flexGrow: 1, justifyContent: "center", padding: 24 },
  body: {},
  brandLabel: { fontSize: 12, fontWeight: "700", color: theme.accent, letterSpacing: 2, textTransform: "uppercase", marginBottom: 10 },
  title: { fontSize: 20, fontWeight: "700", color: theme.ink, marginBottom: 16 },
  requestError: { fontSize: 12, color: theme.danger, marginTop: -6, marginBottom: 12 },
  sectionLabel: { fontSize: 12, fontWeight: "700", color: theme.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 14 },
  reasonRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 20 },
  reasonIcon: { width: 32, height: 32, borderRadius: 9, backgroundColor: "#f1f5f9", alignItems: "center", justifyContent: "center" },
  reasonIconText: { fontSize: 14 },
  reasonText: { flex: 1, gap: 3 },
  reasonLabel: { fontSize: 13, fontWeight: "700", color: theme.ink },
  reasonDetail: { fontSize: 12, color: theme.muted, lineHeight: 18 },
  footnote: { fontSize: 12, color: theme.muted, marginTop: 8, lineHeight: 18 },
  row: {
    flexDirection: "row", alignItems: "flex-start", gap: 12, backgroundColor: theme.surface, borderRadius: 12, padding: 16, marginBottom: 12,
    borderWidth: 1, borderColor: theme.borderLight,
  },
  rowIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: "#f1f5f9", alignItems: "center", justifyContent: "center" },
  rowIconGranted: { backgroundColor: theme.successSoft },
  rowIconText: { fontSize: 16 },
  rowText: { flex: 1, gap: 4 },
  rowTitle: { fontSize: 15, fontWeight: "700", color: theme.ink },
  rowDesc: { fontSize: 12, color: theme.muted },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#cbd5e1" },
  statusDotGranted: { backgroundColor: theme.success },
  statusDotDenied: { backgroundColor: theme.danger },
  rowStatus: { fontSize: 12, color: theme.mutedDark },
  settingsLink: { fontSize: 12, color: theme.accent, fontWeight: "600", marginTop: 4 },
  pressedDim: { opacity: 0.5 },
  actionButton: { backgroundColor: theme.accent, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12, minWidth: 64, minHeight: 44, alignItems: "center", justifyContent: "center" },
  actionButtonPressed: { backgroundColor: theme.accentDark },
  actionButtonDisabled: { opacity: 0.6 },
  actionButtonText: { color: theme.surface, fontSize: 12, fontWeight: "700" },
  continueButton: { marginTop: 28, backgroundColor: theme.accent, borderRadius: 10, paddingVertical: 14, alignItems: "center" },
  continueButtonPressed: { backgroundColor: theme.accentDark },
  continueButtonText: { color: theme.surface, fontWeight: "700", fontSize: 15 },
});
