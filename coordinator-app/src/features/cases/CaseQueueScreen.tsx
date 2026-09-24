import type { NativeStackScreenProps } from "@react-navigation/native-stack";
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
  TextInput,
  View,
} from "react-native";
import type { CasesStackParamList } from "../../navigation/CasesStack";
import { escalationReasonLabel } from "../../shared/escalationLabels";
import type { CaseQueueItem, CaseQueueTab } from "./types";
import { useCaseQueue } from "./useCaseQueue";

type Props = NativeStackScreenProps<CasesStackParamList, "CaseQueue">;

const TABS: { key: CaseQueueTab; label: string }[] = [
  { key: "queue", label: "Alert" },
  { key: "todo", label: "Mine" },
  { key: "in_progress", label: "Open" },
  { key: "closed", label: "Closed" },
  { key: "search", label: "All" },
];

const PRIORITIES: { key: string; label: string }[] = [
  { key: "high", label: "High" },
  { key: "normal", label: "Normal" },
  { key: "low", label: "Low" },
];

// 后端 waitTime 是 C# TimeSpan 的原始 ToString()（比如 "10.08:47:55.9437650"），
// 直接展示给协调员看不懂——通用页面优化需求.txt 第2/3条说的"交互体验"里，
// 格式化成人话是最基本的一项，这里补上。
function formatWaitTime(raw: string): string {
  const match = /^(?:(\d+)\.)?(\d{1,2}):(\d{2}):(\d{2})/.exec(raw);
  if (!match) return raw;
  const days = Number(match[1] ?? 0);
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function PulsingBadge({ children, style, textStyle }: { children: string; style: object; textStyle: object }) {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.4, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <Animated.View style={[style, { opacity: pulse }]}>
      <Text style={textStyle}>{children}</Text>
    </Animated.View>
  );
}

function CaseCard({ item, onOpen }: { item: CaseQueueItem; onOpen: () => void }) {
  return (
    <Pressable style={({ pressed }) => [styles.card, pressed && styles.cardPressed]} onPress={onOpen}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>{item.guestNickname}</Text>
        <View style={[styles.priorityPill, item.priority === "high" && styles.priorityHigh]}>
          <Text style={styles.priorityPillText}>{item.priority}</Text>
        </View>
      </View>
      <Text style={styles.cardSubtitle}>{item.disruptionTitle}</Text>
      <View style={styles.cardMetaRow}>
        <Text style={styles.cardMeta}>{item.confirmationNo}</Text>
        <Text style={styles.cardMeta}>Waiting {formatWaitTime(item.waitTime)}</Text>
        {item.overdue && (
          <PulsingBadge style={styles.overdueBadge} textStyle={styles.overdueTag}>
            Overdue
          </PulsingBadge>
        )}
        {item.isHighValueGuest && <Text style={styles.vipTag}>VIP Guest</Text>}
      </View>
      {item.escalationReason && <Text style={styles.escalationReason}>Escalated: {escalationReasonLabel(item.escalationReason)}</Text>}
    </Pressable>
  );
}

export function CaseQueueScreen({ navigation }: Props) {
  const {
    tab,
    setTab,
    searchText,
    setSearchText,
    items,
    loading,
    refreshing,
    refresh,
    priorityFilter,
    setPriorityFilter,
    newCount,
    runSearch,
  } = useCaseQueue();

  const contentFade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!loading) {
      Animated.timing(contentFade, { toValue: 1, duration: 350, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
    }
  }, [loading, tab, contentFade]);

  const overdueCount = items.filter((it) => it.overdue).length;
  const vipCount = items.filter((it) => it.isHighValueGuest).length;

  return (
    <View style={styles.screen}>
      <View style={styles.tabBar}>
        {TABS.map((t) => (
          <Pressable
            key={t.key}
            style={({ pressed }) => [styles.tab, tab === t.key && styles.tabActive, pressed && tab !== t.key && styles.tabPressed]}
            onPress={() => setTab(t.key)}
          >
            <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]} numberOfLines={1} adjustsFontSizeToFit>
              {t.label}
            </Text>
            {t.key === "queue" && newCount > 0 && (
              <View style={styles.tabBadge}>
                <Text style={styles.tabBadgeText}>{newCount > 99 ? "99+" : newCount}</Text>
              </View>
            )}
          </Pressable>
        ))}
      </View>

      {/* 通用功能优化需求.txt 第4条:额外实用功能——一眼看到这个 Tab 下超时/重要客人有几个，
          不用逐条数卡片，对协调员排优先级有实际用处。 */}
      {!loading && items.length > 0 && (
        <View style={styles.statsBar}>
          <Text style={styles.statsText}>{items.length} case{items.length === 1 ? "" : "s"}</Text>
          {overdueCount > 0 && <Text style={[styles.statsText, styles.statsOverdue]}>{overdueCount} overdue</Text>}
          {vipCount > 0 && <Text style={[styles.statsText, styles.statsVip]}>{vipCount} VIP</Text>}
        </View>
      )}

      {tab === "search" && (
      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search booking, guest or case…"
          value={searchText}
          onChangeText={setSearchText}
          onSubmitEditing={() => runSearch()}
          returnKeyType="search"
        />
      </View>
      )}

      <View style={styles.filterRow}>
        <Pressable
          style={({ pressed }) => [styles.filterPill, priorityFilter === null && styles.filterPillSelected, pressed && priorityFilter !== null && styles.filterPillPressed]}
          onPress={() => setPriorityFilter(null)}
        >
          <Text style={[styles.filterPillText, priorityFilter === null && styles.filterPillTextSelected]}>All</Text>
        </Pressable>
        {PRIORITIES.map((p) => (
          <Pressable
            key={p.key}
            style={({ pressed }) => [styles.filterPill, priorityFilter === p.key && styles.filterPillSelected, pressed && priorityFilter !== p.key && styles.filterPillPressed]}
            onPress={() => setPriorityFilter(p.key)}
          >
            <Text style={[styles.filterPillText, priorityFilter === p.key && styles.filterPillTextSelected]}>{p.label}</Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <View style={styles.centerFill}>
          <ActivityIndicator size="large" />
        </View>
      ) : (
        <Animated.View style={{ flex: 1, opacity: contentFade }}>
          <FlatList
            data={items}
            keyExtractor={(it) => it.caseId}
            contentContainerStyle={styles.listContent}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
            ListEmptyComponent={<Text style={styles.empty}>No cases match these filters</Text>}
            renderItem={({ item }) => (
              <CaseCard item={item} onOpen={() => navigation.navigate("CaseDetail", { caseId: item.caseId })} />
            )}
          />
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f1f5f9" },
  tabBar: { flexDirection: "row", backgroundColor: "#fff", borderRadius: 12, padding: 4, gap: 4, marginHorizontal: 16, marginTop: 12, marginBottom: 4 },
  tab: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, minHeight: 40, borderRadius: 8, paddingHorizontal: 2 },
  tabPressed: { backgroundColor: "#f1f5f9" },
  tabActive: { backgroundColor: "#7628e8" },
  tabText: { fontSize: 12, fontWeight: "700", color: "#64748b" },
  tabTextActive: { color: "#fff" },
  tabBadge: { backgroundColor: "#ef4444", borderRadius: 999, minWidth: 16, height: 16, alignItems: "center", justifyContent: "center", paddingHorizontal: 3 },
  tabBadgeText: { color: "#fff", fontSize: 9, fontWeight: "700" },
  statsBar: { flexDirection: "row", gap: 12, paddingHorizontal: 12, paddingTop: 10 },
  statsText: { fontSize: 11, color: "#64748b", fontWeight: "600" },
  statsOverdue: { color: "#dc2626" },
  statsVip: { color: "#b45309" },
  searchRow: { paddingHorizontal: 12, paddingTop: 8 },
  searchInput: { backgroundColor: "#fff", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 13, borderWidth: 1, borderColor: "#e2e8f0" },
  filterRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 16, paddingVertical: 8 },
  filterPill: { borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: "#fff" },
  filterPillSelected: { backgroundColor: "#7628e8", borderColor: "#7628e8" },
  filterPillPressed: { backgroundColor: "#f1ebff", borderColor: "#c9b5f2" },
  filterPillText: { fontSize: 12, color: "#334155", fontWeight: "600" },
  filterPillTextSelected: { color: "#fff" },
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { padding: 12, gap: 10 },
  empty: { textAlign: "center", color: "#94a3b8", marginTop: 40 },
  card: { backgroundColor: "#fff", borderRadius: 12, padding: 14, marginBottom: 10, gap: 6 },
  cardPressed: { backgroundColor: "#f8fafc" },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardTitle: { fontSize: 15, fontWeight: "700", color: "#0f172a" },
  priorityPill: { backgroundColor: "#e2e8f0", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  priorityHigh: { backgroundColor: "#fee2e2" },
  priorityPillText: { fontSize: 10, color: "#475569", textTransform: "uppercase" },
  cardSubtitle: { fontSize: 12, color: "#475569" },
  cardMetaRow: { flexDirection: "row", gap: 10, alignItems: "center", flexWrap: "wrap" },
  cardMeta: { fontSize: 11, color: "#94a3b8" },
  overdueBadge: { backgroundColor: "#fee2e2", borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1 },
  overdueTag: { fontSize: 10, color: "#dc2626", fontWeight: "700" },
  vipTag: { fontSize: 10, color: "#b45309", fontWeight: "700" },
  escalationReason: { fontSize: 11, color: "#7c3aed" },
});
