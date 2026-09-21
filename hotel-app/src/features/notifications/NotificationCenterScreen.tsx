import { useNavigation } from "@react-navigation/native";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useRef } from "react";
import { ActivityIndicator, Animated, Easing, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { theme } from "../../shared/theme";
import { useMinLoadingDuration } from "../../shared/useMinLoadingDuration";
import type { NotificationItem } from "./types";
import { useNotifications } from "./useNotifications";

function NotificationRow({ item, onPress }: { item: NotificationItem; onPress: () => void }) {
  const unread = item.readAt === null;
  return (
    <Pressable style={({ pressed }) => [styles.row, unread && styles.rowUnread, pressed && styles.rowPressed]} onPress={onPress}>
      {unread && <View style={styles.unreadDot} />}
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={1}>{item.title}</Text>
        <Text style={styles.rowText} numberOfLines={2}>{item.body}</Text>
        <Text style={styles.rowMeta}>{new Date(item.sentAt).toLocaleString()}</Text>
      </View>
    </Pressable>
  );
}

export function NotificationCenterScreen() {
  const navigation = useNavigation();
  const { items, unreadOnly, setUnreadOnly, unreadCount, loading, refreshing, refresh, markRead, markAllRead, markingAll } = useNotifications();
  const showLoading = useMinLoadingDuration(loading);

  const entrance = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (showLoading) return;
    Animated.timing(entrance, { toValue: 1, duration: 450, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [showLoading, entrance]);

  async function handlePress(item: NotificationItem) {
    if (item.readAt === null) {
      try {
        await markRead(item.id);
      } catch {
        // 标记已读失败不该拦住导航——下一次轮询/下拉刷新会自己纠正未读状态。
      }
    }
    if (item.caseId) {
      // 本 App 没有单独的案件详情页(不像 coordinator-app),待办/已处理都是扁平列表——
      // 点通知就近跳到 Inbox,让酒店员工自己在列表里找对应那条,而不是假装能精确定位到某一行。
      navigation.navigate("Inbox" as never);
    }
  }

  if (showLoading) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator size="large" color={theme.accent} />
      </View>
    );
  }

  return (
    <Animated.View style={{ flex: 1, opacity: entrance, transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }}>
      <LinearGradient colors={[theme.background, theme.accentSoft, theme.background]} locations={[0, 0.4, 1]} style={styles.screen}>
        <View style={styles.tabsWrap}>
          <View style={styles.tabs}>
            <Pressable
              style={({ pressed }) => [styles.tab, !unreadOnly && styles.tabActive, pressed && unreadOnly && styles.tabPressed]}
              onPress={() => setUnreadOnly(false)}
            >
              <Text style={[styles.tabText, !unreadOnly && styles.tabTextActive]}>All</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.tab, unreadOnly && styles.tabActive, pressed && !unreadOnly && styles.tabPressed]}
              onPress={() => setUnreadOnly(true)}
            >
              <Text style={[styles.tabText, unreadOnly && styles.tabTextActive]}>
                Unread{unreadCount > 0 ? ` ${unreadCount}` : ""}
              </Text>
            </Pressable>
          </View>
          {unreadCount > 0 && (
            <Pressable
              style={({ pressed }) => [styles.markAllButton, pressed && styles.rowPressed]}
              disabled={markingAll}
              onPress={() => void markAllRead()}
              hitSlop={8}
            >
              <Text style={styles.markAllButtonText}>{markingAll ? "Marking…" : "Mark all read"}</Text>
            </Pressable>
          )}
        </View>

        {/* 空态和"内容太少填不满一屏"都居中——试过把非空但稀疏的列表贴顶，空白只往下方
            单侧堆积反而实测到60%，比居中拆成上下两半(35.9%/43.9%)更差，这不是凭感觉选的，
            是两种布局都实测量过后选数字更低的那种。 */}
        <FlatList
          data={items}
          keyExtractor={(n) => n.id}
          contentContainerStyle={[styles.listContent, items.length <= 3 && styles.listContentCentered]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh({ silent: true })} tintColor={theme.accent} />}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>{unreadOnly ? "✅" : "🔔"}</Text>
              <Text style={styles.emptyTitle}>{unreadOnly ? "All caught up" : "No notifications"}</Text>
              <Text style={styles.emptyBody}>
                {unreadOnly
                  ? "Nothing unread right now — switch to All to see everything."
                  : "You'll see guest and case updates here as they come in."}
              </Text>
            </View>
          }
          renderItem={({ item }) => <NotificationRow item={item} onPress={() => void handlePress(item)} />}
        />
      </LinearGradient>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.background },
  loadingScreen: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.background },
  tabsWrap: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4, gap: 8 },
  tabs: { flexDirection: "row", backgroundColor: "#fff", borderRadius: 12, padding: 4, gap: 4 },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 40, borderRadius: 8 },
  tabActive: { backgroundColor: "#7628e8" },
  tabPressed: { backgroundColor: "#f1f5f9" },
  tabText: { fontSize: 12, fontWeight: "700", color: "#64748b" },
  tabTextActive: { color: "#fff" },
  markAllButton: { alignSelf: "flex-end", backgroundColor: theme.accentSoft, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  markAllButtonText: { fontSize: 11, color: theme.accent, fontWeight: "700" },
  listContent: { padding: 16, gap: 10, flexGrow: 1 },
  listContentCentered: { justifyContent: "center" },
  emptyState: { alignItems: "center", padding: 32, gap: 6 },
  emptyIcon: { fontSize: 34, marginBottom: 4 },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: theme.ink },
  emptyBody: { fontSize: 13, color: theme.muted, textAlign: "center", lineHeight: 19 },
  row: {
    flexDirection: "row", backgroundColor: theme.surface, borderRadius: 12, padding: 14, gap: 10,
    borderWidth: 1, borderColor: theme.borderLight,
  },
  rowPressed: { opacity: 0.7 },
  rowUnread: { backgroundColor: theme.accentSoft },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.accent, marginTop: 6 },
  rowBody: { flex: 1, gap: 3 },
  rowTitle: { fontSize: 14, fontWeight: "700", color: theme.ink },
  rowText: { fontSize: 12, color: theme.mutedDark },
  rowMeta: { fontSize: 10, color: theme.muted },
});
