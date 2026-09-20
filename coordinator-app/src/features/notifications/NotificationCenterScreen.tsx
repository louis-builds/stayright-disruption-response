import { CommonActions, useNavigation } from "@react-navigation/native";
import { useEffect, useRef } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { NotificationItem } from "./types";
import { useNotifications } from "./useNotifications";

// 通用功能优化需求.txt 的图形化报表一条对通知中心不适用(消息流不是统计数据),
// 跳过不硬加;分页/搜索/通知机制本页自身就是通知机制,已具备。

function NotificationRow({ item, onPress }: { item: NotificationItem; onPress: () => void }) {
  const unread = item.readAt === null;
  const unreadFade = useRef(new Animated.Value(unread ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(unreadFade, { toValue: unread ? 1 : 0, duration: 350, useNativeDriver: true }).start();
  }, [unread, unreadFade]);

  return (
    <Pressable style={({ pressed }) => [styles.row, pressed && styles.rowPressed]} onPress={onPress}>
      <Animated.View style={[styles.rowUnreadOverlay, { opacity: unreadFade }]} pointerEvents="none" />
      {unread && <View style={styles.unreadDot} />}
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle}>{item.title}</Text>
        <Text style={styles.rowText} numberOfLines={2}>{item.body}</Text>
        <Text style={styles.rowMeta}>{new Date(item.sentAt).toLocaleString()}</Text>
      </View>
    </Pressable>
  );
}

export function NotificationCenterScreen() {
  const navigation = useNavigation();
  const { items, unreadOnly, setUnreadOnly, unreadCount, loading, refreshing, refresh, markRead } = useNotifications();
  const entrance = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!loading) {
      entrance.setValue(0);
      Animated.timing(entrance, { toValue: 1, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }
  }, [loading, entrance]);

  async function handlePress(item: NotificationItem) {
    if (item.readAt === null) await markRead(item.id);
    if (item.caseId) {
      navigation.dispatch(
        CommonActions.navigate({ name: "Cases", params: { screen: "CaseDetail", params: { caseId: item.caseId } } }),
      );
    }
  }

  return (
    <View style={styles.screen}>
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
      </View>

      {loading ? (
        <View style={styles.centerFill}>
          <ActivityIndicator size="large" />
        </View>
      ) : (
        <Animated.View style={{ flex: 1, opacity: entrance }}>
          <FlatList
            data={items}
            keyExtractor={(n) => n.id}
            contentContainerStyle={styles.listContent}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
            ListEmptyComponent={<Text style={styles.empty}>No notifications</Text>}
            renderItem={({ item }) => <NotificationRow item={item} onPress={() => void handlePress(item)} />}
          />
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f1f5f9" },
  tabsWrap: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  tabs: { flexDirection: "row", backgroundColor: "#fff", borderRadius: 12, padding: 4, gap: 4 },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 40, borderRadius: 8 },
  tabActive: { backgroundColor: "#7628e8" },
  tabPressed: { backgroundColor: "#f1f5f9" },
  tabText: { fontSize: 12, fontWeight: "700", color: "#64748b" },
  tabTextActive: { color: "#fff" },
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { padding: 12, gap: 8 },
  empty: { textAlign: "center", color: "#94a3b8", marginTop: 40 },
  row: { flexDirection: "row", backgroundColor: "#fff", borderRadius: 10, padding: 12, gap: 8, marginBottom: 8, overflow: "hidden" },
  rowPressed: { opacity: 0.7 },
  rowUnreadOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "#eef2ff" },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#4f46e5", marginTop: 6 },
  rowBody: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 13, fontWeight: "700", color: "#0f172a" },
  rowText: { fontSize: 12, color: "#475569" },
  rowMeta: { fontSize: 10, color: "#94a3b8" },
});
