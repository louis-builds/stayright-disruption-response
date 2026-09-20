import { CommonActions, useNavigation } from "@react-navigation/native";
import * as Clipboard from "expo-clipboard";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as api from "./api";
import type { BookingSummary } from "./types";

const PAGE_SIZE = 5;

// 通用功能优化需求.txt 第3条:订单列表本身不需要独立的通知机制——订单状态变化都是通过
// 关联案件驱动的,已经在案件对话页/通知中心里推送,这里再加一套会重复。

type BookingFilter = "all" | "confirmed" | "attention" | "rebooked" | "cancelled";
type BookingTone = Exclude<BookingFilter, "all">;

// 结案原因是后端存的中文分类字符串,展示层映射成英文——跟 Web/协调员App 用同一套约定,
// 不要在这里直接展示原始中文值。
const CLOSE_REASON_LABELS: Record<string, string> = {
  改订成功结案: "Rebooking succeeded",
  取消退款完成结案: "Cancelled with refund",
  维持原订: "Kept original booking",
  人工决议结案: "Resolved manually by a coordinator",
  "中断解除-维持原订": "Disruption lifted, booking unchanged",
  客人自行关闭或超时结案: "Closed by guest or timed out",
  误伤关闭: "Closed in error",
  重复案合并关闭: "Merged with a duplicate case",
};

function closeReasonLabel(reason: string): string {
  return CLOSE_REASON_LABELS[reason] ?? reason;
}

function isOpenCase(booking: BookingSummary): boolean {
  return Boolean(booking.caseId && booking.caseStatus !== "closed");
}

function bookingTone(booking: BookingSummary): BookingTone {
  if (booking.status === "cancelled" || booking.refundConfirmed) return "cancelled";
  if (isOpenCase(booking)) return "attention";
  if (booking.status === "rebooked") return "rebooked";
  return "confirmed";
}

function statusLabel(booking: BookingSummary): string {
  const tone = bookingTone(booking);
  if (tone === "attention") return "Action needed";
  return tone.charAt(0).toUpperCase() + tone.slice(1);
}

function formatDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-NZ", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function stayNights(booking: BookingSummary): number {
  const start = new Date(`${booking.checkIn}T00:00:00`).getTime();
  const end = new Date(`${booking.checkOut}T00:00:00`).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-NZ", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString("en-NZ")}`;
  }
}

function BookingOutcome({ booking }: { booking: BookingSummary }) {
  if (!booking.caseId) return null;
  if (booking.refundConfirmed) {
    return (
      <Text style={styles.outcomeCancelled}>
        Refund confirmed{booking.refundAmount != null ? ` · ${formatMoney(booking.refundAmount, booking.currency)}` : ""}.
      </Text>
    );
  }
  if (booking.caseStatus === "closed") {
    return <Text style={styles.outcomeClosed}>{booking.caseCloseReason ? closeReasonLabel(booking.caseCloseReason) : "This case has been resolved."}</Text>;
  }
  return <Text style={styles.outcomeAttention}>A linked case needs your review. Open it for the latest update.</Text>;
}

function EmptyState({ icon, title, body, onClear }: { icon: string; title: string; body: string; onClear?: () => void }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyIcon}>{icon}</Text>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
      {onClear && (
        <Pressable style={({ pressed }) => [styles.emptyClearButton, pressed && styles.pageButtonPressed]} onPress={onClear}>
          <Text style={styles.emptyClearButtonText}>Clear filters</Text>
        </Pressable>
      )}
    </View>
  );
}

// 通用功能优化需求.txt 第4条:下载txt/一键导出全部这两个桌面端动作在手机上不自然,不加;
// 但复制确认号是移动端也常用的真实动作(客人打电话给酒店时经常要报确认号),用
// expo-clipboard 加上,比整份文本导出更贴合移动场景。
export function BookingsScreen() {
  const navigation = useNavigation();
  const [bookings, setBookings] = useState<BookingSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<BookingFilter>("all");
  const [page, setPage] = useState(1);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const entrance = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(entrance, { toValue: 1, duration: 450, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [entrance]);

  const load = useCallback(async () => {
    const res = await api.fetchMyBookings();
    if (res.code === 0) setBookings(res.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const stats = useMemo(
    () => ({
      total: bookings.length,
      confirmed: bookings.filter((b) => bookingTone(b) === "confirmed").length,
      attention: bookings.filter((b) => bookingTone(b) === "attention").length,
      rebooked: bookings.filter((b) => bookingTone(b) === "rebooked").length,
      cancelled: bookings.filter((b) => bookingTone(b) === "cancelled").length,
    }),
    [bookings],
  );

  const filters: { key: BookingFilter; label: string; count: number }[] = [
    { key: "all", label: "All stays", count: stats.total },
    { key: "confirmed", label: "Confirmed", count: stats.confirmed },
    { key: "attention", label: "Action needed", count: stats.attention },
    { key: "rebooked", label: "Rebooked", count: stats.rebooked },
    { key: "cancelled", label: "Cancelled", count: stats.cancelled },
  ];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return bookings.filter((b) => {
      const matchesFilter = filter === "all" || bookingTone(b) === filter;
      const matchesQuery = !q || [b.hotelName, b.confirmationNo, b.roomTypeName].some((f) => f.toLowerCase().includes(q));
      return matchesFilter && matchesQuery;
    });
  }, [bookings, filter, query]);

  useEffect(() => {
    setPage(1);
  }, [filter, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pagedBookings = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function openCase(caseId: string) {
    navigation.dispatch(CommonActions.navigate({ name: "Home", params: { screen: "CaseConversation", params: { caseId } } }));
  }

  function clearFilters() {
    setQuery("");
    setFilter("all");
  }

  async function handleCopy(booking: BookingSummary) {
    await Clipboard.setStringAsync(booking.confirmationNo);
    setCopiedId(booking.id);
    setTimeout(() => setCopiedId((current) => (current === booking.id ? null : current)), 1400);
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor="#7628e8" />}
    >
      <Animated.View style={{ opacity: entrance, transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }], gap: 12 }}>
      <Text style={styles.overline}>TRIP OVERVIEW</Text>
      <Text style={styles.title}>My Bookings</Text>
      <Text style={styles.subtitle}>Manage your confirmed reservations and track disruption-related updates.</Text>

      {!loading && bookings.length > 0 && (
        // 通用功能优化需求.txt 第2条:订单状态分布用一条分段条可视化,比四个筛选pill的数字
        // 更快一眼看出整体构成——不引入图表库,几个 View 拼宽度就够。
        <View style={styles.distributionBar}>
          {stats.confirmed > 0 && <View style={[styles.distributionSegment, { flex: stats.confirmed, backgroundColor: "#18c39c" }]} />}
          {stats.attention > 0 && <View style={[styles.distributionSegment, { flex: stats.attention, backgroundColor: "#fb923c" }]} />}
          {stats.rebooked > 0 && <View style={[styles.distributionSegment, { flex: stats.rebooked, backgroundColor: "#38bdf8" }]} />}
          {stats.cancelled > 0 && <View style={[styles.distributionSegment, { flex: stats.cancelled, backgroundColor: "#cbd5e1" }]} />}
        </View>
      )}

      {loading ? (
        <View style={styles.card}>
          <EmptyState icon="◌" title="Loading…" body="Fetching your bookings." />
        </View>
      ) : bookings.length === 0 ? (
        <View style={styles.card}>
          <EmptyState icon="🧳" title="No bookings on file yet" body="Bookings connected to your account will appear here with their current status." />
        </View>
      ) : (
        <>
          <TextInput style={styles.searchInput} placeholder="Search by hotel or confirmation code" value={query} onChangeText={setQuery} />

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll} contentContainerStyle={styles.filterRow}>
            {filters.map((f) => {
              const selected = filter === f.key;
              return (
                <Pressable
                  key={f.key}
                  onPress={() => setFilter(f.key)}
                  style={({ pressed }) => [styles.filterPill, selected && styles.filterPillSelected, pressed && !selected && styles.filterPillPressed]}
                >
                  <Text style={[styles.filterPillText, selected && styles.filterPillTextSelected]}>
                    {f.label} ({f.count})
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {filtered.length === 0 ? (
            <View style={styles.card}>
              <EmptyState icon="🔍" title="No matching bookings" body="Try another search term or choose a different status." onClear={clearFilters} />
            </View>
          ) : (
            <View style={styles.list}>
              {pagedBookings.map((booking) => {
                const tone = bookingTone(booking);
                const nights = stayNights(booking);
                return (
                  <View key={booking.id} style={[styles.bookingCard, styles[`bookingCard_${tone}` as const]]}>
                    <View style={styles.bookingCardTop}>
                      <View style={[styles.statusBadge, styles[`statusBadge_${tone}` as const]]}>
                        <Text style={styles.statusBadgeText}>{statusLabel(booking)}</Text>
                      </View>
                      <Pressable
                        style={({ pressed }) => [styles.confirmationRow, pressed && styles.pressedDim]}
                        onPress={() => void handleCopy(booking)}
                      >
                        <Text style={styles.confirmationNo}>{booking.confirmationNo}</Text>
                        <Text style={styles.confirmationCopy}>{copiedId === booking.id ? "Copied ✓" : "Copy"}</Text>
                      </Pressable>
                    </View>
                    <Text style={styles.hotelName}>{booking.hotelName}</Text>
                    <Text style={styles.factLine}>
                      📅 {formatDate(booking.checkIn)} – {formatDate(booking.checkOut)}
                      {nights > 0 ? ` (${nights}N)` : ""}
                    </Text>
                    <Text style={styles.factLine}>🛏 {booking.roomTypeName}</Text>
                    <Text style={styles.factLine}>
                      💰 {formatMoney(booking.totalAmount, booking.currency)} · {booking.guestsCount} {booking.guestsCount === 1 ? "guest" : "guests"}
                    </Text>
                    <BookingOutcome booking={booking} />
                    {booking.caseId && (
                      <Pressable style={({ pressed }) => [styles.openCaseButton, pressed && styles.pressedDim]} onPress={() => openCase(booking.caseId!)}>
                        <Text style={styles.openCaseButtonText}>Open case →</Text>
                      </Pressable>
                    )}
                  </View>
                );
              })}
            </View>
          )}

          {totalPages > 1 && (
            <View style={styles.pagination}>
              <Text style={styles.paginationLabel}>
                Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
              </Text>
              <View style={styles.paginationButtons}>
                <Pressable
                  style={({ pressed }) => [styles.pageButton, page <= 1 && styles.pageButtonDisabled, pressed && page > 1 && styles.pageButtonPressed]}
                  onPress={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                >
                  <Text style={styles.pageButtonText}>← Prev</Text>
                </Pressable>
                <Text style={styles.pageIndicator}>
                  {page} / {totalPages}
                </Text>
                <Pressable
                  style={({ pressed }) => [styles.pageButton, page >= totalPages && styles.pageButtonDisabled, pressed && page < totalPages && styles.pageButtonPressed]}
                  onPress={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                >
                  <Text style={styles.pageButtonText}>Next →</Text>
                </Pressable>
              </View>
            </View>
          )}
        </>
      )}
      </Animated.View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f8fafc" },
  content: { padding: 16, paddingBottom: 88, gap: 12 },
  overline: { fontSize: 11, fontWeight: "700", color: "#7628e8", letterSpacing: 1.5 },
  title: { fontSize: 22, fontWeight: "700", color: "#0f172a" },
  subtitle: { fontSize: 13, color: "#64748b", marginBottom: 4 },
  card: { backgroundColor: "#fff", borderRadius: 14, padding: 16 },
  searchInput: { borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, backgroundColor: "#fff" },
  filterScroll: { flexGrow: 0 },
  filterRow: { flexDirection: "row", gap: 8, paddingVertical: 2 },
  filterPill: { borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: "#fff" },
  filterPillSelected: { backgroundColor: "#7628e8", borderColor: "#7628e8" },
  filterPillPressed: { backgroundColor: "#f1ebff", borderColor: "#c9b5f2" },
  filterPillText: { fontSize: 12, color: "#334155", fontWeight: "600" },
  filterPillTextSelected: { color: "#fff" },
  distributionBar: { flexDirection: "row", height: 6, borderRadius: 3, overflow: "hidden", backgroundColor: "#f1f5f9" },
  distributionSegment: { height: 6 },
  pressedDim: { opacity: 0.5 },
  list: { gap: 12 },
  bookingCard: { backgroundColor: "#fff", borderRadius: 14, padding: 16, gap: 4, borderWidth: 1, borderColor: "#e2e8f0" },
  bookingCard_attention: { borderColor: "#fdba74", backgroundColor: "#fff7ed" },
  bookingCard_confirmed: {},
  bookingCard_rebooked: { borderColor: "#bae6fd" },
  bookingCard_cancelled: { opacity: 0.75 },
  bookingCardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  statusBadge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: "#e2e8f0" },
  statusBadge_confirmed: { backgroundColor: "#d1fae5" },
  statusBadge_attention: { backgroundColor: "#fed7aa" },
  statusBadge_rebooked: { backgroundColor: "#bae6fd" },
  statusBadge_cancelled: { backgroundColor: "#e2e8f0" },
  statusBadgeText: { fontSize: 11, fontWeight: "700", color: "#0f172a" },
  confirmationRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  confirmationNo: { fontSize: 11, color: "#94a3b8", fontWeight: "600" },
  confirmationCopy: { fontSize: 10, color: "#7628e8", fontWeight: "700" },
  hotelName: { fontSize: 16, fontWeight: "700", color: "#0f172a" },
  factLine: { fontSize: 12, color: "#475569" },
  outcomeCancelled: { fontSize: 12, color: "#64748b", marginTop: 4 },
  outcomeClosed: { fontSize: 12, color: "#059669", marginTop: 4 },
  outcomeAttention: { fontSize: 12, color: "#c2410c", fontWeight: "600", marginTop: 4 },
  openCaseButton: { marginTop: 8, alignSelf: "flex-start" },
  openCaseButtonText: { fontSize: 13, color: "#7628e8", fontWeight: "700" },
  pagination: { gap: 8, alignItems: "center", marginTop: 4 },
  paginationLabel: { fontSize: 12, color: "#64748b" },
  paginationButtons: { flexDirection: "row", alignItems: "center", gap: 16 },
  pageButton: { backgroundColor: "#7628e8", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  pageButtonPressed: { backgroundColor: "#6220ca" },
  pageButtonDisabled: { backgroundColor: "#cbd5e1" },
  pageButtonText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  pageIndicator: { fontSize: 12, color: "#334155", fontWeight: "600" },
  empty: { alignItems: "center", paddingVertical: 24, gap: 4 },
  emptyIcon: { fontSize: 24 },
  emptyTitle: { fontSize: 14, fontWeight: "700", color: "#0f172a" },
  emptyBody: { fontSize: 12, color: "#64748b", textAlign: "center" },
  emptyClearButton: { marginTop: 10, backgroundColor: "#7628e8", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  emptyClearButtonText: { color: "#fff", fontSize: 12, fontWeight: "700" },
});
