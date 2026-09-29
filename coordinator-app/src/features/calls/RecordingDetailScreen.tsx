import {
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
} from "expo-audio";
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Linking,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type GestureResponderEvent,
} from "react-native";
import { resolveAssetUrl } from "../../shared/api/client";
import * as api from "./api";
import type { CallRecording } from "./types";

// 通用功能优化需求.txt 的分页/搜索/图表几条对单条录音详情页不适用(单个对象的详情页,
// 没有列表可分页/搜索),跳过不硬加。

// 这个页面同时挂在 CasesStack 和 CallsStack 两棵导航树下(录音详情从案件详情和我的通话记录
// 两个入口都能进)，不跟任何一棵的 ParamList 强绑定，只依赖它真正用到的这一个参数。
type Props = { route: { params: { callId: string } } };

const RATES = [1, 1.5, 2];

function splitTranscript(text: string): string[] {
  return text
    .split(/(?<=[。！？.!?])\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function formatTime(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function RecordingPlayer({
  uri,
  onProgress,
  seekRef,
}: {
  uri: string;
  onProgress: (p: { positionMillis: number; durationMillis: number }) => void;
  seekRef: MutableRefObject<(fraction: number) => void>;
}) {
  const player = useAudioPlayer({ uri }, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);
  const [rateIndex, setRateIndex] = useState(0);
  const barWidth = useRef(0);
  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;
  const positionMillis = Math.round((status.currentTime ?? 0) * 1000);
  const durationMillis = Math.round((status.duration ?? 0) * 1000);
  const progress = durationMillis > 0 ? positionMillis / durationMillis : 0;

  useEffect(() => {
    onProgressRef.current({ positionMillis, durationMillis });
  }, [positionMillis, durationMillis]);

  useEffect(() => {
    seekRef.current = (fraction: number) => {
      if (durationMillis <= 0) return;
      void player.seekTo(Math.max(0, Math.min(1, fraction)) * (durationMillis / 1000));
    };
  }, [durationMillis, player, seekRef]);

  function handleBarPress(e: GestureResponderEvent) {
    if (barWidth.current <= 0) return;
    seekRef.current(e.nativeEvent.locationX / barWidth.current);
  }

  function cycleRate() {
    const next = (rateIndex + 1) % RATES.length;
    setRateIndex(next);
    player.playbackRate = RATES[next];
  }

  function togglePlay() {
    if (status.playing) {
      player.pause();
      return;
    }
    if (durationMillis > 0 && positionMillis >= durationMillis - 250) {
      void player.seekTo(0);
    }
    player.play();
  }

  return (
    <View style={styles.playerCard}>
      <Pressable
        style={styles.progressBar}
        onLayout={(e) => (barWidth.current = e.nativeEvent.layout.width)}
        onPress={handleBarPress}
      >
        <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
      </Pressable>
      <View style={styles.timeRow}>
        <Text style={styles.timeText}>{formatTime(positionMillis)}</Text>
        <Text style={styles.timeText}>{formatTime(durationMillis)}</Text>
      </View>
      <View style={styles.playerControls}>
        <Pressable style={({ pressed }) => [styles.rateButton, pressed && styles.rateButtonPressed]} onPress={cycleRate}>
          <Text style={styles.rateButtonText}>{RATES[rateIndex]}x</Text>
        </Pressable>
        <Pressable style={({ pressed }) => [styles.playButton, pressed && styles.playButtonPressed]} onPress={togglePlay}>
          <Text style={styles.playButtonText}>{status.playing ? "⏸ Pause" : "▶ Play"}</Text>
        </Pressable>
        <View style={styles.rateButtonSpacer} />
      </View>
    </View>
  );
}

export function RecordingDetailScreen({ route }: Props) {
  const { callId } = route.params;
  const [recording, setRecording] = useState<CallRecording | null>(null);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState("");
  const [savingNote, setSavingNote] = useState<"note" | "processed" | null>(null);
  const [keepSimple, setKeepSimple] = useState(false);
  const [speakSlowly, setSpeakSlowly] = useState(false);
  const [stayPref, setStayPref] = useState<string | null>(null);
  const [savingInsights, setSavingInsights] = useState(false);
  const [positionMillis, setPositionMillis] = useState(0);
  const [durationMillis, setDurationMillis] = useState(0);
  const seekRef = useRef<(fraction: number) => void>(() => {});
  const entrance = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!loading) {
      Animated.timing(entrance, { toValue: 1, duration: 350, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }
  }, [loading, entrance]);

  useEffect(() => {
    let cancelled = false;
    void api.getRecording(callId).then((res) => {
      if (cancelled) return;
      if (res.code === 0) {
        setRecording(res.data);
        setNote(res.data.coordinatorNote ?? "");
        applyInsightDraft(res.data);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [callId]);

  // 从"我的通话记录"直接进详情页时,转写/摘要可能还没跑完——第1轮只在挂载时拉过一次,
  // 停在 pending 就再也不会自己变成 done,这里补上轮询直到处理完成。
  const processingStatus = recording?.processingStatus;
  useEffect(() => {
    if (!processingStatus || processingStatus === "done" || processingStatus === "failed") return;
    let cancelled = false;
    const timer = setInterval(() => {
      void api.getRecording(callId).then((res) => {
        if (cancelled || res.code !== 0) return;
        setRecording((r) => (r ? { ...res.data, coordinatorNote: r.coordinatorNote } : res.data));
        if (res.data.processingStatus === "done") applyInsightDraft(res.data);
      });
    }, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [processingStatus, callId]);

  function applyInsightDraft(data: CallRecording) {
    const insights = data.insights;
    if (!insights) return;
    setKeepSimple(insights.keepMessagesSimple.applied || insights.keepMessagesSimple.suggested);
    setSpeakSlowly(insights.speakSlowly.applied || insights.speakSlowly.suggested);
    setStayPref(insights.stayPreference.applied ?? insights.stayPreference.suggested);
  }

  async function handleSaveInsights() {
    setSavingInsights(true);
    try {
      const res = await api.confirmInsights(callId, {
        keepMessagesSimple: keepSimple,
        speakSlowly,
        stayPreference: stayPref,
      });
      if (res.code === 0) {
        setRecording((r) => (r ? { ...r, ...res.data, coordinatorNote: r.coordinatorNote } : res.data));
        applyInsightDraft(res.data);
      }
    } finally {
      setSavingInsights(false);
    }
  }

  async function handleShare() {
    if (!recording?.transcriptText) return;
    await Share.share({ message: recording.transcriptText });
  }

  function handleDownload() {
    if (!recording) return;
    void Linking.openURL(resolveAssetUrl(recording.fileUrl));
  }

  async function handleSaveReview(reviewed: boolean) {
    setSavingNote(reviewed ? "processed" : "note");
    try {
      await api.reviewRecording(callId, reviewed, note.trim() || undefined);
      setRecording((r) => (r ? { ...r, reviewed, coordinatorNote: note.trim() || null } : r));
    } finally {
      setSavingNote(null);
    }
  }

  if (loading || !recording) {
    return (
      <View style={styles.centerFill}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  const sentences = recording.transcriptText ? splitTranscript(recording.transcriptText) : [];
  const perSentenceMs = sentences.length > 0 && durationMillis > 0 ? durationMillis / sentences.length : 0;
  const activeSentenceIndex = perSentenceMs > 0 ? Math.min(sentences.length - 1, Math.floor(positionMillis / perSentenceMs)) : -1;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Animated.View style={{ opacity: entrance, gap: 12 }}>
      <RecordingPlayer
        uri={resolveAssetUrl(recording.fileUrl)}
        seekRef={seekRef}
        onProgress={({ positionMillis: pos, durationMillis: dur }) => {
          setPositionMillis(pos);
          setDurationMillis(dur);
        }}
      />

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Transcript</Text>
        {sentences.length === 0 ? (
          <Text style={styles.empty}>No transcript yet</Text>
        ) : (
          sentences.map((s, i) => (
            <Pressable
              key={i}
              style={({ pressed }) => pressed && styles.transcriptLinePressed}
              onPress={() => seekRef.current((i * perSentenceMs) / (durationMillis || 1))}
            >
              <Text style={[styles.transcriptLine, i === activeSentenceIndex && styles.transcriptLineActive]}>{s}</Text>
            </Pressable>
          ))
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>AI Summary</Text>
        {recording.aiSummary ? (
          <Text style={styles.summaryText}>{recording.aiSummary}</Text>
        ) : (
          <View style={styles.summaryLoadingRow}>
            <ActivityIndicator size="small" />
            <Text style={styles.summaryText}>Generating summary ({recording.processingStatus})…</Text>
          </View>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Guest communication</Text>
        <Text style={styles.empty}>Confirm before these apply to chat, the next call, and recommendations.</Text>
        <View style={styles.switchRow}>
          <View style={styles.switchCopy}>
            <Text style={styles.switchLabel}>Keep messages simple</Text>
            {recording.insights?.keepMessagesSimple.suggested ? (
              <Text style={styles.quote}>Suggested{recording.insights.keepMessagesSimple.quote ? `: “${recording.insights.keepMessagesSimple.quote}”` : ""}</Text>
            ) : null}
          </View>
          <Switch value={keepSimple} onValueChange={setKeepSimple} />
        </View>
        <View style={styles.switchRow}>
          <View style={styles.switchCopy}>
            <Text style={styles.switchLabel}>Speak slowly</Text>
            {recording.insights?.speakSlowly.suggested ? (
              <Text style={styles.quote}>Suggested{recording.insights.speakSlowly.quote ? `: “${recording.insights.speakSlowly.quote}”` : ""}</Text>
            ) : null}
          </View>
          <Switch value={speakSlowly} onValueChange={setSpeakSlowly} />
        </View>
        <Text style={styles.switchLabel}>Stay preference</Text>
        {recording.insights?.stayPreference.suggested ? (
          <Text style={styles.quote}>Suggested: {recording.insights.stayPreference.suggested}{recording.insights.stayPreference.quote ? ` — “${recording.insights.stayPreference.quote}”` : ""}</Text>
        ) : null}
        <View style={styles.prefRow}>
          {([
            [null, "None"],
            ["cheaper", "Cheaper"],
            ["closer", "Closer"],
            ["larger", "Larger"],
          ] as const).map(([value, label]) => (
            <Pressable
              key={label}
              style={({ pressed }) => [styles.prefChip, stayPref === value && styles.prefChipOn, pressed && styles.prefChipPressed]}
              onPress={() => setStayPref(value)}
            >
              <Text style={[styles.prefChipText, stayPref === value && styles.prefChipTextOn]}>{label}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable
          style={({ pressed }) => [styles.primaryButton, savingInsights && styles.buttonDisabled, pressed && !savingInsights && styles.primaryButtonPressed]}
          disabled={savingInsights}
          onPress={() => void handleSaveInsights()}
        >
          {savingInsights ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.primaryButtonText}>Save to guest</Text>}
        </Pressable>
      </View>

      <View style={styles.actionRow}>
        <Pressable style={({ pressed }) => [styles.secondaryButton, pressed && styles.secondaryButtonPressed]} onPress={handleDownload}>
          <Text style={styles.secondaryButtonText}>Download Recording</Text>
        </Pressable>
        <Pressable style={({ pressed }) => [styles.secondaryButton, pressed && styles.secondaryButtonPressed]} onPress={() => void handleShare()}>
          <Text style={styles.secondaryButtonText}>Share Transcript</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Coordinator Note</Text>
        <TextInput style={styles.textArea} value={note} onChangeText={setNote} placeholder="Add a note…" multiline />
        <View style={styles.actionRow}>
          <Pressable
            style={({ pressed }) => [styles.secondaryButton, savingNote !== null && styles.buttonDisabled, pressed && !savingNote && styles.secondaryButtonPressed]}
            disabled={savingNote !== null}
            onPress={() => void handleSaveReview(false)}
          >
            {savingNote === "note" ? <ActivityIndicator size="small" color="#334155" /> : <Text style={styles.secondaryButtonText}>Save Note Only</Text>}
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.primaryButton, savingNote !== null && styles.buttonDisabled, pressed && !savingNote && styles.primaryButtonPressed]}
            disabled={savingNote !== null}
            onPress={() => void handleSaveReview(true)}
          >
            {savingNote === "processed" ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.primaryButtonText}>{recording.reviewed ? "Marked Processed" : "Mark Processed"}</Text>
            )}
          </Pressable>
        </View>
      </View>
      </Animated.View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f1f5f9" },
  content: { padding: 12, paddingBottom: 40 },
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center" },
  playerCard: { backgroundColor: "#0f172a", borderRadius: 12, padding: 16, gap: 10 },
  progressBar: { height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.15)", overflow: "hidden" },
  progressFill: { height: "100%", backgroundColor: "#4f46e5" },
  timeRow: { flexDirection: "row", justifyContent: "space-between" },
  timeText: { color: "#94a3b8", fontSize: 10 },
  playerControls: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12 },
  rateButton: { backgroundColor: "rgba(255,255,255,0.1)", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  rateButtonPressed: { backgroundColor: "rgba(255,255,255,0.2)" },
  rateButtonSpacer: { width: 36 },
  rateButtonText: { color: "#e2e8f0", fontSize: 11, fontWeight: "700" },
  playButton: { backgroundColor: "#4f46e5", borderRadius: 999, paddingHorizontal: 24, paddingVertical: 10 },
  playButtonPressed: { backgroundColor: "#4338ca" },
  playButtonText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  card: { backgroundColor: "#fff", borderRadius: 12, padding: 14, gap: 8 },
  cardLabel: { fontSize: 13, fontWeight: "700", color: "#0f172a" },
  empty: { color: "#94a3b8", fontSize: 12 },
  transcriptLine: { fontSize: 12, color: "#334155", paddingVertical: 4 },
  transcriptLinePressed: { opacity: 0.6 },
  transcriptLineActive: { color: "#4f46e5", fontWeight: "700", backgroundColor: "#eef2ff" },
  summaryText: { fontSize: 12, color: "#334155", lineHeight: 18 },
  summaryLoadingRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  actionRow: { flexDirection: "row", gap: 8 },
  secondaryButton: { flex: 1, backgroundColor: "#e2e8f0", borderRadius: 8, paddingVertical: 10, alignItems: "center" },
  secondaryButtonPressed: { backgroundColor: "#cbd5e1" },
  secondaryButtonText: { color: "#334155", fontWeight: "700", fontSize: 11 },
  primaryButton: { flex: 1, backgroundColor: "#4f46e5", borderRadius: 8, paddingVertical: 10, alignItems: "center" },
  primaryButtonPressed: { backgroundColor: "#4338ca" },
  primaryButtonText: { color: "#fff", fontWeight: "700", fontSize: 11 },
  buttonDisabled: { opacity: 0.5 },
  textArea: { borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 8, padding: 10, minHeight: 60, fontSize: 12, textAlignVertical: "top" },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  switchCopy: { flex: 1, gap: 4 },
  switchLabel: { fontSize: 12, fontWeight: "700", color: "#0f172a" },
  quote: { fontSize: 11, color: "#64748b", lineHeight: 16 },
  prefRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  prefChip: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: "#e2e8f0" },
  prefChipOn: { backgroundColor: "#4f46e5" },
  prefChipPressed: { opacity: 0.8 },
  prefChipText: { fontSize: 11, fontWeight: "700", color: "#334155" },
  prefChipTextOn: { color: "#fff" },
});
