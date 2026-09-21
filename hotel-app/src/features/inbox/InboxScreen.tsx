import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, Easing, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from "react-native";
import * as tagsApi from "../../shared/api/tags";
import type { CustomTag } from "../../shared/api/tags";
import { GuestTagChips, TagManageModal } from "../../shared/components/GuestTags";
import { useNetworkStatus } from "../../shared/network/useNetworkStatus";
import { theme } from "../../shared/theme";
import { useMinLoadingDuration } from "../../shared/useMinLoadingDuration";
import type { HotelPerk, SelectedOptionItem, TodoItem } from "./types";
import { useInbox } from "./useInbox";

type KindFilter = "inquiry" | "option";

// item.waitTime 是后端 TimeSpan 直接序列化的字符串(如"02:53:48.0388480")，不适合展示给用户；
// requestedAt 是 ISO 时间，前端自己算等待时长更可靠也更好看，跟 History 页 timeAgo 同一个思路。
function formatWaitDuration(iso: string): string {
  const ms = Math.max(0, Date.now() - new Date(iso).getTime());
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function parsePayload(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function ModalShell({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: React.ReactNode }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.modalCard}>{children}</View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function RejectModal({ visible, title, onCancel, onConfirm }: { visible: boolean; title: string; onCancel: () => void; onConfirm: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // submitting(state) 驱动UI，但两次点击之间 setState 还没重渲染前是有空隙的；
  // ref 是同步的，真正堵住双击/自动化测试连点导致的重复提交。
  const inFlight = useRef(false);
  return (
    <ModalShell visible={visible} onClose={onCancel}>
      <Text style={styles.modalTitle}>{title}</Text>
      <Text style={styles.modalLabel}>Reason (required)</Text>
      <TextInput style={[styles.input, styles.textArea]} value={reason} onChangeText={setReason} multiline placeholder="Why is this being rejected?" />
      <View style={styles.modalActions}>
        <Pressable style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]} disabled={submitting} onPress={onCancel}>
          <Text style={styles.secondaryButtonText}>Cancel</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.dangerButton, (!reason.trim() || submitting) && styles.buttonDisabled, pressed && styles.buttonPressed]}
          disabled={!reason.trim() || submitting}
          onPress={async () => {
            if (inFlight.current) return;
            inFlight.current = true;
            setSubmitting(true);
            await onConfirm(reason.trim());
            inFlight.current = false;
            setSubmitting(false);
          }}
        >
          {submitting ? <ActivityIndicator size="small" color={theme.danger} /> : <Text style={styles.dangerButtonText}>Confirm reject</Text>}
        </Pressable>
      </View>
    </ModalShell>
  );
}

function PerkCheckboxes({ perks, selected, onToggle }: { perks: HotelPerk[]; selected: string[]; onToggle: (name: string) => void }) {
  if (perks.length === 0) return <Text style={styles.emptyHint}>No perks yet — add some in Hotel Profile.</Text>;
  return (
    <View style={styles.perkList}>
      {perks.map((p) => {
        const checked = selected.includes(p.name);
        return (
          <Pressable key={p.id} style={({ pressed }) => [styles.perkChip, pressed && styles.buttonPressed]} onPress={() => onToggle(p.name)}>
            <View style={[styles.checkbox, checked && styles.checkboxChecked]}>{checked && <Text style={styles.checkboxMark}>✓</Text>}</View>
            <Text style={styles.perkChipText}>{p.name}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function PerksModal({ visible, option, perks, onCancel, onConfirm }: {
  visible: boolean;
  option: SelectedOptionItem | null;
  perks: HotelPerk[];
  onCancel: () => void;
  onConfirm: (perkNames: string[]) => Promise<void>;
}) {
  const [selected, setSelected] = useState<string[]>(option?.perkNames ?? []);
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);
  return (
    <ModalShell visible={visible} onClose={onCancel}>
      <Text style={styles.modalTitle}>Add perks — {option?.confirmationNo}</Text>
      <PerkCheckboxes
        perks={perks}
        selected={selected}
        onToggle={(name) => setSelected((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]))}
      />
      <View style={styles.modalActions}>
        <Pressable style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]} disabled={submitting} onPress={onCancel}>
          <Text style={styles.secondaryButtonText}>Cancel</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.primaryButton, submitting && styles.buttonDisabled, pressed && styles.buttonPressed]}
          disabled={submitting}
          onPress={async () => {
            if (inFlight.current) return;
            inFlight.current = true;
            setSubmitting(true);
            await onConfirm(selected);
            inFlight.current = false;
            setSubmitting(false);
          }}
        >
          {submitting ? <ActivityIndicator size="small" color={theme.surface} /> : <Text style={styles.primaryButtonText}>Save perks</Text>}
        </Pressable>
      </View>
    </ModalShell>
  );
}

function CustomOptionModal({ visible, confirmationNo, perks, onCancel, onConfirm }: {
  visible: boolean;
  confirmationNo: string;
  perks: HotelPerk[];
  onCancel: () => void;
  onConfirm: (title: string, perkNames: string[]) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);
  return (
    <ModalShell visible={visible} onClose={onCancel}>
      <Text style={styles.modalTitle}>Offer custom option — {confirmationNo}</Text>
      <Text style={styles.modalLabel}>Title (e.g. Free room upgrade)</Text>
      <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="Custom option title" />
      <PerkCheckboxes perks={perks} selected={selected} onToggle={(name) => setSelected((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]))} />
      <View style={styles.modalActions}>
        <Pressable
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
          disabled={submitting}
          onPress={onCancel}
        >
          <Text style={styles.secondaryButtonText}>Cancel</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.primaryButton, (!title.trim() || submitting) && styles.buttonDisabled, pressed && styles.buttonPressed]}
          disabled={!title.trim() || submitting}
          onPress={async () => {
            if (inFlight.current) return;
            inFlight.current = true;
            setSubmitting(true);
            await onConfirm(title.trim(), selected);
            inFlight.current = false;
            setSubmitting(false);
          }}
        >
          <Text style={styles.primaryButtonText}>{submitting ? "Offering…" : "Offer option"}</Text>
        </Pressable>
      </View>
    </ModalShell>
  );
}

export function InboxScreen() {
  const inbox = useInbox();
  const isOnline = useNetworkStatus();
  const showLoading = useMinLoadingDuration(inbox.loading);
  const [rejectTarget, setRejectTarget] = useState<{ kind: "inquiry" | "option"; id: string; label: string } | null>(null);
  const [perksTarget, setPerksTarget] = useState<SelectedOptionItem | null>(null);
  const [customOptionTarget, setCustomOptionTarget] = useState<{ caseId: string; confirmationNo: string } | null>(null);
  const [tagTarget, setTagTarget] = useState<{ guestUserId: string; nickname: string } | null>(null);
  const [kindFilter, setKindFilter] = useState<KindFilter>("inquiry");

  // entrance 挂在 showLoading 而不是 mount：这个组件在 loading 分支时压根不渲染
  // Animated.View(见下面的 early return),挂在 mount 上会在真实内容装上之前就播完，等于没播。
  const entrance = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (showLoading) return;
    Animated.timing(entrance, { toValue: 1, duration: 450, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [showLoading, entrance]);

  const visibleItems = useMemo(
    () => inbox.todoItems.filter((d) => d.kind === kindFilter),
    [inbox.todoItems, kindFilter],
  );
  const isFiltered = inbox.todoItems.length > 0 && visibleItems.length === 0;

  async function doReject(reason: string) {
    if (!rejectTarget) return;
    if (rejectTarget.kind === "inquiry") await inbox.rejectInquiry(rejectTarget.id, reason);
    else await inbox.rejectOption(rejectTarget.id, reason);
    setRejectTarget(null);
  }

  async function toggleTag(tag: CustomTag) {
    if (!tagTarget) return;
    const applied = (inbox.guestTags[tagTarget.guestUserId]?.customTags ?? []).some((t) => t.id === tag.id);
    if (applied) await tagsApi.removeTagFromGuest(tag.id, tagTarget.guestUserId);
    else await tagsApi.applyTagToGuest(tag.id, tagTarget.guestUserId);
    await inbox.reloadTagsFor(tagTarget.guestUserId);
  }

  async function createAndApplyTag(label: string) {
    if (!tagTarget) return;
    const res = await tagsApi.createCustomTag(label);
    if (res.code === 0) await tagsApi.applyTagToGuest(res.data.id, tagTarget.guestUserId);
    await inbox.reloadTagsFor(tagTarget.guestUserId);
  }

  function renderItem({ item: d }: { item: TodoItem }) {
    if (d.kind === "inquiry") {
      const item = d.item;
      return (
        <View style={[styles.card, item.overdue && styles.cardUrgent]}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.confText}>{item.confirmationNo}</Text>
            <Text style={styles.guestText}>{item.guestNickname}</Text>
          </View>
          <View style={styles.tagRow}>
            {item.guestCommitted && (
              <View style={styles.tagWarn}>
                <Text style={styles.tagWarnText}>guest confirmed</Text>
              </View>
            )}
            {item.isReturningGuest && (
              <View style={styles.tagInfo}>
                <Text style={styles.tagInfoText}>returning</Text>
              </View>
            )}
            {item.isHighValueGuest && (
              <View style={styles.tagVip}>
                <Text style={styles.tagVipText}>high value</Text>
              </View>
            )}
            <GuestTagChips guestUserId={item.guestUserId} nickname={item.guestNickname} tags={item.guestUserId ? inbox.guestTags[item.guestUserId] : undefined} onManage={setTagTarget} />
          </View>
          <Text style={styles.subtitle}>
            {item.disruptionTitle} · {item.roomTypeName} · {item.checkIn} → {item.checkOut}
          </Text>
          {item.proposedNewCheckIn && item.proposedNewCheckOut && (
            <Text style={styles.metaText}>
              {item.guestCommitted
                ? `Guest confirmed this deferral — on your approval it moves to ~${item.proposedNewCheckIn} → ${item.proposedNewCheckOut} (estimated)`
                : `If confirmed, deferred to ~${item.proposedNewCheckIn} → ${item.proposedNewCheckOut} (estimated)`}
            </Text>
          )}
          <Text style={styles.metaText}>Waiting {formatWaitDuration(item.requestedAt)}</Text>
          {item.overdue && <Text style={styles.alertText}>overdue — please respond soon</Text>}
          {!isOnline && <Text style={styles.offlineHint}>You&apos;re offline — reconnect to confirm, reject or offer options</Text>}
          <View style={styles.actionsRow}>
            <Pressable
              style={({ pressed }) => [styles.primaryButton, !isOnline && styles.buttonDisabled, pressed && styles.buttonPressed]}
              disabled={!isOnline || inbox.busyIds.has(item.id)}
              onPress={() => void inbox.confirmInquiry(item.id, item.proposedNewCheckIn, item.proposedNewCheckOut)}
            >
              {inbox.busyIds.has(item.id) ? <ActivityIndicator size="small" color={theme.surface} /> : <Text style={styles.primaryButtonText}>Confirm deferral</Text>}
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.secondaryButton, !isOnline && styles.buttonDisabled, pressed && styles.buttonPressed]}
              disabled={!isOnline}
              onPress={() => setCustomOptionTarget({ caseId: item.caseId, confirmationNo: item.confirmationNo })}
            >
              <Text style={styles.secondaryButtonText}>+ Custom option</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.dangerButton, !isOnline && styles.buttonDisabled, pressed && styles.buttonPressed]}
              disabled={!isOnline}
              onPress={() => setRejectTarget({ kind: "inquiry", id: item.id, label: item.confirmationNo })}
            >
              <Text style={styles.dangerButtonText}>Reject</Text>
            </Pressable>
          </View>
        </View>
      );
    }
    const o = d.item;
    const payload = parsePayload(o.payloadJson);
    return (
      <View style={styles.card}>
        <View style={styles.cardHeaderRow}>
          <Text style={styles.confText}>{o.confirmationNo}</Text>
          <Text style={styles.guestText}>{o.guestNickname}</Text>
        </View>
        <View style={styles.tagRow}>
          {o.isReturningGuest && (
            <View style={styles.tagInfo}>
              <Text style={styles.tagInfoText}>returning</Text>
            </View>
          )}
          {o.isHighValueGuest && (
            <View style={styles.tagVip}>
              <Text style={styles.tagVipText}>high value</Text>
            </View>
          )}
          <GuestTagChips guestUserId={o.guestUserId} nickname={o.guestNickname} tags={o.guestUserId ? inbox.guestTags[o.guestUserId] : undefined} onManage={setTagTarget} />
        </View>
        <Text style={styles.subtitle}>
          {o.optionType}
          {typeof payload.room_type === "string" ? ` · ${payload.room_type}` : ""}
        </Text>
        {!isOnline && <Text style={styles.offlineHint}>You&apos;re offline — reconnect to confirm, reject or offer options</Text>}
        <View style={styles.actionsRow}>
          <Pressable
            style={({ pressed }) => [styles.primaryButton, !isOnline && styles.buttonDisabled, pressed && styles.buttonPressed]}
            disabled={!isOnline || inbox.busyIds.has(o.optionId)}
            onPress={() => void inbox.confirmOption(o.optionId)}
          >
            {inbox.busyIds.has(o.optionId) ? <ActivityIndicator size="small" color={theme.surface} /> : <Text style={styles.primaryButtonText}>Confirm availability</Text>}
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.secondaryButton, !isOnline && styles.buttonDisabled, pressed && styles.buttonPressed]}
            disabled={!isOnline}
            onPress={() => setPerksTarget(o)}
          >
            <Text style={styles.secondaryButtonText}>Add perks{o.perkNames.length > 0 ? ` (${o.perkNames.length})` : ""}</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.secondaryButton, !isOnline && styles.buttonDisabled, pressed && styles.buttonPressed]}
            disabled={!isOnline}
            onPress={() => setCustomOptionTarget({ caseId: o.caseId, confirmationNo: o.confirmationNo })}
          >
            <Text style={styles.secondaryButtonText}>+ Custom option</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.dangerButton, !isOnline && styles.buttonDisabled, pressed && styles.buttonPressed]}
            disabled={!isOnline}
            onPress={() => setRejectTarget({ kind: "option", id: o.optionId, label: o.confirmationNo })}
          >
            <Text style={styles.dangerButtonText}>Reject</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const header = (
    <View style={styles.headerBlock}>
      {inbox.todoItems.length > 0 && (
        <View style={styles.filterRow}>
          {(["inquiry", "option"] as KindFilter[]).map((k) => (
            <Pressable
              key={k}
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
          <Text style={styles.caughtUpBody}>Switch tabs to see the other request type, or wait for new guest requests.</Text>
        </>
      ) : (
        <>
          <Text style={styles.caughtUpIcon}>✅</Text>
          <Text style={styles.caughtUpTitle}>You&apos;re all caught up</Text>
          <Text style={styles.caughtUpBody}>
            No pending disruption deferral requests or guest rebooking selections right now. New requests will show up here
            as soon as a disruption affects one of your bookings or a guest confirms a plan.
          </Text>
          {inbox.profileSnapshot && (
            <View style={styles.snapshotRow}>
              <View style={styles.snapshotItem}>
                <Text style={styles.snapshotValue}>{inbox.profileSnapshot.roomTypeCount}</Text>
                <Text style={styles.snapshotLabel}>room types listed</Text>
              </View>
              <View style={styles.snapshotItem}>
                <Text style={styles.snapshotValue}>{inbox.perks.length}</Text>
                <Text style={styles.snapshotLabel}>perks available to offer</Text>
              </View>
              <View style={styles.snapshotItem}>
                <Text style={styles.snapshotValueSm}>{inbox.profileSnapshot.address}</Text>
                <Text style={styles.snapshotLabel}>{inbox.profileSnapshot.name}</Text>
              </View>
            </View>
          )}
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
        keyExtractor={(d) => (d.kind === "inquiry" ? `inq-${d.item.id}` : `opt-${d.item.optionId}`)}
        renderItem={renderItem}
        ListHeaderComponent={header}
        ListEmptyComponent={emptyState}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={inbox.refreshing} onRefresh={() => void inbox.refresh({ silent: true })} tintColor={theme.accent} />}
      />

      <RejectModal
        key={rejectTarget ? `${rejectTarget.kind}-${rejectTarget.id}` : "reject-empty"}
        visible={!!rejectTarget}
        title={`Reject ${rejectTarget?.label ?? ""}`}
        onCancel={() => setRejectTarget(null)}
        onConfirm={(r) => doReject(r)}
      />
      <PerksModal
        key={perksTarget?.optionId ?? "perks-empty"}
        visible={!!perksTarget}
        option={perksTarget}
        perks={inbox.perks}
        onCancel={() => setPerksTarget(null)}
        onConfirm={async (p) => {
          if (perksTarget) await inbox.saveOptionPerks(perksTarget.optionId, p);
          setPerksTarget(null);
        }}
      />
      <CustomOptionModal
        key={customOptionTarget?.confirmationNo ?? "custom-empty"}
        visible={!!customOptionTarget}
        confirmationNo={customOptionTarget?.confirmationNo ?? ""}
        perks={inbox.perks}
        onCancel={() => setCustomOptionTarget(null)}
        onConfirm={async (title, p) => {
          if (customOptionTarget) await inbox.offerCustomOption(customOptionTarget.caseId, title, p);
          setCustomOptionTarget(null);
        }}
      />
      <TagManageModal
        visible={!!tagTarget}
        target={tagTarget}
        customTags={inbox.customTags}
        guestTags={tagTarget ? inbox.guestTags[tagTarget.guestUserId] : undefined}
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
  headerBlock: { marginBottom: 8 },
  eyebrow: { fontSize: 11, fontWeight: "700", color: theme.accent, letterSpacing: 1, marginBottom: 2 },
  title: { fontSize: 22, fontWeight: "800", color: theme.ink, marginBottom: 4 },
  syncText: { fontSize: 12, color: theme.muted, marginBottom: 12 },
  statsRow: { flexDirection: "row", gap: 10, marginBottom: 12 },
  statCard: { flex: 1, backgroundColor: theme.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: theme.borderLight, gap: 2 },
  statCardUrgent: { borderColor: theme.danger },
  statValue: { fontSize: 20, fontWeight: "800", color: theme.ink },
  statLabel: { fontSize: 11, color: theme.muted },
  statBadge: { fontSize: 10, color: theme.mutedDark, marginTop: 2 },
  statBadgeUrgent: { fontSize: 10, color: theme.danger, fontWeight: "700", marginTop: 2 },
  card: { backgroundColor: theme.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: theme.borderLight, gap: 6 },
  cardUrgent: { borderColor: theme.danger },
  cardHeaderRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  confText: { fontSize: 12, color: theme.muted, fontVariant: ["tabular-nums"] },
  guestText: { fontSize: 15, fontWeight: "700", color: theme.ink },
  subtitle: { fontSize: 13, color: theme.mutedDark },
  metaText: { fontSize: 12, color: theme.muted },
  alertText: { fontSize: 12, color: theme.danger, fontWeight: "600" },
  offlineHint: { fontSize: 11, color: theme.danger, fontWeight: "600" },
  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" },
  tagWarn: { backgroundColor: theme.warningSoft, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  tagWarnText: { fontSize: 10, color: theme.warning, fontWeight: "700" },
  tagInfo: { backgroundColor: theme.accentSoft, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  tagInfoText: { fontSize: 10, color: theme.accent, fontWeight: "700" },
  tagVip: { backgroundColor: theme.successSoft, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  tagVipText: { fontSize: 10, color: theme.success, fontWeight: "700" },
  actionsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 },
  // minWidth 防止 loading 态换成小圆 spinner 后按钮变窄、同行的 "+ Custom option"/"Reject" 跟着
  // 往左挤——真机上快速连点两下，第二下有概率落在挤过来的邻居按钮上，而不是被 inFlightIds 拦住原地。
  primaryButton: { backgroundColor: theme.accent, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9, alignItems: "center", justifyContent: "center", minWidth: 124 },
  primaryButtonText: { color: theme.surface, fontSize: 12, fontWeight: "700" },
  secondaryButton: { backgroundColor: theme.borderLight, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9, alignItems: "center", justifyContent: "center" },
  secondaryButtonText: { color: theme.ink, fontSize: 12, fontWeight: "700" },
  dangerButton: { backgroundColor: theme.dangerSoft, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9, alignItems: "center", justifyContent: "center" },
  dangerButtonText: { color: theme.danger, fontSize: 12, fontWeight: "700" },
  buttonDisabled: { opacity: 0.5 },
  buttonPressed: { opacity: 0.7 },
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
  caughtUp: { alignItems: "center", padding: 32, gap: 8 },
  caughtUpIcon: { fontSize: 36 },
  caughtUpTitle: { fontSize: 17, fontWeight: "700", color: theme.ink },
  caughtUpBody: { fontSize: 13, color: theme.muted, textAlign: "center", lineHeight: 19 },
  snapshotRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 20, marginTop: 20, width: "100%" },
  snapshotItem: { alignItems: "center", gap: 2, minWidth: 100, maxWidth: 200 },
  snapshotValue: { fontSize: 18, fontWeight: "800", color: theme.accent },
  snapshotValueSm: { fontSize: 12, fontWeight: "700", color: theme.ink, textAlign: "center" },
  snapshotLabel: { fontSize: 10, color: theme.muted, textAlign: "center" },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(32,36,56,0.5)", alignItems: "center", justifyContent: "center", padding: 20 },
  modalCard: { backgroundColor: theme.surface, borderRadius: 16, padding: 20, width: "100%", maxWidth: 420, gap: 10 },
  modalTitle: { fontSize: 16, fontWeight: "800", color: theme.ink },
  modalLabel: { fontSize: 12, color: theme.mutedDark, fontWeight: "600" },
  input: { borderWidth: 1, borderColor: theme.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: theme.ink, textAlignVertical: "center" },
  textArea: { minHeight: 70, textAlignVertical: "top" },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 4 },
  perkList: { gap: 4, maxHeight: 220 },
  perkChip: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 },
  checkbox: { width: 18, height: 18, borderRadius: 4, borderWidth: 1.5, borderColor: theme.border, alignItems: "center", justifyContent: "center" },
  checkboxChecked: { backgroundColor: theme.accent, borderColor: theme.accent },
  checkboxMark: { color: theme.surface, fontSize: 12, fontWeight: "700" },
  perkChipText: { fontSize: 13, color: theme.ink },
  emptyHint: { fontSize: 12, color: theme.muted, fontStyle: "italic" },
});
