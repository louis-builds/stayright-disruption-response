import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { CasesStackParamList } from "../../navigation/CasesStack";
import { listForCase } from "../calls/api";
import { startCoordinatorCall } from "../calls/startCoordinatorCall";
import type { Call, CalleeType } from "../calls/types";
import { escalationReasonLabel } from "../../shared/escalationLabels";
import { useNetworkStatus } from "../../shared/network/useNetworkStatus";
import { CLOSE_REASONS, type CaseMessage } from "./types";
import { useCaseDetail } from "./useCaseDetail";
import { OptionCard } from "../options/OptionCard";

type Props = NativeStackScreenProps<CasesStackParamList, "CaseDetail">;
type DetailPanel = "calls" | "escalation" | "chat" | "options";

const SENDER_LABEL: Record<string, string> = {
  guest: "Guest",
  ai: "StayRight AI",
  coordinator: "You",
  system: "System",
};

function formatMessageTime(iso: string) {
  return new Date(iso).toLocaleString("en-NZ", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function MessageBubble({
  message,
  onVote,
}: {
  message: CaseMessage;
  onVote: (vote: "like" | "dislike") => void;
}) {
  const isOwn = message.senderRole === "coordinator";
  const isRead = Boolean(message.readAt);
  return (
    <View style={[styles.msgRow, isOwn && styles.msgRowOwn]}>
      <View style={[styles.msgAvatar, isOwn ? styles.msgAvatarOwn : styles.msgAvatarOther]}>
        <Text style={styles.msgAvatarText}>
          {message.senderRole === "guest" ? "G" : message.senderRole === "ai" ? "AI" : message.senderRole === "coordinator" ? "Y" : "S"}
        </Text>
      </View>
      <View style={[styles.msgBody, isOwn && styles.msgBodyOwn]}>
        <View style={styles.msgMeta}>
          <Text style={styles.msgSender}>{SENDER_LABEL[message.senderRole] ?? message.senderRole}</Text>
          <Text style={styles.msgTime}>{formatMessageTime(message.createdAt)}</Text>
        </View>
        <View style={[styles.msgBubble, isOwn ? styles.msgBubbleOwn : styles.msgBubbleOther]}>
          <Text style={[styles.msgText, isOwn && styles.msgTextOwn]}>{message.content}</Text>
        </View>
        {!isOwn && (
          <Text style={[styles.msgRead, isRead ? styles.msgReadDone : styles.msgReadPending]}>{isRead ? "Read" : "Unread"}</Text>
        )}
        {message.senderRole === "ai" && (
          <View style={styles.msgVotes}>
            <Pressable
              style={({ pressed }) => [styles.voteButton, message.vote === "like" && styles.voteButtonActive, pressed && styles.buttonPressed]}
              onPress={() => onVote("like")}
            >
              <Text style={styles.voteText}>👍</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.voteButton, message.vote === "dislike" && styles.voteButtonActive, pressed && styles.buttonPressed]}
              onPress={() => onVote("dislike")}
            >
              <Text style={styles.voteText}>👎</Text>
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

function EscalationReviewCard({
  caseInfo,
  onReview,
}: {
  caseInfo: NonNullable<ReturnType<typeof useCaseDetail>["caseInfo"]>;
  onReview: (reasonable: boolean, note?: string) => Promise<void>;
}) {
  const [choice, setChoice] = useState<"reasonable" | "unreasonable" | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!caseInfo.escalationReason) return null;

  if (caseInfo.escalationReviewedAsReasonable !== null) {
    return (
      <View style={styles.card}>
        <Text style={styles.cardLabel}>Escalated: {escalationReasonLabel(caseInfo.escalationReason)}</Text>
        <Text style={styles.reviewedText}>
          {caseInfo.escalationReviewedAsReasonable ? "Reviewed: Reasonable" : `Reviewed: Not reasonable — ${caseInfo.escalationReviewNote}`}
        </Text>
      </View>
    );
  }

  const canSubmit = choice === "reasonable" || (choice === "unreasonable" && note.trim().length > 0);

  return (
    <View style={styles.card}>
      <Text style={styles.cardLabel}>Escalated: {escalationReasonLabel(caseInfo.escalationReason)}</Text>
      <Text style={styles.cardSubLabel}>Was escalating this case the right call?</Text>
      <View style={styles.choiceRow}>
        <Pressable style={({ pressed }) => [styles.choiceChip, choice === "reasonable" && styles.choiceChipActive, pressed && styles.buttonPressed]} onPress={() => setChoice("reasonable")}>
          <Text style={[styles.choiceChipText, choice === "reasonable" && styles.choiceChipTextActive]}>Reasonable</Text>
        </Pressable>
        <Pressable style={({ pressed }) => [styles.choiceChip, choice === "unreasonable" && styles.choiceChipActive, pressed && styles.buttonPressed]} onPress={() => setChoice("unreasonable")}>
          <Text style={[styles.choiceChipText, choice === "unreasonable" && styles.choiceChipTextActive]}>Not reasonable</Text>
        </Pressable>
      </View>
      {choice === "unreasonable" && (
        <TextInput style={styles.textArea} placeholder="Why wasn't this a reasonable escalation?" value={note} onChangeText={setNote} multiline />
      )}
      <Pressable
        style={({ pressed }) => [styles.primaryButton, !canSubmit && styles.buttonDisabled, pressed && !!canSubmit && styles.buttonPressed]}
        disabled={!canSubmit || submitting}
        onPress={async () => {
          setSubmitting(true);
          try {
            await onReview(choice === "reasonable", choice === "unreasonable" ? note.trim() : undefined);
          } finally {
            setSubmitting(false);
          }
        }}
      >
        <Text style={styles.primaryButtonText}>{submitting ? "Submitting…" : "Submit Review"}</Text>
      </Pressable>
    </View>
  );
}

function CloseCaseCard({ onClose }: { onClose: (reason: string, summary: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [summary, setSummary] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!open) {
    return (
      <Pressable style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]} onPress={() => setOpen(true)}>
        <Text style={styles.secondaryButtonText}>Close Case</Text>
      </Pressable>
    );
  }

  const canSubmit = reason !== null && summary.trim().length > 0;

  return (
    <View style={styles.card}>
      <Text style={styles.cardLabel}>Close Reason</Text>
      <View style={styles.choiceWrap}>
        {CLOSE_REASONS.map((r) => (
          <Pressable key={r.value} style={({ pressed }) => [styles.choiceChip, reason === r.value && styles.choiceChipActive, pressed && styles.buttonPressed]} onPress={() => setReason(r.value)}>
            <Text style={[styles.choiceChipText, reason === r.value && styles.choiceChipTextActive]}>{r.label}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput style={styles.textArea} placeholder="Result summary" value={summary} onChangeText={setSummary} multiline />
      <Pressable
        style={({ pressed }) => [styles.primaryButton, !canSubmit && styles.buttonDisabled, pressed && !!canSubmit && styles.buttonPressed]}
        disabled={!canSubmit || submitting}
        onPress={async () => {
          setSubmitting(true);
          try {
            await onClose(reason!, summary.trim());
            setOpen(false);
          } finally {
            setSubmitting(false);
          }
        }}
      >
        <Text style={styles.primaryButtonText}>{submitting ? "Submitting…" : "Confirm Close"}</Text>
      </Pressable>
    </View>
  );
}

export function CaseDetailScreen({ route, navigation }: Props) {
  const { caseId } = route.params;
  const {
    caseInfo, thread, setThread, messages, loading, sending, sendMessage, vote, markMessageRead, unreadIncomingIds,
    reviewEscalation, closeCase, options, optionsLoading, optionsBusy, regenerateOptions, pushOptions, refreshOptions,
  } = useCaseDetail(caseId);
  const [draft, setDraft] = useState("");
  const [calls, setCalls] = useState<Call[]>([]);
  const [callingType, setCallingType] = useState<CalleeType | null>(null);
  const [panel, setPanel] = useState<DetailPanel>("chat");
  const isOnline = useNetworkStatus();
  const chatScrollRef = useRef<ScrollView>(null);

  useFocusEffect(
    useCallback(() => {
      void listForCase(caseId).then((res) => {
        if (res.code === 0) setCalls(res.data);
      });
    }, [caseId]),
  );

  const unreadKey = unreadIncomingIds.join(",");
  useEffect(() => {
    if (panel !== "chat" || unreadIncomingIds.length === 0) return;
    const ids = unreadIncomingIds;
    const timer = setTimeout(() => {
      void Promise.all(ids.map((id) => markMessageRead(id)));
    }, 3000);
    return () => clearTimeout(timer);
  }, [panel, unreadKey, markMessageRead]);

  useEffect(() => {
    if (panel !== "chat") return;
    chatScrollRef.current?.scrollToEnd({ animated: false });
  }, [messages.length, panel, loading, sending]);

  async function handleCall(calleeType: CalleeType) {
    setCallingType(calleeType);
    try {
      const res = await startCoordinatorCall(caseId, calleeType);
      if (res.code === 0) navigation.navigate("InCall", { caseId, callId: res.data.id, calleeType });
      else Alert.alert("Call failed", res.message || "Could not start the call.");
    } catch {
      Alert.alert("Call failed", "Could not start the call.");
    } finally {
      setCallingType(null);
    }
  }

  if (loading || !caseInfo) {
    return (
      <View style={styles.centerFill}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  const submittedOption = options.find((o) => o.selected && o.executionRequestedAt) ?? null;
  const optionTypeOrder: Record<string, number> = { defer: 0, alternate: 1, cancel: 2, custom: 3 };
  const displayedOptions = [...(submittedOption ? [submittedOption] : options)].sort(
    (a, b) => (optionTypeOrder[a.optionType] ?? 99) - (optionTypeOrder[b.optionType] ?? 99) || a.createdAt.localeCompare(b.createdAt),
  );
  const awaitingHotel = Boolean(
    submittedOption &&
    (submittedOption.optionType === "defer" || submittedOption.optionType === "alternate") &&
    submittedOption.availability === "pending",
  );

  const header = (
    <View style={styles.headerBlock}>
      <View style={styles.card}>
        <Text style={styles.title}>{caseInfo.guestNickname ?? "Case"}</Text>
        <Text style={styles.subtitle}>{caseInfo.disruptionTitle ?? "—"} · {caseInfo.hotelName ?? "—"}</Text>
        <View style={styles.metaRow}>
          <Text style={styles.metaTag}>{caseInfo.statusLabel}</Text>
          <Text style={styles.metaTag}>{caseInfo.priority}</Text>
          {caseInfo.confirmationNo && <Text style={styles.metaText}>{caseInfo.confirmationNo}</Text>}
        </View>
        {caseInfo.checkIn && caseInfo.checkOut && (
          <Text style={styles.metaText}>{caseInfo.checkIn} → {caseInfo.checkOut}</Text>
        )}
      </View>

      <View style={styles.callRow}>
        <Pressable style={({ pressed }) => [styles.callButton, styles.callGuestButton, pressed && styles.buttonPressed]} onPress={() => void handleCall("guest")} disabled={callingType !== null || !isOnline}>
          {callingType === "guest" ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.callButtonText}>📞 Call Guest</Text>}
        </Pressable>
        <Pressable style={({ pressed }) => [styles.callButton, styles.callHotelButton, pressed && styles.buttonPressed]} onPress={() => void handleCall("hotel")} disabled={callingType !== null || !isOnline}>
          {callingType === "hotel" ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.callButtonText}>📞 Call Hotel</Text>}
        </Pressable>
      </View>

      <View style={styles.panelTabs}>
        {([
          { key: "chat" as const, label: "Chat" },
          { key: "options" as const, label: "Options" },
          { key: "calls" as const, label: "Calls" },
          ...(caseInfo.escalationReason ? [{ key: "escalation" as const, label: "Escalation" }] : []),
        ]).map((tab) => (
          <Pressable
            key={tab.key}
            style={({ pressed }) => [styles.panelTab, panel === tab.key && styles.panelTabSelected, pressed && panel !== tab.key && styles.panelTabPressed]}
            onPress={() => setPanel(tab.key)}
          >
            <Text style={[styles.panelTabText, panel === tab.key && styles.panelTabTextSelected]}>{tab.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      {header}

      {panel === "chat" && (
        <View style={styles.chatPanel}>
          <View style={styles.threadTabs}>
            <Pressable style={({ pressed }) => [styles.threadTab, thread === "coordinator" && styles.threadTabActive, pressed && thread !== "coordinator" && styles.threadTabPressed]} onPress={() => setThread("coordinator")}>
              <Text style={[styles.threadTabText, thread === "coordinator" && styles.threadTabTextActive]}>Guest</Text>
            </Pressable>
            <Pressable style={({ pressed }) => [styles.threadTab, thread === "ai" && styles.threadTabActive, pressed && thread !== "ai" && styles.threadTabPressed]} onPress={() => setThread("ai")}>
              <Text style={[styles.threadTabText, thread === "ai" && styles.threadTabTextActive]}>AI</Text>
            </Pressable>
          </View>
          <ScrollView
            ref={chatScrollRef}
            style={styles.messageList}
            contentContainerStyle={styles.messageListContent}
            keyboardShouldPersistTaps="handled"
          >
            {messages.length === 0 ? (
              <Text style={styles.empty}>No messages yet</Text>
            ) : (
              messages.map((m) => (
                <MessageBubble key={m.id} message={m} onVote={(value) => void vote(m.id, value)} />
              ))
            )}
          </ScrollView>
          {thread === "coordinator" ? (
            <View style={styles.composerRow}>
              <TextInput style={styles.composerInput} placeholder="Write a message to the guest…" value={draft} onChangeText={setDraft} multiline />
              <Pressable
                style={({ pressed }) => [
                  styles.sendButton,
                  (!draft.trim() || sending || !isOnline) && styles.buttonDisabled,
                  pressed && !!draft.trim() && !sending && isOnline && styles.buttonPressed,
                ]}
                disabled={!draft.trim() || sending || !isOnline}
                onPress={async () => {
                  const content = draft.trim();
                  setDraft("");
                  await sendMessage(content);
                }}
              >
                <Text style={styles.sendButtonText}>{sending ? "…" : "Send"}</Text>
              </Pressable>
            </View>
          ) : (
            <Text style={styles.readonlyHint}>AI conversation is read-only for coordinators.</Text>
          )}
        </View>
      )}

      {panel !== "chat" && (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
          {panel === "calls" && (
            <View style={styles.card}>
              <Text style={styles.cardLabel}>Call History</Text>
              {calls.length === 0 ? (
                <Text style={styles.empty}>No calls yet</Text>
              ) : (
                calls.map((c) => (
                  <Text key={c.id} style={styles.callHistoryRow}>
                    {c.calleeType === "guest" ? "Guest" : "Hotel"} · {c.status} · {new Date(c.startedAt).toLocaleString()}
                  </Text>
                ))
              )}
            </View>
          )}

          {panel === "escalation" && <EscalationReviewCard caseInfo={caseInfo} onReview={reviewEscalation} />}

          {panel === "options" && (
            <>
              {submittedOption && caseInfo.status !== "closed" && (
                <View style={styles.card}>
                  <Text style={styles.cardLabel}>Guest confirmed option</Text>
                  <Text style={styles.cardSubLabel}>
                    {awaitingHotel
                      ? "The guest has selected this option. The booking will remain unchanged until the hotel confirms availability."
                      : "The guest has submitted this option. It is now read-only and ready for final processing."}
                  </Text>
                </View>
              )}
              {optionsLoading ? (
                <View style={styles.card}><ActivityIndicator /></View>
              ) : displayedOptions.length === 0 ? (
                <View style={styles.card}><Text style={styles.empty}>No options yet</Text></View>
              ) : (
                displayedOptions.map((o) => (
                  <OptionCard
                    key={o.id}
                    option={o}
                    caseId={caseId}
                    readOnly={Boolean(caseInfo.status === "closed" || submittedOption)}
                    bookingCheckIn={caseInfo.checkIn}
                    onChanged={() => void refreshOptions()}
                  />
                ))
              )}
              {caseInfo.status !== "closed" && !submittedOption && (
                <View style={styles.optionsActionRow}>
                  <Pressable style={({ pressed }) => [styles.secondaryButton, { flex: 1 }, optionsBusy && styles.buttonDisabled, pressed && styles.buttonPressed]} disabled={optionsBusy} onPress={() => void regenerateOptions()}>
                    <Text style={styles.secondaryButtonText}>Regenerate</Text>
                  </Pressable>
                  <Pressable style={({ pressed }) => [styles.primaryButton, { flex: 1 }, optionsBusy && styles.buttonDisabled, pressed && styles.buttonPressed]} disabled={optionsBusy} onPress={() => void pushOptions()}>
                    <Text style={styles.primaryButtonText}>{optionsBusy ? "Working…" : "Push to Guest"}</Text>
                  </Pressable>
                </View>
              )}
              {caseInfo.status !== "closed" && <CloseCaseCard onClose={closeCase} />}
            </>
          )}
        </ScrollView>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f1f5f9" },
  headerBlock: { padding: 12, gap: 12 },
  content: { padding: 12, gap: 12, paddingBottom: 40 },
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center" },
  buttonPressed: { opacity: 0.85 },
  card: { backgroundColor: "#fff", borderRadius: 12, padding: 14, gap: 8 },
  title: { fontSize: 17, fontWeight: "700", color: "#0f172a" },
  subtitle: { fontSize: 12, color: "#475569" },
  metaRow: { flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" },
  metaTag: { fontSize: 10, backgroundColor: "#e2e8f0", color: "#334155", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, textTransform: "uppercase" },
  metaText: { fontSize: 11, color: "#94a3b8" },
  callRow: { flexDirection: "row", gap: 8 },
  callButton: { flex: 1, borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  callGuestButton: { backgroundColor: "#4f46e5" },
  callHotelButton: { backgroundColor: "#0f766e" },
  callButtonText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  panelTabs: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  panelTab: { borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: "#fff" },
  panelTabSelected: { backgroundColor: "#7628e8", borderColor: "#7628e8" },
  panelTabPressed: { backgroundColor: "#f1ebff", borderColor: "#c9b5f2" },
  panelTabText: { fontSize: 12, color: "#334155", fontWeight: "600" },
  panelTabTextSelected: { color: "#fff" },
  callHistoryRow: { fontSize: 11, color: "#475569" },
  cardLabel: { fontSize: 13, fontWeight: "700", color: "#0f172a" },
  cardSubLabel: { fontSize: 12, color: "#475569" },
  reviewedText: { fontSize: 12, color: "#0f766e", fontWeight: "600" },
  choiceRow: { flexDirection: "row", gap: 8 },
  choiceWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  choiceChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: "#e2e8f0" },
  choiceChipActive: { backgroundColor: "#4f46e5" },
  choiceChipText: { fontSize: 11, color: "#475569" },
  choiceChipTextActive: { color: "#fff", fontWeight: "700" },
  textArea: { borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 8, padding: 10, minHeight: 60, fontSize: 12, textAlignVertical: "top" },
  primaryButton: { backgroundColor: "#4f46e5", borderRadius: 8, paddingVertical: 10, alignItems: "center" },
  primaryButtonText: { color: "#fff", fontWeight: "700", fontSize: 12 },
  secondaryButton: { backgroundColor: "#e2e8f0", borderRadius: 8, paddingVertical: 10, alignItems: "center" },
  secondaryButtonText: { color: "#334155", fontWeight: "700", fontSize: 12 },
  buttonDisabled: { opacity: 0.5 },
  chatPanel: { flex: 1, backgroundColor: "#fff", marginHorizontal: 12, marginBottom: 8, borderRadius: 12, overflow: "hidden" },
  threadTabs: { flexDirection: "row", backgroundColor: "#fff", padding: 8, gap: 4, borderBottomWidth: 1, borderBottomColor: "#eef2f7" },
  threadTab: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 40, borderRadius: 8 },
  threadTabActive: { backgroundColor: "#7628e8" },
  threadTabPressed: { backgroundColor: "#f1f5f9" },
  threadTabText: { fontSize: 12, fontWeight: "700", color: "#64748b" },
  threadTabTextActive: { color: "#fff" },
  messageList: { flex: 1 },
  messageListContent: { padding: 12, gap: 12, flexGrow: 1 },
  empty: { color: "#94a3b8", fontSize: 12, textAlign: "center", padding: 8 },
  msgRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  msgRowOwn: { flexDirection: "row-reverse" },
  msgAvatar: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  msgAvatarOwn: { backgroundColor: "#ede9fe" },
  msgAvatarOther: { backgroundColor: "#e2e8f0" },
  msgAvatarText: { fontSize: 9, fontWeight: "800", color: "#4f46e5" },
  msgBody: { flex: 1, maxWidth: "82%", gap: 4 },
  msgBodyOwn: { alignItems: "flex-end" },
  msgMeta: { flexDirection: "row", alignItems: "center", gap: 8 },
  msgSender: { fontSize: 11, fontWeight: "700", color: "#0f172a" },
  msgTime: { fontSize: 10, color: "#94a3b8" },
  msgBubble: { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  msgBubbleOwn: { backgroundColor: "#4f46e5", borderTopRightRadius: 4 },
  msgBubbleOther: { backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0", borderTopLeftRadius: 4 },
  msgText: { fontSize: 13, color: "#0f172a", lineHeight: 18 },
  msgTextOwn: { color: "#fff" },
  msgRead: { fontSize: 10, fontWeight: "600" },
  msgReadDone: { color: "#0f766e" },
  msgReadPending: { color: "#dc2626" },
  msgVotes: { flexDirection: "row", gap: 6 },
  voteButton: { width: 32, height: 28, borderRadius: 8, backgroundColor: "#f1f5f9", alignItems: "center", justifyContent: "center" },
  voteButtonActive: { backgroundColor: "#ddd6fe" },
  voteText: { fontSize: 15 },
  composerRow: { flexDirection: "row", gap: 8, alignItems: "flex-end", padding: 10, borderTopWidth: 1, borderTopColor: "#eef2f7" },
  composerInput: { flex: 1, borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 8, padding: 10, fontSize: 13, maxHeight: 100 },
  sendButton: { backgroundColor: "#4f46e5", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10 },
  sendButtonText: { color: "#fff", fontWeight: "700", fontSize: 12 },
  readonlyHint: { fontSize: 12, color: "#64748b", textAlign: "center", padding: 12 },
  optionsActionRow: { flexDirection: "row", gap: 8, marginTop: 4 },
});
