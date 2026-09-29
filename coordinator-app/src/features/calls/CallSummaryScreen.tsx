import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Animated, AppState, Pressable, StyleSheet, Text, View } from "react-native";
import type { CasesStackParamList } from "../../navigation/CasesStack";
import { useAppTabBarStyle } from "../../navigation/AppTabs";
import * as api from "./api";
import { findLatestCallRecording, requestAllFilesAccess } from "./findLatestRecording";
import { startCoordinatorCall } from "./startCoordinatorCall";
import type { Call, CalleeType, RecordingStatus } from "./types";

// 通用功能优化需求.txt 的分页/搜索/图表/通知机制几条对通话小结页不适用(单次通话的
// 结果确认页,没有列表/统计可言),跳过不硬加。

const RESULT_ICONS: Record<string, string> = {
  completed: "✓",
  failed: "✕",
  no_answer: "…",
};

type Props = NativeStackScreenProps<CasesStackParamList, "CallSummary">;

const RESULT_LABELS: Record<string, string> = {
  completed: "Connected",
  failed: "Call failed",
  no_answer: "No answer",
};

export function CallSummaryScreen({ route, navigation }: Props) {
  const { caseId, callId, calleeType } = route.params;
  const tabBarStyle = useAppTabBarStyle();
  const [call, setCall] = useState<Call | null>(null);
  const [processingStatus, setProcessingStatus] = useState<RecordingStatus | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [scanReason, setScanReason] = useState<string | null>(null);
  const [recordingTick, setRecordingTick] = useState(0);
  const pollingRecording = useRef(false);
  const autoScanned = useRef(false);
  const uploadingRef = useRef(false);
  const entrance = useRef(new Animated.Value(1)).current;
  const processingFade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const parent = navigation.getParent();
    parent?.setOptions({ tabBarStyle: { display: "none" } });
    return () => parent?.setOptions({ tabBarStyle });
  }, [navigation, tabBarStyle]);

  useEffect(() => {
    processingFade.setValue(0);
    Animated.timing(processingFade, { toValue: 1, duration: 250, useNativeDriver: true }).start();
  }, [processingStatus, processingFade]);

  useEffect(() => {
    if (call) {
      Animated.spring(entrance, { toValue: 1, useNativeDriver: true, friction: 7 }).start();
    }
  }, [call, entrance]);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      const res = await api.listForCase(caseId);
      if (cancelled || res.code !== 0) return;
      const found = res.data.find((c) => c.id === callId);
      if (found) setCall(found);
    };
    void poll();
    const timer = setInterval(poll, 1500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [caseId, callId]);

  useEffect(() => {
    if (call?.status !== "completed") return;
    pollingRecording.current = true;
    let cancelled = false;
    let misses = 0;
    const poll = async () => {
      const res = await api.getRecording(callId);
      if (cancelled) return;
      if (res.code === 0) {
        setProcessingStatus(res.data.processingStatus);
        if (res.data.processingStatus === "done") clearInterval(timer);
        return;
      }
      misses += 1;
      // WebRTC uploads from the in-call mixer first. Only fall back to the
      // Xiaomi system-recorder scan if nothing arrived after a few polls.
      if (misses >= 8 && !autoScanned.current) {
        autoScanned.current = true;
        void uploadLatestRecording();
      }
    };
    void poll();
    const timer = setInterval(poll, 1500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [call?.status, callId, recordingTick]);

  async function uploadLatestRecording() {
    if (!call || uploadingRef.current) return;
    uploadingRef.current = true;
    setUploading(true);
    setScanReason("Looking in MIUI/sound_recorder/call_rec…");
    let lastReason = "Waiting for the latest system recording.";
    try {
      for (let attempt = 1; attempt <= 8; attempt++) {
        setScanReason(`Looking in MIUI/sound_recorder/call_rec (${attempt}/8)…`);
        const found = await findLatestCallRecording(call.startedAt, call.calleePhone);
        if (found.file) {
          setScanReason("Uploading the latest recording…");
          const res = await api.uploadRecording(callId, found.file);
          if (res.code === 0) {
            pollingRecording.current = false;
            setProcessingStatus(res.data.processingStatus);
            setRecordingTick((n) => n + 1);
            setScanReason(null);
          } else {
            setScanReason(res.message || "Could not upload the recording.");
          }
          return;
        }
        lastReason = found.reason;
        setScanReason(`${lastReason} Retrying (${attempt}/8)…`);
        if (attempt < 8) await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      setScanReason(lastReason);
    } catch (error) {
      setScanReason(error instanceof Error ? error.message : "Could not find the recording.");
    } finally {
      uploadingRef.current = false;
      setUploading(false);
    }
  }

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active" && call?.status === "completed" && !processingStatus && !uploadingRef.current) {
        void uploadLatestRecording();
      }
    });
    return () => sub.remove();
  }, [call?.status, processingStatus, uploading]);

  async function handleRetry(type: CalleeType) {
    setRetrying(true);
    try {
      const res = await startCoordinatorCall(caseId, type);
      if (res.code === 0) {
        navigation.replace("InCall", { caseId, callId: res.data.id, calleeType: type });
      } else {
        Alert.alert("Call failed", res.message || "Could not start the call.");
      }
    } finally {
      setRetrying(false);
    }
  }

  if (!call) {
    return (
      <View style={styles.centerFill}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  const durationLabel = call.durationSeconds !== null ? `${call.durationSeconds}s` : "—";
  const isFailure = call.status === "failed" || call.status === "no_answer";

  return (
    <Animated.View
      style={[
        styles.screen,
        { opacity: entrance, transform: [{ scale: entrance.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }] },
      ]}
    >
      <View style={[styles.resultIcon, isFailure ? styles.resultIconFailure : styles.resultIconSuccess]}>
        <Text style={styles.resultIconText}>{RESULT_ICONS[call.status] ?? "?"}</Text>
      </View>
      <Text style={styles.resultLabel}>{RESULT_LABELS[call.status] ?? call.status}</Text>
      <Text style={styles.durationLabel}>Duration: {durationLabel}</Text>

      {call.status === "completed" && (
        <Animated.View style={[styles.processingCard, { opacity: processingFade }]}>
          {processingStatus === "done" ? (
            <>
              <Text style={styles.processingDone}>Recording processed</Text>
              <Pressable
                style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryButtonPressed]}
                onPress={() => navigation.replace("RecordingDetail", { callId })}
              >
                <Text style={styles.primaryButtonText}>View Recording</Text>
              </Pressable>
            </>
          ) : processingStatus ? (
            <>
              <ActivityIndicator />
              <Text style={styles.processingText}>Processing recording ({processingStatus})…</Text>
            </>
          ) : (
            <>
              {uploading ? <ActivityIndicator /> : null}
              <Text style={styles.processingText}>
                {scanReason ?? (uploading ? "Finding the latest system recording…" : "Waiting for the latest system recording.")}
              </Text>
              {!uploading && (
                <>
                  <Pressable
                    style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryButtonPressed]}
                    onPress={() => void uploadLatestRecording()}
                  >
                    <Text style={styles.primaryButtonText}>Scan again</Text>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [styles.secondaryButton, pressed && styles.secondaryButtonPressed]}
                    onPress={() => {
                      void requestAllFilesAccess().then(() => uploadLatestRecording());
                    }}
                  >
                    <Text style={styles.secondaryButtonText}>Grant all files access</Text>
                  </Pressable>
                </>
              )}
            </>
          )}
        </Animated.View>
      )}

      {isFailure && (
        <Pressable
          style={({ pressed }) => [styles.primaryButton, retrying && styles.buttonDisabled, pressed && !retrying && styles.primaryButtonPressed]}
          disabled={retrying}
          onPress={() => void handleRetry(calleeType)}
        >
          <Text style={styles.primaryButtonText}>{retrying ? "Calling…" : "Call Again"}</Text>
        </Pressable>
      )}

      <Pressable style={({ pressed }) => [styles.secondaryButton, pressed && styles.secondaryButtonPressed]} onPress={() => navigation.popToTop()}>
        <Text style={styles.secondaryButtonText}>Back to Case</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#f1f5f9", gap: 16, padding: 24 },
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center" },
  resultIcon: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center" },
  resultIconSuccess: { backgroundColor: "#dcfce7" },
  resultIconFailure: { backgroundColor: "#fee2e2" },
  resultIconText: { fontSize: 30, fontWeight: "800", color: "#0f172a" },
  resultLabel: { fontSize: 22, fontWeight: "700", color: "#0f172a" },
  durationLabel: { fontSize: 13, color: "#475569" },
  processingCard: { alignItems: "center", gap: 8, backgroundColor: "#fff", borderRadius: 12, padding: 16, width: "100%" },
  processingText: { fontSize: 12, color: "#64748b", textAlign: "center" },
  processingDone: { fontSize: 13, color: "#0f766e", fontWeight: "700" },
  primaryButton: { backgroundColor: "#4f46e5", borderRadius: 10, paddingVertical: 12, paddingHorizontal: 24, alignItems: "center" },
  primaryButtonPressed: { backgroundColor: "#4338ca" },
  primaryButtonText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  buttonDisabled: { opacity: 0.5 },
  secondaryButton: { paddingVertical: 10, paddingHorizontal: 24 },
  secondaryButtonPressed: { opacity: 0.6 },
  secondaryButtonText: { color: "#64748b", fontSize: 12 },
});
