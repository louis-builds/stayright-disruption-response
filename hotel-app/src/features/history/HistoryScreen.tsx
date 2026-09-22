import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, Easing, FlatList, Platform, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import type { CustomTag } from "../../shared/api/tags";
import * as tagsApi from "../../shared/api/tags";
import { GuestTagChips, TagManageModal } from "../../shared/components/GuestTags";
import { theme } from "../../shared/theme";
import { useMinLoadingDuration } from "../../shared/useMinLoadingDuration";
import type { DoneItem } from "./types";
import { useHistory } from "./useHistory";

type KindFilter = "inquiry" | "option";

function timeAgo(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const STATUS_STYLES: Record<DoneItem["statusTag"], { bg: string; fg: string }> = {
  accepted: { bg: theme.successSoft, fg: theme.success },
  confirmed: { bg: theme.successSoft, fg: theme.success },
  rejected: { bg: theme.dangerSoft, fg: theme.danger },
  declined: { bg: theme.dangerSoft, fg: theme.danger },
};

export function HistoryScreen() {
  const history = useHistory();
  const showLoading = useMinLoadingDuration(history.loading);
  const [tagTarget, setTagTarget] = useState<{ guestUserId: string; nickname: string } | null>(null);
  const [kindFilter, setKindFilter] = useState<KindFilter>("inquiry");

  const entrance = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (showLoading) return;
    Animated.timing(entrance, { toValue: 1, duration: 450, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [showLoading, entrance]);

  const visibleItems = useMemo(
    () => history.doneItems.filter((d) => d.kind === kindFilter),
    [history.doneItems, kindFilter],
  );
  const isFiltered = history.doneItems.length > 0 && visibleItems.length === 0;

  async function toggleTag(tag: CustomTag) {
    if (!tagTarget) return;
    const applied = (history.guestTags[tagTarget.guestUserId]?.customTags ?? []).some((t) => t.id === tag.id);
    if (applied) await tagsApi.removeTagFromGuest(tag.id, tagTarget.guestUserId);
    else await tagsApi.applyTagToGuest(tag.id, tagTarget.guestUserId);
    await history.reloadTagsFor(tagTarget.guestUserId);
  }

  async function createAndApplyTag(label: string) {
    if (!tagTarget) return;
    const res = await tagsApi.createCustomTag(label);
    if (res.code === 0) await tagsApi.applyTagToGuest(res.data.id, tagTarget.guestUserId);
    await history.reloadTagsFor(tagTarget.guestUserId);
  }

  function renderItem({ item: d }: { item: DoneItem }) {
    const statusStyle = STATUS_STYLES[d.statusTag];
    const isNegative = d.statusTag === "rejected" || d.statusTag === "declined";
    const ago = timeAgo(d.timestamp);
    return (
      <View style={styles.card}>
        <View style={styles.cardHeaderRow}>
          <Text style={styles.confText}>{d.confirmationNo}</Text>
          <Text style={styles.guestText}>{d.guestNickname}</Text>
        </View>
        <View style={styles.tagRow}>
          {d.isReturningGuest && (
            <View style={styles.tagInfo}>
              <Text style={styles.tagInfoText}>returning</Text>
            </View>
          )}
          {d.isHighValueGuest && (
            <View style={styles.tagVip}>
              <Text style={styles.tagVipText}>high value</Text>
            </View>
          )}
          <View style={[styles.tagStatus, { backgroundColor: statusStyle.bg }]}>
            <Text style={[styles.tagStatusText, { color: statusStyle.fg }]}>{d.statusTag}</Text>
          </View>
          <GuestTagChips guestUserId={d.guestUserId} nickname={d.guestNickname} tags={d.guestUserId ? history.guestTags[d.guestUserId] : undefined} onManage={setTagTarget} />
        </View>
        <Text style={styles.subtitle}>{d.label}</Text>
        {d.reason && <Text style={styles.metaText}>Reason: {d.reason}</Text>}
        {d.dateInfo && <Text style={styles.metaText}>{d.dateInfo}</Text>}
        {d.finalOutcome && <Text style={styles.alertText}>{d.finalOutcome}</Text>}
        {/* 这页是只读的已结案记录,没有像 Inbox 那样的操作按钮行——留个"已结案"的落款
            替代那一行的位置,让空白读起来是"这条到此为止"而不是"按钮还没做"。 */}
        <View style={styles.resolvedFooter}>
          <Text style={[styles.resolvedCheck, isNegative && styles.resolvedCheckNegative]}>{isNegative ? "✕" : "✓"}</Text>
          <Text style={styles.resolvedFooterText}>
            {isNegative ? "Closed" : "Resolved"}
            {ago ? ` · ${ago}` : ""}
          </Text>
        </View>
      </View>
    );
  }

  const header = (
    <View style={styles.headerBlock}>
      {history.doneItems.length > 0 && (
        <View style={styles.filterRow}>
          {(["inquiry", "option"] as KindFilter[]).map((k) => (
            <Pressable
              key={k}
              accessibilityRole="button"
              aria-selected={kindFilter === k}
              style={({ pressed }) => [styles.filterPill, kindFilter === k && styles.filterPillActive, pressed && kindFilter !== k && styles.filterPillPressed]}
              onPress={() => setKindFilter(k)}
            >
              <Text style={[styles.filterPillText, kindFilter === k && styles.filterPillTextActive]}>
                {k === "inquiry" ? "Requests" : "Selections"}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );

  const emptyState = (
    <View style={styles.caughtUp}>
      {isFiltered ? (
        <>
          <Text style={styles.caughtUpIcon}>🔍</Text>
          <Text style={styles.caughtUpTitle}>Nothing in this queue</Text>
          <Text style={styles.caughtUpBody}>Switch tabs to see the other request type.</Text>
        </>
      ) : (
        <>
          <Text style={styles.caughtUpIcon}>🗂️</Text>
          <Text style={styles.caughtUpTitle}>Nothing done yet</Text>
          <Text style={styles.caughtUpBody}>
            Once your team answers a disruption request or resolves a guest&apos;s rebooking selection over on To-dos,
            it&apos;ll show up here permanently as an audit trail.
          </Text>
        </>
      )}
    </View>
  );

  if (showLoading) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator size="large" color={theme.accent} />
      </View>
    );
  }

  return (
    <Animated.View style={[styles.screen, { opacity: entrance, transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }]}>
      <FlatList
        data={visibleItems}
        keyExtractor={(d) => d.id}
        renderItem={renderItem}
        ListHeaderComponent={header}
        ListEmptyComponent={emptyState}
        contentContainerStyle={[styles.listContent, history.doneItems.length === 0 && styles.listContentCentered]}
        refreshControl={<RefreshControl refreshing={history.refreshing} onRefresh={() => void history.refresh({ silent: true })} tintColor={theme.accent} />}
      />
      <TagManageModal
        visible={!!tagTarget}
        target={tagTarget}
        customTags={history.customTags}
        guestTags={tagTarget ? history.guestTags[tagTarget.guestUserId] : undefined}
        onToggle={(tag) => void toggleTag(tag)}
        onCreate={(label) => void createAndApplyTag(label)}
        onClose={() => setTagTarget(null)}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.background },
  loadingScreen: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.background },
  listContent: { padding: 16, paddingBottom: 40, gap: 12 },
  listContentCentered: { flexGrow: 1, justifyContent: "center" },
  headerBlock: { marginBottom: 8 },
  eyebrow: { fontSize: 11, fontWeight: "700", color: theme.accent, letterSpacing: 1, marginBottom: 2 },
  title: { fontSize: 22, fontWeight: "800", color: theme.ink, marginBottom: 12 },
  statsRow: { flexDirection: "row", gap: 10, marginBottom: 12 },
  statCard: { flex: 1, backgroundColor: theme.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: theme.borderLight, gap: 2 },
  statValue: { fontSize: 20, fontWeight: "800", color: theme.ink },
  statLabel: { fontSize: 11, color: theme.muted },
  statBadge: { fontSize: 10, color: theme.mutedDark, marginTop: 2 },
  ratioBarTrack: { flexDirection: "row", height: 5, borderRadius: 3, overflow: "hidden", marginTop: 4, backgroundColor: theme.borderLight },
  ratioBarGood: { backgroundColor: theme.success },
  ratioBarBad: { backgroundColor: theme.danger },
  filterRow: { flexDirection: "row", backgroundColor: "#fff", borderRadius: 12, padding: 4, gap: 4, marginBottom: 10 },
  filterPill: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 40, borderRadius: 8 },
  filterPillActive: { backgroundColor: "#7628e8" },
  filterPillPressed: { backgroundColor: "#f1f5f9" },
  filterPillText: { fontSize: 12, fontWeight: "700", color: "#64748b" },
  filterPillTextActive: { color: "#fff" },
  searchRow: { flexDirection: "row", gap: 8, marginBottom: 4 },
  searchInput: {
    flex: 1, borderWidth: 1, borderColor: theme.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9, fontSize: 13, color: theme.ink, backgroundColor: theme.surface,
    ...(Platform.OS === "web" ? { outlineStyle: "none" as const } : {}),
  },
  searchInputFocused: { borderColor: theme.accent, borderWidth: 1.5 },
  searchButton: { backgroundColor: theme.accent, borderRadius: 8, paddingHorizontal: 14, alignItems: "center", justifyContent: "center" },
  searchButtonText: { color: theme.surface, fontSize: 12, fontWeight: "700" },
  clearButton: { backgroundColor: theme.borderLight, borderRadius: 8, paddingHorizontal: 12, alignItems: "center", justifyContent: "center" },
  clearButtonText: { color: theme.mutedDark, fontSize: 12, fontWeight: "700" },
  buttonPressed: { opacity: 0.7 },
  card: { backgroundColor: theme.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: theme.borderLight, gap: 6 },
  resolvedFooter: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4, paddingTop: 8, borderTopWidth: 1, borderTopColor: theme.borderLight },
  resolvedCheck: { fontSize: 12, fontWeight: "800", color: theme.success },
  resolvedCheckNegative: { color: theme.danger },
  resolvedFooterText: { fontSize: 11, fontWeight: "600", color: theme.mutedDark },
  cardHeaderRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  confText: { fontSize: 12, color: theme.muted, fontVariant: ["tabular-nums"] },
  guestText: { fontSize: 15, fontWeight: "700", color: theme.ink },
  subtitle: { fontSize: 13, color: theme.mutedDark },
  metaText: { fontSize: 12, color: theme.muted },
  alertText: { fontSize: 12, color: theme.danger, fontWeight: "600" },
  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" },
  tagInfo: { backgroundColor: theme.accentSoft, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  tagInfoText: { fontSize: 10, color: theme.accent, fontWeight: "700" },
  tagVip: { backgroundColor: theme.successSoft, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  tagVipText: { fontSize: 10, color: theme.success, fontWeight: "700" },
  tagStatus: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  tagStatusText: { fontSize: 10, fontWeight: "700", textTransform: "capitalize" },
  caughtUp: { alignItems: "center", padding: 32, gap: 8 },
  caughtUpIcon: { fontSize: 36 },
  caughtUpTitle: { fontSize: 17, fontWeight: "700", color: theme.ink },
  caughtUpBody: { fontSize: 13, color: theme.muted, textAlign: "center", lineHeight: 19 },
});
