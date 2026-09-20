import { CommonActions, useNavigation } from "@react-navigation/native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, Easing, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as api from "./api";
import type { NotificationItem } from "./types";

const PAGE_SIZE = 15;
const POLL_INTERVAL_MS = 20_000;

type Filter = "all" | "unread";

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

// 通用功能优化需求.txt 第2条:通知列表没有值得图形化的维度——已读/未读已经是筛选tab的口径,
// 类型/时间分布对一份提醒性质的列表意义不大,不为了"看起来高级"硬造一个图表。
function NotificationCard({ item, opening, onPress }: { item: NotificationItem; opening: boolean; onPress: () => void }) {
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [fade]);
  const readFade = useRef(new Animated.Value(item.readAt ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(readFade, { toValue: item.readAt ? 1 : 0, duration: 250, useNativeDriver: false }).start();
  }, [item.readAt, readFade]);
  const backgroundColor = readFade.interpolate({ inputRange: [0, 1], outputRange: ["#f1ebff", "#ffffff"] });
  const borderColor = readFade.interpolate({ inputRange: [0, 1], outputRange: ["#c9b5f2", "#e2e8f0"] });

  return (
    <Animated.View style={{ opacity: fade, transform: [{ translateY: fade.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }}>
      <Pressable onPress={onPress} disabled={opening}>
        {({ pressed }) => (
          <Animated.View style={[styles.card, { backgroundColor, borderColor }, pressed && styles.cardPressed]}>
            <View style={styles.cardTop}>
              <Text style={styles.cardStatusIcon}>{item.readAt ? "✓" : "!"}</Text>
              <Text style={styles.cardTitle}>{item.disruptionTitle ?? item.title}</Text>
              {opening && <ActivityIndicator size="small" color="#7628e8" />}
            </View>
            <Text style={styles.cardBody}>{item.body}</Text>
            <View style={styles.cardMetaRow}>
              {item.disruptionType && (
                <View style={styles.tag}>
                  <Text style={styles.tagText}>{item.disruptionType}</Text>
                </View>
              )}
              {item.affectedCheckIn && <Text style={styles.cardMeta}>Affects check-in {item.affectedCheckIn}</Text>}
              <Text style={styles.cardTime}>{formatDate(item.sentAt)}</Text>
            </View>
          </Animated.View>
        )}
      </Pressable>
    </Animated.View>
  );
}

export function NotificationCenterScreen() {
  const navigation = useNavigation();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [markingAll, setMarkingAll] = useState(false);

  const entrance = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(entrance, { toValue: 1, duration: 400, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [entrance]);

  const load = useCallback(
    async (targetPage: number, unreadOnly: boolean) => {
      const res = await api.fetchNotifications(targetPage, PAGE_SIZE, unreadOnly);
      if (res.code === 0) {
        setItems((prev) => (targetPage === 1 ? res.data.list : [...prev, ...res.data.list]));
        setTotal(res.data.total);
      }
    },
    [],
  );

  useEffect(() => {
    setLoading(true);
    setPage(1);
    void load(1, filter === "unread").then(() => setLoading(false));
  }, [filter, load]);

  // 全平台通知列表跟首页一样按 20 秒轮询——收到系统推送后 App 内也要同步能看到对应通知,
  // 不能只有系统通知栏有、App 内列表要等用户手动下拉刷新才刷出来。
  useEffect(() => {
    const timer = setInterval(() => {
      if (page === 1) void load(1, filter === "unread");
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [filter, page, load]);

  async function onRefresh() {
    setRefreshing(true);
    setPage(1);
    await load(1, filter === "unread");
    setRefreshing(false);
  }

  async function loadMore() {
    if (loadingMore || items.length >= total) return;
    setLoadingMore(true);
    const nextPage = page + 1;
    await load(nextPage, filter === "unread");
    setPage(nextPage);
    setLoadingMore(false);
  }

  async function openNotification(item: NotificationItem) {
    setOpeningId(item.id);
    try {
      await api.markNotificationRead(item.id);
      setItems((prev) => prev.map((n) => (n.id === item.id ? { ...n, readAt: new Date().toISOString() } : n)));
      if (item.caseId) {
        navigation.dispatch(CommonActions.navigate({ name: "Home", params: { screen: "CaseConversation", params: { caseId: item.caseId } } }));
      }
    } finally {
      setOpeningId(null);
    }
  }

  // 通用功能优化需求.txt 第4条:批量标记已读——只对当前已加载的这批(用户实际看到的),
  // 不是对数据库里这个用户所有历史通知发起未知规模的批量请求。
  const unreadLoadedCount = items.filter((n) => !n.readAt).length;
  async function markAllRead() {
    const unread = items.filter((n) => !n.readAt);
    if (unread.length === 0) return;
    setMarkingAll(true);
    try {
      await Promise.all(unread.map((n) => api.markNotificationRead(n.id)));
      const now = new Date().toISOString();
      setItems((prev) => prev.map((n) => (n.readAt ? n : { ...n, readAt: now })));
    } finally {
      setMarkingAll(false);
    }
  }

  const visibleItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((n) => [n.title, n.disruptionTitle, n.body, n.disruptionType].some((f) => f?.toLowerCase().includes(q)));
  }, [items, query]);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor="#7628e8" />}
      onScroll={({ nativeEvent }) => {
        const paddingToBottom = 80;
        if (nativeEvent.layoutMeasurement.height + nativeEvent.contentOffset.y >= nativeEvent.contentSize.height - paddingToBottom) {
          void loadMore();
        }
      }}
      scrollEventThrottle={200}
    >
      <Animated.View style={{ opacity: entrance, transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }], gap: 12 }}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>Notifications</Text>
        {unreadLoadedCount > 0 && (
          <Pressable onPress={() => void markAllRead()} disabled={markingAll} style={({ pressed }) => pressed && styles.pressedDim}>
            {markingAll ? <ActivityIndicator size="small" color="#7628e8" /> : <Text style={styles.markAllText}>Mark all read</Text>}
          </Pressable>
        )}
      </View>

      <TextInput style={styles.searchInput} placeholder="Search notifications" value={query} onChangeText={setQuery} />

      <View style={styles.filterRow}>
        <Pressable
          style={({ pressed }) => [styles.filterPill, filter === "all" && styles.filterPillSelected, pressed && filter !== "all" && styles.filterPillPressed]}
          onPress={() => setFilter("all")}
        >
          <Text style={[styles.filterPillText, filter === "all" && styles.filterPillTextSelected]}>All</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.filterPill, filter === "unread" && styles.filterPillSelected, pressed && filter !== "unread" && styles.filterPillPressed]}
          onPress={() => setFilter("unread")}
        >
          <Text style={[styles.filterPillText, filter === "unread" && styles.filterPillTextSelected]}>Unread</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color="#7628e8" />
          <Text style={styles.loadingText}>Loading notifications…</Text>
        </View>
      ) : visibleItems.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>🔔</Text>
          <Text style={styles.emptyTitle}>{query ? "No matches" : filter === "unread" ? "No unread notifications" : "All quiet for now"}</Text>
          <Text style={styles.emptyBody}>{query ? "Try a different search term." : "New disruption notices and case updates will appear here automatically."}</Text>
        </View>
      ) : (
        <View style={styles.list}>
          {visibleItems.map((item) => (
            <NotificationCard key={item.id} item={item} opening={openingId === item.id} onPress={() => void openNotification(item)} />
          ))}
          {loadingMore && (
            <View style={styles.loadingRow}>
              <ActivityIndicator color="#7628e8" />
            </View>
          )}
          {!loadingMore && items.length < total && <Text style={styles.moreHint}>Scroll for more ({total - items.length} remaining)</Text>}
        </View>
      )}
      </Animated.View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f8fafc" },
  content: { padding: 16, paddingBottom: 88, gap: 12 },
  pressedDim: { opacity: 0.5 },
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { fontSize: 22, fontWeight: "700", color: "#0f172a" },
  markAllText: { fontSize: 12, color: "#7628e8", fontWeight: "700" },
  searchInput: { borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, backgroundColor: "#fff" },
  filterRow: { flexDirection: "row", gap: 8 },
  filterPill: { borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: "#fff" },
  filterPillSelected: { backgroundColor: "#7628e8", borderColor: "#7628e8" },
  filterPillPressed: { backgroundColor: "#f1ebff", borderColor: "#c9b5f2" },
  filterPillText: { fontSize: 12, color: "#334155", fontWeight: "600" },
  filterPillTextSelected: { color: "#fff" },
  loadingRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 30 },
  loadingText: { fontSize: 12, color: "#64748b" },
  empty: { alignItems: "center", paddingVertical: 40, gap: 6, backgroundColor: "#fff", borderRadius: 14 },
  emptyIcon: { fontSize: 24 },
  emptyTitle: { fontSize: 14, fontWeight: "700", color: "#0f172a" },
  emptyBody: { fontSize: 12, color: "#64748b", textAlign: "center", paddingHorizontal: 24 },
  list: { gap: 10 },
  card: { borderRadius: 12, padding: 14, gap: 6, borderWidth: 1 },
  cardPressed: { opacity: 0.8 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardStatusIcon: { fontSize: 13, color: "#7628e8", width: 16, textAlign: "center" },
  cardTitle: { flex: 1, fontSize: 14, fontWeight: "700", color: "#0f172a" },
  cardBody: { fontSize: 12, color: "#64748b" },
  cardMetaRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 2 },
  tag: { backgroundColor: "#e2e8f0", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  tagText: { fontSize: 10, color: "#334155", fontWeight: "600" },
  cardMeta: { fontSize: 10, color: "#94a3b8" },
  cardTime: { fontSize: 10, color: "#94a3b8", marginLeft: "auto" },
  moreHint: { fontSize: 11, color: "#94a3b8", textAlign: "center", paddingVertical: 8 },
});
