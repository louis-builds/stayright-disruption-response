import { CommonActions } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as bookingsApi from "../bookings/api";
import type { BookingSummary } from "../bookings/types";
import { useMyCases } from "../cases/useMyCases";
import type { CaseSummary } from "../cases/types";
import * as notificationsApi from "../notifications/api";
import type { NotificationItem } from "../notifications/types";
import type { HomeStackParamList } from "../../navigation/HomeStack";

// 通用功能优化需求.txt 第1条:通知搜索已有(下方 TextInput);首页其余列表(优先提醒条只有
// 1条、订单预览封顶3条)量级太小不需要搜索,不为了凑数硬加。第3条:通知轮询间隔20秒已经是
// 跟 Web 端一致的合理值,不用再调。
const NOTICE_POLL_MS = 20_000;
const NOTICE_FETCH_SIZE = 40;
const NOTICE_PREVIEW_COUNT = 4;

type Props = NativeStackScreenProps<HomeStackParamList, "HomeMain">;

function daysUntil(dateStr: string): number {
  const target = new Date(dateStr + "T00:00:00");
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - now.getTime()) / 86_400_000);
}

function formatStayDates(checkIn: string, checkOut: string): string {
  const formatter = new Intl.DateTimeFormat("en-NZ", { day: "numeric", month: "short" });
  return `${formatter.format(new Date(`${checkIn}T00:00:00`))} – ${formatter.format(new Date(`${checkOut}T00:00:00`))}`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function disruptionLabel(type: string | null): string {
  if (!type) return "Travel disruption";
  return `${type.charAt(0).toUpperCase()}${type.slice(1)} disruption`;
}

function EmptyState({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyIcon}>{icon}</Text>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </View>
  );
}

export function HomeScreen({ navigation }: Props) {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [bookings, setBookings] = useState<BookingSummary[]>([]);
  const [bookingsLoading, setBookingsLoading] = useState(true);
  const [noticesLoading, setNoticesLoading] = useState(true);
  const [noticeQuery, setNoticeQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [homePanel, setHomePanel] = useState<"priority" | "stays" | "alerts">("priority");
  const { cases, refresh: refreshCases } = useMyCases();

  const loadNotifications = useCallback(async () => {
    const res = await notificationsApi.fetchNotifications(1, NOTICE_FETCH_SIZE);
    if (res.code === 0) setNotifications(res.data.list);
    setNoticesLoading(false);
  }, []);

  const loadBookings = useCallback(async () => {
    const res = await bookingsApi.fetchMyBookings();
    if (res.code === 0) setBookings(res.data);
    setBookingsLoading(false);
  }, []);

  // 首页数据要实时到位——磕碰通知每 20 秒轮询一次(跟 Web 端一致的合理间隔,不是拍脑袋),
  // 案件列表由 useMyCases 自己按 30 秒轮询,预订不需要轮询(不会在客人看着的时候变化)。
  useEffect(() => {
    void loadNotifications();
    const timer = setInterval(() => void loadNotifications(), NOTICE_POLL_MS);
    return () => clearInterval(timer);
  }, [loadNotifications]);

  useEffect(() => {
    void loadBookings();
  }, [loadBookings]);

  async function onRefresh() {
    setRefreshing(true);
    await Promise.all([loadNotifications(), loadBookings(), refreshCases()]);
    setRefreshing(false);
  }

  const filteredNotifications = useMemo(() => {
    const q = noticeQuery.trim().toLowerCase();
    if (!q) return notifications;
    return notifications.filter((n) => [n.title, n.disruptionTitle, n.body, n.disruptionType].some((f) => f?.toLowerCase().includes(q)));
  }, [notifications, noticeQuery]);

  const activeCases = useMemo(() => cases.filter((c) => c.status !== "closed"), [cases]);
  const upcomingBookings = useMemo(
    () =>
      bookings
        .filter((b) => b.status !== "cancelled" && new Date(`${b.checkOut}T23:59:59`).getTime() >= Date.now())
        .sort((a, b) => new Date(a.checkIn).getTime() - new Date(b.checkIn).getTime()),
    [bookings],
  );
  const priorityCase = useMemo<CaseSummary | null>(
    () =>
      [...activeCases].sort((a, b) => {
        if (a.priority === "high" && b.priority !== "high") return -1;
        if (b.priority === "high" && a.priority !== "high") return 1;
        return new Date(a.checkIn ?? a.createdAt).getTime() - new Date(b.checkIn ?? b.createdAt).getTime();
      })[0] ?? null,
    [activeCases],
  );

  async function openNotification(item: NotificationItem) {
    await notificationsApi.markNotificationRead(item.id);
    setNotifications((prev) => prev.map((n) => (n.id === item.id ? { ...n, readAt: new Date().toISOString() } : n)));
    if (item.caseId) navigation.navigate("CaseConversation", { caseId: item.caseId });
  }

  function goToBookingsTab() {
    navigation.dispatch(CommonActions.navigate({ name: "Bookings" }));
  }

  const entrance = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(entrance, { toValue: 1, duration: 450, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [entrance]);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor="#7628e8" />}
    >
      <Animated.View style={{ opacity: entrance, transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }], gap: 14 }}>
      <View style={styles.tabs}>
        <Pressable
          style={({ pressed }) => [styles.tab, homePanel === "priority" && styles.tabActive, pressed && homePanel !== "priority" && styles.tabPressed]}
          onPress={() => setHomePanel("priority")}
        >
          <Text style={[styles.tabText, homePanel === "priority" && styles.tabTextActive]}>Action</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.tab, homePanel === "stays" && styles.tabActive, pressed && homePanel !== "stays" && styles.tabPressed]}
          onPress={() => setHomePanel("stays")}
        >
          <Text style={[styles.tabText, homePanel === "stays" && styles.tabTextActive]}>Stays</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.tab, homePanel === "alerts" && styles.tabActive, pressed && homePanel !== "alerts" && styles.tabPressed]}
          onPress={() => setHomePanel("alerts")}
        >
          <Text style={[styles.tabText, homePanel === "alerts" && styles.tabTextActive]}>Alerts</Text>
        </Pressable>
      </View>

      {homePanel === "priority" && (priorityCase ? (
        <Pressable
          style={({ pressed }) => [styles.priorityCard, pressed && styles.priorityCardPressed]}
          onPress={() => navigation.navigate("CaseConversation", { caseId: priorityCase.id })}
        >
          <View style={styles.priorityHeader}>
            <Text style={styles.priorityHeaderText}>⚠️ Priority: your stay may be affected</Text>
            <Text style={styles.priorityHeaderMeta}>
              {priorityCase.checkIn ? (daysUntil(priorityCase.checkIn) <= 0 ? "Check-in due now" : `${daysUntil(priorityCase.checkIn)}d to check-in`) : `${priorityCase.priority} priority`}
            </Text>
          </View>
          <Text style={styles.priorityTitle}>
            {priorityCase.hotelName ?? "Affected booking"} — {priorityCase.disruptionTitle ?? "Travel disruption update"}
          </Text>
          <Text style={styles.priorityBody} numberOfLines={2}>
            {priorityCase.disruptionDescription ?? "A disruption may affect this stay. Review the latest case information and available recovery options."}
          </Text>
          {priorityCase.checkIn && priorityCase.checkOut && <Text style={styles.priorityDates}>{formatStayDates(priorityCase.checkIn, priorityCase.checkOut)}</Text>}
          <Text style={styles.priorityCta}>Review recovery options →</Text>
        </Pressable>
      ) : (
        <View style={styles.allClearCard}>
          <Text style={styles.allClearIcon}>✓</Text>
          <View style={styles.allClearText}>
            <Text style={styles.allClearTitle}>No action is required right now</Text>
            <Text style={styles.allClearBody}>We'll keep monitoring your upcoming stays and notify you if anything changes.</Text>
          </View>
        </View>
      ))}

      {homePanel === "stays" && (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>Upcoming stays</Text>
          <Pressable onPress={goToBookingsTab} style={({ pressed }) => pressed && styles.pressedDim}>
            <Text style={styles.cardLink}>View all bookings →</Text>
          </Pressable>
        </View>
        {bookingsLoading ? (
          <EmptyState icon="◌" title="Loading…" body="Fetching your bookings." />
        ) : upcomingBookings.length === 0 ? (
          <EmptyState icon="✓" title="No upcoming stays" body="Future bookings linked to your account will appear here." />
        ) : (
          upcomingBookings.slice(0, 3).map((booking) => (
            <Pressable
              key={booking.id}
              style={({ pressed }) => [styles.bookingRow, pressed && styles.rowPressed]}
              onPress={() => (booking.caseId ? navigation.navigate("CaseConversation", { caseId: booking.caseId }) : goToBookingsTab())}
            >
              <View style={styles.bookingRowText}>
                <Text style={styles.bookingHotel}>{booking.hotelName}</Text>
                <Text style={styles.bookingMeta}>
                  {booking.roomTypeName} · {booking.checkIn} → {booking.checkOut}
                </Text>
              </View>
              <Text style={styles.bookingCta}>{booking.caseId ? "View case" : "View stay"} →</Text>
            </Pressable>
          ))
        )}
      </View>
      )}

      {homePanel === "alerts" && (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Recent disruption notices</Text>
        <TextInput style={styles.searchInput} placeholder="Search notices" value={noticeQuery} onChangeText={setNoticeQuery} />
        {noticesLoading ? (
          <EmptyState icon="◌" title="Loading…" body="Fetching your notices." />
        ) : filteredNotifications.length === 0 ? (
          <EmptyState icon="✓" title={noticeQuery ? "No matches" : "All quiet for now"} body={noticeQuery ? "Try a different search term." : "New disruption notices will appear here automatically."} />
        ) : (
          filteredNotifications.slice(0, NOTICE_PREVIEW_COUNT).map((notice) => (
            <Pressable
              key={notice.id}
              style={({ pressed }) => [styles.noticeRow, !notice.readAt && styles.noticeRowUnread, pressed && styles.rowPressed]}
              onPress={() => void openNotification(notice)}
            >
              <Text style={styles.noticeStatusIcon}>{notice.readAt ? "✓" : "!"}</Text>
              <View style={styles.noticeRowText}>
                <Text style={styles.noticeTitle}>{notice.disruptionTitle ?? notice.title}</Text>
                <Text style={styles.noticeBody} numberOfLines={2}>{notice.body}</Text>
              </View>
              <Text style={styles.noticeTime}>{formatDate(notice.sentAt)}</Text>
            </Pressable>
          ))
        )}
      </View>
      )}
      </Animated.View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f8fafc" },
  content: { padding: 16, paddingBottom: 88, gap: 14 },
  tabs: { flexDirection: "row", backgroundColor: "#fff", borderRadius: 12, padding: 4, gap: 4 },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 40, borderRadius: 8 },
  tabActive: { backgroundColor: "#7628e8" },
  tabPressed: { backgroundColor: "#f1f5f9" },
  tabText: { fontSize: 12, fontWeight: "700", color: "#64748b" },
  tabTextActive: { color: "#fff" },
  priorityCard: { backgroundColor: "#fff", borderRadius: 14, padding: 16, borderWidth: 1, borderColor: "#f0b8c2", gap: 6 },
  priorityCardPressed: { backgroundColor: "#fff0f3" },
  pressedDim: { opacity: 0.5 },
  rowPressed: { backgroundColor: "#f8fafc" },
  priorityHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 4 },
  priorityHeaderText: { fontSize: 12, fontWeight: "700", color: "#d63153" },
  priorityHeaderMeta: { fontSize: 11, color: "#d63153", fontWeight: "600" },
  priorityTitle: { fontSize: 15, fontWeight: "700", color: "#0f172a" },
  priorityBody: { fontSize: 12, color: "#64748b" },
  priorityDates: { fontSize: 12, color: "#334155", fontWeight: "600" },
  priorityCta: { fontSize: 13, color: "#7628e8", fontWeight: "700", marginTop: 4 },
  allClearCard: { flexDirection: "row", backgroundColor: "#fff", borderRadius: 14, padding: 16, gap: 12, alignItems: "center", borderWidth: 1, borderColor: "#d1fae5" },
  allClearIcon: { fontSize: 22, color: "#059669" },
  allClearText: { flex: 1, gap: 2 },
  allClearTitle: { fontSize: 14, fontWeight: "700", color: "#0f172a" },
  allClearBody: { fontSize: 12, color: "#64748b" },
  card: { backgroundColor: "#fff", borderRadius: 14, padding: 16, gap: 10 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardTitle: { fontSize: 15, fontWeight: "700", color: "#0f172a" },
  cardLink: { fontSize: 12, color: "#7628e8", fontWeight: "600" },
  searchInput: { borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, fontSize: 13 },
  bookingRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, borderTopWidth: 1, borderTopColor: "#f1f5f9" },
  bookingRowText: { flex: 1, gap: 2 },
  bookingHotel: { fontSize: 13, fontWeight: "700", color: "#0f172a" },
  bookingMeta: { fontSize: 11, color: "#64748b" },
  bookingCta: { fontSize: 12, color: "#7628e8", fontWeight: "600" },
  noticeRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 10, borderTopWidth: 1, borderTopColor: "#f1f5f9" },
  noticeRowUnread: { backgroundColor: "#f1ebff" },
  noticeStatusIcon: { fontSize: 13, color: "#7628e8", width: 16, textAlign: "center", marginTop: 2 },
  noticeRowText: { flex: 1, gap: 2 },
  noticeTitle: { fontSize: 13, fontWeight: "700", color: "#0f172a" },
  noticeBody: { fontSize: 12, color: "#64748b" },
  noticeTime: { fontSize: 10, color: "#94a3b8" },
  empty: { alignItems: "center", paddingVertical: 20, gap: 4 },
  emptyIcon: { fontSize: 20 },
  emptyTitle: { fontSize: 13, fontWeight: "700", color: "#0f172a" },
  emptyBody: { fontSize: 12, color: "#64748b", textAlign: "center" },
});
