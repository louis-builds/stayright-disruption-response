import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, Easing, Image, KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { HomeStackParamList } from "../../navigation/HomeStack";
import type { CaseMessage, SenderRole, Thread } from "./types";
import { useCaseConversation } from "./useCaseConversation";

type Props = NativeStackScreenProps<HomeStackParamList, "CaseConversation">;

// 通用功能优化需求.txt 第1条:单个案件的对话历史量级(几十到一两百条)用 pageSize=100
// 一次性拉完够用——真到了要分页的量级,案件本身早就该走完结案流程,不是这个页面要优化的方向。
// 第2条:案件时间线图形化评估后不加——案件生命周期短(几天到几周),状态变化就2-3次,
// 时间线可视化的信息密度还不如现在的状态徽章+时间戳直观,不为了"看起来高级"硬加。

const ROLE_META: Record<SenderRole, { label: string; avatar: string }> = {
  guest: { label: "You", avatar: "🧳" },
  ai: { label: "AI Assistant", avatar: "🤖" },
  system: { label: "System", avatar: "ℹ️" },
  coordinator: { label: "Coordinator", avatar: "🧑‍💼" },
};

// 通用页面优化需求.txt 第3条:消息气泡进场动画——每条消息挂载时轻微淡入+上移,新消息落地
// (发消息成功、轮询带回新回复)时不是硬生生蹦出来。AI打字机效果不移植,发消息时用 Typing 占位。
interface RoomCardAttachment {
  kind: "room_card";
  hotel?: string;
  room_type?: string;
  room_description?: string;
  room_amenities?: string[];
  room_image_urls?: string[];
  reason?: string;
}

function parseAttachment(json: string | null): RoomCardAttachment | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    return parsed.kind === "room_card" ? (parsed as RoomCardAttachment) : null;
  } catch {
    return null;
  }
}

function RoomCard({ attachment }: { attachment: RoomCardAttachment }) {
  return (
    <View style={styles.roomCard}>
      {attachment.room_image_urls && attachment.room_image_urls.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.roomCardPhotoRow}>
          {attachment.room_image_urls.map((uri, i) => (
            <Image key={i} source={{ uri }} style={styles.roomCardPhoto} />
          ))}
        </ScrollView>
      )}
      {attachment.hotel && <Text style={styles.roomCardHotel}>{attachment.hotel}</Text>}
      {attachment.room_type && <Text style={styles.roomCardRoomType}>{attachment.room_type}</Text>}
      {attachment.room_description && <Text style={styles.roomCardRoomType}>{attachment.room_description}</Text>}
      {attachment.room_amenities && attachment.room_amenities.length > 0 && (
        <Text style={styles.roomCardAmenities}>{attachment.room_amenities.join(" · ")}</Text>
      )}
      {attachment.reason && <Text style={styles.roomCardReason}>{attachment.reason}</Text>}
    </View>
  );
}

function formatMessageTime(iso: string) {
  return new Date(iso).toLocaleString("en-NZ", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function MessageBubble({
  message,
  onRef,
  onVote,
}: {
  message: CaseMessage;
  onRef?: (node: View | null) => void;
  onVote: (vote: "like" | "dislike") => void;
}) {
  const meta = ROLE_META[message.senderRole];
  const isOwn = message.senderRole === "guest";
  const isRead = Boolean(message.readAt);
  const attachment = parseAttachment(message.attachmentJson);
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [fade]);

  return (
    <Animated.View
      ref={onRef}
      style={[
        styles.msgRow,
        isOwn && styles.msgRowMine,
        { opacity: fade, transform: [{ translateY: fade.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] },
      ]}
    >
      <Text style={styles.msgAvatar}>{meta.avatar}</Text>
      <View style={[styles.msgBubbleWrap, isOwn && styles.msgBubbleWrapMine]}>
        <View style={styles.msgMeta}>
          <Text style={styles.msgSender}>{meta.label}</Text>
          <Text style={styles.msgTime}>{formatMessageTime(message.createdAt)}</Text>
        </View>
        <View style={[styles.msgBubble, isOwn ? styles.msgBubbleGuest : styles.msgBubbleOther]}>
          <Text style={isOwn ? styles.msgTextGuest : styles.msgTextOther}>{message.content}</Text>
          {attachment && <RoomCard attachment={attachment} />}
        </View>
        {!isOwn && (
          <Text style={[styles.msgRead, isRead ? styles.msgReadDone : styles.msgReadPending]}>{isRead ? "Read" : "Unread"}</Text>
        )}
        {message.senderRole === "ai" && (
          <View style={styles.msgVotes}>
            <Pressable
              style={({ pressed }) => [styles.voteButton, message.vote === "like" && styles.voteButtonActive, pressed && styles.voteButtonPressed]}
              onPress={() => onVote("like")}
            >
              <Text style={styles.voteText}>👍</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.voteButton, message.vote === "dislike" && styles.voteButtonActive, pressed && styles.voteButtonPressed]}
              onPress={() => onVote("dislike")}
            >
              <Text style={styles.voteText}>👎</Text>
            </Pressable>
          </View>
        )}
      </View>
    </Animated.View>
  );
}

export function CaseConversationScreen({ route, navigation }: Props) {
  const { caseId } = route.params;
  const insets = useSafeAreaInsets();
  const tabClearance = 64 + Math.max(insets.bottom, 8);
  const [thread, setThread] = useState<Thread>("ai");
  const [showDetails, setShowDetails] = useState(false);
  const { caseInfo, messages, loading, sending, error, sendMessage, refresh, markMessageRead, vote } = useCaseConversation(caseId, thread);
  const [draft, setDraft] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const messageRefs = useRef(new Map<string, View>()).current;
  const checkVisibleUnreadRef = useRef<() => void>(() => {});

  const unreadIds = useMemo(
    () => messages.filter((m) => !m.readAt && m.senderRole !== "guest").map((m) => m.id),
    [messages],
  );

  // 单条消息停留满3秒才算已读,跟 Web 端 CaseConversationPage.tsx 同一套约定(见那边注释:
  // "气泡露出一点点就启动计时器,滑出可视区域就清掉,没有半途算数的已读")——RN 没有
  // getBoundingClientRect,用 View.measure() 拿页面坐标做同样的矩形重叠判断,原生/web 通用。
  useEffect(() => {
    const container = scrollRef.current;
    if (!container || unreadIds.length === 0) return;

    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    let cancelled = false;

    function measureContainer(): Promise<{ top: number; bottom: number } | null> {
      return new Promise((resolve) => {
        // @ts-expect-error -- ScrollView forwards measure via its underlying native node
        container?.measure((_x: number, _y: number, _w: number, height: number, _pageX: number, pageY: number) => {
          resolve({ top: pageY, bottom: pageY + height });
        });
      });
    }

    function measureNode(node: View): Promise<{ top: number; bottom: number } | null> {
      return new Promise((resolve) => {
        node.measure((_x, _y, _w, height, _pageX, pageY) => {
          resolve({ top: pageY, bottom: pageY + height });
        });
      });
    }

    async function check() {
      if (cancelled) return;
      const containerRect = await measureContainer();
      if (!containerRect || cancelled) return;
      const visibleIds = new Set<string>();
      for (const id of unreadIds) {
        const node = messageRefs.get(id);
        if (!node) continue;
        const rect = await measureNode(node);
        if (!rect || cancelled) return;
        const visible = rect.bottom > containerRect.top && rect.top < containerRect.bottom;
        if (!visible) continue;
        visibleIds.add(id);
        if (timers.has(id)) continue;
        timers.set(
          id,
          setTimeout(() => {
            timers.delete(id);
            void markMessageRead(id);
          }, 3000),
        );
      }
      for (const [id, timer] of timers) {
        if (!visibleIds.has(id)) {
          clearTimeout(timer);
          timers.delete(id);
        }
      }
    }

    checkVisibleUnreadRef.current = () => void check();
    void check();
    return () => {
      cancelled = true;
      timers.forEach((t) => clearTimeout(t));
    };
  }, [unreadIds, markMessageRead, loading, messageRefs]);

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [messages.length, loading, sending]);

  const threadFade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (loading) return;
    threadFade.setValue(0);
    Animated.timing(threadFade, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [thread, loading, threadFade]);

  async function submit() {
    if (!draft.trim() || sending) return;
    const content = draft;
    setDraft("");
    await sendMessage(content);
  }

  async function onRefresh() {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }

  const hero = caseInfo && (
    <View style={styles.hero}>
      <View style={styles.badgeRow}>
        <View style={styles.caseIdBadge}>
          <Text style={styles.caseIdBadgeText}>CASE-{caseId.slice(0, 8).toUpperCase()}</Text>
        </View>
        <View style={[styles.priorityBadge, caseInfo.priority === "high" && styles.priorityBadgeHigh]}>
          <Text style={[styles.priorityBadgeText, caseInfo.priority === "high" && styles.priorityBadgeTextHigh]}>{caseInfo.priority} priority</Text>
        </View>
        <View style={styles.statusBadge}>
          <Text style={styles.statusBadgeText}>{caseInfo.statusLabel}</Text>
        </View>
      </View>
      <Text style={styles.heroTitle}>{caseInfo.disruptionTitle ?? "Disruption case"}</Text>
      <Text style={styles.heroBody}>{caseInfo.disruptionDescription || "Travel disruption affecting this booking."}</Text>
    </View>
  );

  const tabs = (
    <View style={styles.tabs}>
      <Pressable
        style={({ pressed }) => [styles.tab, !showDetails && thread === "ai" && styles.tabActive, pressed && (showDetails || thread !== "ai") && styles.tabPressed]}
        onPress={() => {
          setShowDetails(false);
          setThread("ai");
        }}
      >
        <Text style={[styles.tabText, !showDetails && thread === "ai" && styles.tabTextActive]}>AI</Text>
        {!!caseInfo?.unreadAiCount && (
          <View style={styles.tabBadge}>
            <Text style={styles.tabBadgeText}>{caseInfo.unreadAiCount}</Text>
          </View>
        )}
      </Pressable>
      {caseInfo?.escalated && (
        <Pressable
          style={({ pressed }) => [styles.tab, !showDetails && thread === "coordinator" && styles.tabActive, pressed && (showDetails || thread !== "coordinator") && styles.tabPressed]}
          onPress={() => {
            setShowDetails(false);
            setThread("coordinator");
          }}
        >
          <Text style={[styles.tabText, !showDetails && thread === "coordinator" && styles.tabTextActive]}>Coordinator</Text>
          {!!caseInfo?.unreadCoordinatorCount && (
            <View style={styles.tabBadge}>
              <Text style={styles.tabBadgeText}>{caseInfo.unreadCoordinatorCount}</Text>
            </View>
          )}
        </Pressable>
      )}
      <Pressable
        style={({ pressed }) => [styles.tab, showDetails && styles.tabActive, pressed && !showDetails && styles.tabPressed]}
        onPress={() => setShowDetails(true)}
      >
        <Text style={[styles.tabText, showDetails && styles.tabTextActive]}>Details</Text>
      </Pressable>
    </View>
  );

  return (
    <KeyboardAvoidingView style={[styles.screen, { paddingBottom: tabClearance }]} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      {showDetails && caseInfo ? (
        <View style={styles.detailsPage}>
          {hero}
          {tabs}
          <View style={styles.detailsCard}>
            <Text style={styles.detailsId}>CASE-{caseId.slice(0, 8).toUpperCase()}</Text>
            <View style={styles.detailRow}><Text style={styles.detailLabel}>Hotel</Text><Text style={styles.detailValue}>{caseInfo.hotelName ?? "Not recorded"}</Text></View>
            <View style={styles.detailRow}><Text style={styles.detailLabel}>Booking</Text><Text style={styles.detailValue}>{caseInfo.confirmationNo ?? "Not recorded"}</Text></View>
            <View style={styles.detailRow}><Text style={styles.detailLabel}>Stay dates</Text><Text style={styles.detailValue}>{caseInfo.checkIn && caseInfo.checkOut ? `${caseInfo.checkIn} → ${caseInfo.checkOut}` : "Not recorded"}</Text></View>
            <View style={styles.detailRow}><Text style={styles.detailLabel}>Priority</Text><Text style={styles.detailValue}>{caseInfo.priority}</Text></View>
            <View style={styles.detailRow}><Text style={styles.detailLabel}>Status</Text><Text style={styles.detailValue}>{caseInfo.statusLabel}</Text></View>
            <View style={styles.detailRow}><Text style={styles.detailLabel}>Assigned coordinator</Text><Text style={styles.detailValue}>{caseInfo.assigneeNickname ?? "StayRight support team"}</Text></View>
            <View style={styles.detailRow}><Text style={styles.detailLabel}>Messages</Text><Text style={styles.detailValue}>{String(messages.length)}</Text></View>
            {caseInfo.status === "closed" ? (
              <View style={styles.closedNote}>
                <Text style={styles.closedNoteText}>This case is resolved. Check the conversation for the final outcome.</Text>
              </View>
            ) : (
              <Pressable
                style={({ pressed }) => [styles.optionsButton, pressed && styles.optionsButtonPressed]}
                onPress={() => navigation.navigate("OptionsFlow", { caseId })}
              >
                <Text style={styles.optionsButtonText}>Review Recovery Options →</Text>
              </Pressable>
            )}
          </View>
        </View>
      ) : (
        <View style={styles.chatPage}>
          {hero}
          {tabs}
          <ScrollView
            ref={scrollRef}
            style={styles.threadScroll}
            contentContainerStyle={styles.threadContent}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor="#7628e8" />}
            onScroll={() => checkVisibleUnreadRef.current()}
            scrollEventThrottle={200}
            keyboardShouldPersistTaps="handled"
          >
            {loading ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator color="#7628e8" />
                <Text style={styles.loadingText}>Loading conversation…</Text>
              </View>
            ) : (
              <Animated.View style={{ opacity: threadFade }}>
                {messages.length === 0 && !(sending && thread === "ai") ? (
                  <Text style={styles.emptyText}>{thread === "coordinator" ? "No messages with your coordinator yet." : "No messages yet."}</Text>
                ) : (
                  <>
                    {messages.map((m) => (
                      <MessageBubble
                        key={m.id}
                        message={m}
                        onVote={(value) => void vote(m.id, value)}
                        onRef={(node) => {
                          if (node) messageRefs.set(m.id, node);
                          else messageRefs.delete(m.id);
                        }}
                      />
                    ))}
                    {sending && thread === "ai" && (
                      <View style={styles.msgRow}>
                        <Text style={styles.msgAvatar}>🤖</Text>
                        <View style={styles.msgBubbleWrap}>
                          <View style={styles.msgMeta}>
                            <Text style={styles.msgSender}>AI Assistant</Text>
                          </View>
                          <View style={[styles.msgBubble, styles.msgBubbleOther]}>
                            <Text style={styles.msgTextOther}>Typing…</Text>
                          </View>
                        </View>
                      </View>
                    )}
                  </>
                )}
              </Animated.View>
            )}
          </ScrollView>
        </View>
      )}

      {error && <Text style={styles.errorText}>{error}</Text>}

      {!showDetails && (
        <View style={styles.composer}>
          <TextInput
            style={styles.composerInput}
            placeholder={thread === "coordinator" ? "Write a message to your coordinator…" : "Ask StayRight AI about this case…"}
            value={draft}
            onChangeText={setDraft}
            editable={!sending}
          />
          <Pressable
            style={({ pressed }) => [styles.composerButton, (sending || !draft.trim()) && styles.composerButtonDisabled, pressed && !sending && !!draft.trim() && styles.composerButtonPressed]}
            onPress={() => void submit()}
            disabled={sending || !draft.trim()}
          >
            {sending ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.composerButtonText}>Send →</Text>}
          </Pressable>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f8fafc", overflow: "hidden" },
  chatPage: { flex: 1, paddingHorizontal: 16, paddingTop: 12, gap: 10, minHeight: 0 },
  threadScroll: { flex: 1, backgroundColor: "#fff", borderRadius: 14 },
  threadContent: { padding: 12, gap: 12, flexGrow: 1 },
  detailsPage: { flex: 1, padding: 16, gap: 12, overflow: "hidden" },
  hero: { backgroundColor: "#fff", borderRadius: 14, padding: 16, gap: 6 },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  caseIdBadge: { backgroundColor: "#f1f5f9", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  caseIdBadgeText: { fontSize: 10, color: "#475569", fontWeight: "700" },
  priorityBadge: { backgroundColor: "#e2e8f0", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  priorityBadgeHigh: { backgroundColor: "#ffedf2" },
  priorityBadgeText: { fontSize: 10, color: "#0f172a", fontWeight: "700", textTransform: "capitalize" },
  priorityBadgeTextHigh: { color: "#d33e63" },
  statusBadge: { backgroundColor: "#d1fae5", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  statusBadgeText: { fontSize: 10, color: "#078c77", fontWeight: "700" },
  heroTitle: { fontSize: 17, fontWeight: "700", color: "#0f172a", marginTop: 2 },
  heroBody: { fontSize: 12, color: "#64748b" },
  detailsCard: { flex: 1, minHeight: 0, backgroundColor: "#fff", borderRadius: 14, padding: 16, gap: 8 },
  detailsId: { fontSize: 11, fontWeight: "700", color: "#7628e8" },
  detailRow: { gap: 2, paddingVertical: 6, borderTopWidth: 1, borderTopColor: "#eef0f4" },
  detailLabel: { fontSize: 10, fontWeight: "700", color: "#969daf", textTransform: "uppercase" },
  detailValue: { fontSize: 13, fontWeight: "700", color: "#252b3e" },
  closedNote: { backgroundColor: "#f1ebff", borderRadius: 10, padding: 10, marginTop: 8 },
  closedNoteText: { fontSize: 12, color: "#6220ca", fontWeight: "600" },
  optionsButton: { marginTop: "auto", backgroundColor: "#7628e8", borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  optionsButtonPressed: { backgroundColor: "#6220ca" },
  optionsButtonText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  tabs: { flexDirection: "row", backgroundColor: "#fff", borderRadius: 12, padding: 4, gap: 4 },
  tab: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 8 },
  tabActive: { backgroundColor: "#7628e8" },
  tabPressed: { backgroundColor: "#f1f5f9" },
  tabText: { fontSize: 12, fontWeight: "700", color: "#64748b" },
  tabTextActive: { color: "#fff" },
  tabBadge: { backgroundColor: "#ef4444", borderRadius: 999, minWidth: 16, height: 16, alignItems: "center", justifyContent: "center", paddingHorizontal: 3 },
  tabBadgeText: { color: "#fff", fontSize: 9, fontWeight: "700" },
  loadingRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 30 },
  loadingText: { fontSize: 12, color: "#64748b" },
  emptyText: { fontSize: 12, color: "#94a3b8", textAlign: "center", paddingVertical: 30 },
  msgRow: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  msgRowMine: { flexDirection: "row-reverse" },
  msgAvatar: { fontSize: 18 },
  msgBubbleWrap: { flex: 1, gap: 4, maxWidth: "82%" },
  msgBubbleWrapMine: { alignItems: "flex-end" },
  msgMeta: { flexDirection: "row", gap: 6, alignItems: "center" },
  msgSender: { fontSize: 10, fontWeight: "700", color: "#64748b" },
  msgTime: { fontSize: 10, color: "#94a3b8" },
  msgBubble: { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  msgBubbleGuest: { backgroundColor: "#7628e8", alignSelf: "flex-end" },
  msgBubbleOther: { backgroundColor: "#f1f5f9", alignSelf: "flex-start" },
  msgTextGuest: { color: "#fff", fontSize: 13 },
  msgTextOther: { color: "#0f172a", fontSize: 13 },
  msgRead: { fontSize: 10, fontWeight: "600" },
  msgReadDone: { color: "#0f766e" },
  msgReadPending: { color: "#dc2626" },
  msgVotes: { flexDirection: "row", gap: 6 },
  voteButton: { width: 32, height: 28, borderRadius: 8, backgroundColor: "#f1f5f9", alignItems: "center", justifyContent: "center" },
  voteButtonActive: { backgroundColor: "#ede9fe" },
  voteButtonPressed: { opacity: 0.7 },
  voteText: { fontSize: 14 },
  roomCard: { marginTop: 6, gap: 2 },
  roomCardPhotoRow: { marginBottom: 4 },
  roomCardPhoto: { width: 88, height: 66, borderRadius: 8, marginRight: 6, backgroundColor: "#e2e8f0" },
  roomCardHotel: { fontSize: 12, fontWeight: "700", color: "#0f172a" },
  roomCardRoomType: { fontSize: 12, color: "#475569" },
  roomCardReason: { fontSize: 12, fontStyle: "italic", color: "#7628e8" },
  roomCardAmenities: { fontSize: 11, color: "#94a3b8" },
  errorText: { color: "#dc2626", fontSize: 12, paddingHorizontal: 16 },
  composer: { flexDirection: "row", gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: "#e2e8f0", backgroundColor: "#fff" },
  composerInput: { flex: 1, borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14 },
  composerButton: { backgroundColor: "#7628e8", borderRadius: 10, paddingHorizontal: 16, alignItems: "center", justifyContent: "center" },
  composerButtonPressed: { backgroundColor: "#6220ca" },
  composerButtonDisabled: { opacity: 0.5 },
  composerButtonText: { color: "#fff", fontWeight: "700", fontSize: 13 },
});
