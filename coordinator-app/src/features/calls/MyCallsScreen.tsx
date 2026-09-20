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
import type { CallsStackParamList } from "../../navigation/CallsStack";
import type { Call, CalleeType } from "./types";
import { useMyCalls } from "./useMyCalls";

// 通用功能优化需求.txt 的图形化报表一条:这页本来就是个人通话流水,没有量级支撑图表,
// 跳过不硬加;分页/搜索已有(FlatList懒加载+现成搜索框),额外实用功能见下方统计条。

type Props = NativeStackScreenProps<CallsStackParamList, "MyCalls">;

const STATUS_LABELS: Record<string, string> = {
  connecting: "Connecting",
  in_progress: "In progress",
  completed: "Completed",
  failed: "Failed",
  no_answer: "No answer",
};

function CallRow({ item, onPress }: { item: Call; onPress: () => void }) {
  const playable = item.status === "completed";
  return (
    <Pressable
      style={({ pressed }) => [styles.row, !playable && styles.rowDisabled, pressed && playable && styles.rowPressed]}
      onPress={onPress}
      disabled={!playable}
    >
      <View style={styles.rowHeader}>
        <Text style={styles.rowTitle}>{item.guestNickname ?? "—"}</Text>
        <Text style={[styles.rowStatus, item.status === "failed" && styles.rowStatusFailed, item.status === "no_answer" && styles.rowStatusMuted]}>
          {STATUS_LABELS[item.status] ?? item.status}
        </Text>
      </View>
      <Text style={styles.rowSub}>
        {item.calleeType === "guest" ? "Call Guest" : "Call Hotel"} · {item.hotelName ?? "—"}
        {item.confirmationNo ? ` · ${item.confirmationNo}` : ""}
      </Text>
      <Text style={styles.rowMeta}>
        {new Date(item.startedAt).toLocaleString()}
        {item.durationSeconds !== null ? ` · ${item.durationSeconds}s` : ""}
      </Text>
    </Pressable>
  );
}

export function MyCallsScreen({ navigation }: Props) {
  const {
    calls, loading, refreshing, refresh,
    calleeTypeFilter, setCalleeTypeFilter, statusFilter, setStatusFilter,
    searchText, setSearchText,
  } = useMyCalls();

  const calleeOptions: { key: CalleeType | null; label: string }[] = [
    { key: null, label: "All types" },
    { key: "guest", label: "Guest" },
    { key: "hotel", label: "Hotel" },
  ];
  const statusOptions: { key: string | null; label: string }[] = [
    { key: null, label: "All statuses" },
    { key: "completed", label: "Completed" },
    { key: "failed", label: "Failed" },
    { key: "no_answer", label: "No answer" },
  ];

  const entrance = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!loading) {
      entrance.setValue(0);
      Animated.timing(entrance, { toValue: 1, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }
  }, [loading, entrance]);

  return (
    <View style={styles.screen}>
      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search booking, guest or case…"
          value={searchText}
          onChangeText={setSearchText}
        />
      </View>
      <View style={styles.filterRow}>
        {calleeOptions.map((o) => (
          <Pressable
            key={o.label}
            style={({ pressed }) => [styles.filterPill, calleeTypeFilter === o.key && styles.filterPillSelected, pressed && calleeTypeFilter !== o.key && styles.filterPillPressed]}
            onPress={() => setCalleeTypeFilter(o.key)}
          >
            <Text style={[styles.filterPillText, calleeTypeFilter === o.key && styles.filterPillTextSelected]}>{o.label}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.filterRow}>
        {statusOptions.map((o) => (
          <Pressable
            key={o.label}
            style={({ pressed }) => [styles.filterPill, statusFilter === o.key && styles.filterPillSelected, pressed && statusFilter !== o.key && styles.filterPillPressed]}
            onPress={() => setStatusFilter(o.key)}
          >
            <Text style={[styles.filterPillText, statusFilter === o.key && styles.filterPillTextSelected]}>{o.label}</Text>
          </Pressable>
        ))}
      </View>

      {!loading && (
        <Text style={styles.statsText}>{calls.length} call{calls.length === 1 ? "" : "s"}</Text>
      )}

      {loading ? (
        <View style={styles.centerFill}>
          <ActivityIndicator size="large" />
        </View>
      ) : (
        <Animated.View style={{ flex: 1, opacity: entrance }}>
          <FlatList
            data={calls}
            keyExtractor={(c) => c.id}
            contentContainerStyle={styles.listContent}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
            ListEmptyComponent={<Text style={styles.empty}>No calls yet</Text>}
            renderItem={({ item }) => (
              <CallRow item={item} onPress={() => navigation.navigate("RecordingDetail", { callId: item.id })} />
            )}
          />
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f1f5f9" },
  searchRow: { paddingHorizontal: 12, paddingTop: 12 },
  searchInput: { backgroundColor: "#fff", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 13, borderWidth: 1, borderColor: "#e2e8f0" },
  filterRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 16, paddingVertical: 8 },
  filterPill: { borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: "#fff" },
  filterPillSelected: { backgroundColor: "#7628e8", borderColor: "#7628e8" },
  filterPillPressed: { backgroundColor: "#f1ebff", borderColor: "#c9b5f2" },
  filterPillText: { fontSize: 12, color: "#334155", fontWeight: "600" },
  filterPillTextSelected: { color: "#fff" },
  statsText: { fontSize: 11, color: "#94a3b8", paddingHorizontal: 12, paddingTop: 10 },
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { padding: 12, gap: 8 },
  empty: { textAlign: "center", color: "#94a3b8", marginTop: 40 },
  row: { backgroundColor: "#fff", borderRadius: 12, padding: 12, marginBottom: 8, gap: 4 },
  rowPressed: { backgroundColor: "#f8fafc" },
  rowDisabled: { opacity: 0.6 },
  rowHeader: { flexDirection: "row", justifyContent: "space-between" },
  rowTitle: { fontSize: 14, fontWeight: "700", color: "#0f172a" },
  rowStatus: { fontSize: 11, color: "#4f46e5", fontWeight: "700" },
  rowStatusFailed: { color: "#dc2626" },
  rowStatusMuted: { color: "#94a3b8" },
  rowSub: { fontSize: 11, color: "#475569" },
  rowMeta: { fontSize: 10, color: "#94a3b8" },
});
