import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useEffect, useRef, useState } from "react";
import { Animated, AppState, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import type { CasesStackParamList } from "../../navigation/CasesStack";
import { useAppTabBarStyle } from "../../navigation/AppTabs";
import * as api from "./api";
import { disconnectVoice, setMuted as setVoiceMuted } from "./twilioVoice";
import type { Call, CallStatus } from "./types";

// 通用功能优化需求.txt 的分页/搜索/图表/通知机制几条对通话中页不适用(单次通话的
// 实时控制界面,没有列表/统计可言),跳过不硬加。

type Props = NativeStackScreenProps<CasesStackParamList, "InCall">;

const TERMINAL: CallStatus[] = ["completed", "failed", "no_answer"];

function formatDuration(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function InCallScreen({ route, navigation }: Props) {
  const { caseId, callId, calleeType } = route.params;
  const tabBarStyle = useAppTabBarStyle();
  const [call, setCall] = useState<Call | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [muted, setMuted] = useState(false);
  const [speaker, setSpeaker] = useState(false);
  const [ending, setEnding] = useState(false);
  const navigatedAway = useRef(false);
  const leftForDialer = useRef(false);
  const entrance = useRef(new Animated.Value(1)).current;
  const pulse = useRef(new Animated.Value(1)).current;
  const recordingFade = useRef(new Animated.Value(0)).current;
  const dotPulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    return () => {
      void disconnectVoice();
    };
  }, []);

  useEffect(() => {
    const parent = navigation.getParent();
    parent?.setOptions({ tabBarStyle: { display: "none" } });
    return () => parent?.setOptions({ tabBarStyle });
  }, [navigation, tabBarStyle]);

  // 通话状态轮询——Mock 状态机在服务端跑,这里只负责把真实状态显示出来,不在客户端猜。
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      const res = await api.listForCase(caseId);
      if (cancelled || res.code !== 0) return;
      const found = res.data.find((c) => c.id === callId);
      if (found) setCall(found);
    };
    void poll();
    const timer = setInterval(poll, 1200);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [caseId, callId]);

  useEffect(() => {
    if (call?.provider !== "system") return;
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "background" || next === "inactive") leftForDialer.current = true;
      if (next === "active" && leftForDialer.current && !navigatedAway.current) {
        void api.endCall(callId);
      }
    });
    return () => sub.remove();
  }, [call?.provider, callId]);

  // 计时器只在真的接通(in_progress)之后才走——connecting 阶段不算通话时长。
  useEffect(() => {
    if (call?.status !== "in_progress") return;
    const timer = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(timer);
  }, [call?.status]);

  useEffect(() => {
    if (call && TERMINAL.includes(call.status) && !navigatedAway.current) {
      navigatedAway.current = true;
      navigation.replace("CallSummary", { caseId, callId, calleeType });
    }
  }, [call, caseId, callId, calleeType, navigation]);

  async function handleEndCall() {
    setEnding(true);
    try {
      await disconnectVoice();
      await api.endCall(callId);
    } finally {
      setEnding(false);
    }
  }

  const status = call?.status ?? "connecting";
  const connectingHint = call?.provider === "system"
    ? "The phone dialer should be open. Come back when the call ends — we'll pick up the latest recording."
    : call?.voiceEnabled
      ? "Talk in this app. Allow microphone if the browser asks."
      : call?.provider === "twilio"
        ? "Your phone should ring. Answer it to reach the other party."
        : null;

  useEffect(() => {
    if (status !== "connecting") {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.4, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [status, pulse]);

  useEffect(() => {
    if (status === "in_progress") {
      Animated.timing(recordingFade, { toValue: 1, duration: 300, useNativeDriver: true }).start();
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(dotPulse, { toValue: 0.3, duration: 600, useNativeDriver: true }),
          Animated.timing(dotPulse, { toValue: 1, duration: 600, useNativeDriver: true }),
        ]),
      );
      loop.start();
      return () => loop.stop();
    }
    recordingFade.setValue(0);
  }, [status, recordingFade, dotPulse]);

  return (
    <View style={{ flex: 1, backgroundColor: "#0f172a" }}>
    <Animated.View style={[styles.screen, { opacity: entrance }]}>
      <View style={styles.top}>
        <Text style={styles.calleeLabel}>{calleeType === "guest" ? "Guest" : "Hotel"}</Text>
        <Animated.Text style={[styles.statusLabel, status === "connecting" && { opacity: pulse }]}>
          {status === "connecting"
            ? call?.provider === "system"
              ? "On your phone…"
              : call?.provider === "twilio" && !call.voiceEnabled
                ? "Ringing your phone…"
                : "Connecting…"
            : formatDuration(elapsed)}
        </Animated.Text>
        {status === "connecting" && connectingHint ? (
          <Text style={styles.hint}>{connectingHint}</Text>
        ) : null}
        {status === "in_progress" && (
          <Animated.View style={[styles.recordingBadge, { opacity: recordingFade }]}>
            <Animated.View style={[styles.recordingDot, { opacity: dotPulse }]} />
            <Text style={styles.recordingText}>Recording</Text>
          </Animated.View>
        )}
      </View>

      {call?.provider !== "system" ? (
      <View style={styles.controlsRow}>
        <Pressable
          style={({ pressed }) => [styles.controlButton, muted && styles.controlButtonActive, pressed && styles.controlButtonPressed]}
          onPress={() => {
            setMuted((v) => {
              const next = !v;
              setVoiceMuted(next);
              return next;
            });
          }}
        >
          <Text style={styles.controlIcon}>{muted ? "🔇" : "🎤"}</Text>
          <Text style={styles.controlLabel}>Mute</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.controlButton, speaker && styles.controlButtonActive, pressed && styles.controlButtonPressed]}
          onPress={() => setSpeaker((v) => !v)}
        >
          <Text style={styles.controlIcon}>🔊</Text>
          <Text style={styles.controlLabel}>Speaker</Text>
        </Pressable>
      </View>
      ) : <View />}

      <Pressable
        style={({ pressed }) => [styles.endButton, ending && styles.buttonDisabled, pressed && !ending && styles.endButtonPressed]}
        disabled={ending}
        onPress={() => void handleEndCall()}
      >
        <Text style={styles.endButtonText}>{ending ? "Ending…" : call?.provider === "system" ? "Call finished" : "End Call"}</Text>
      </Pressable>
    </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, minHeight: 480, backgroundColor: "#0f172a", alignItems: "center", justifyContent: "space-between", paddingVertical: 48, paddingHorizontal: 24 },
  top: { alignItems: "center", gap: 12 },
  calleeLabel: { color: "#94a3b8", fontSize: 14, textTransform: "uppercase", letterSpacing: 1 },
  statusLabel: { color: "#fff", fontSize: 32, fontWeight: "700" },
  hint: { color: "#94a3b8", fontSize: 13, textAlign: "center", maxWidth: 280, lineHeight: 18 },
  recordingBadge: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(220,38,38,0.15)", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  recordingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#dc2626" },
  recordingText: { color: "#fca5a5", fontSize: 12, fontWeight: "700" },
  controlsRow: { flexDirection: "row", gap: 24 },
  controlButton: { alignItems: "center", gap: 6, backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 16, paddingVertical: 16, paddingHorizontal: 20 },
  controlButtonActive: { backgroundColor: "#4f46e5" },
  controlButtonPressed: { opacity: 0.7 },
  controlIcon: { fontSize: 22 },
  controlLabel: { color: "#e2e8f0", fontSize: 11 },
  endButton: { backgroundColor: "#dc2626", borderRadius: 999, paddingVertical: 16, paddingHorizontal: 48 },
  endButtonPressed: { backgroundColor: "#b91c1c" },
  endButtonText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  buttonDisabled: { opacity: 0.5 },
});
