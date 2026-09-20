import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, Easing, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { HomeStackParamList } from "../../navigation/HomeStack";
import * as api from "./api";
import type { CaseOption, CaseSummary, ConfirmExecutionResult, OptionType, PolicySummary } from "./types";

type Props = NativeStackScreenProps<HomeStackParamList, "OptionsFlow">;

// 通用功能优化需求.txt 第1条:一个案件的重订方案通常只有2-4个(defer/alternate/cancel顶多
// 加几个custom),不需要分页/搜索,加了反而是过度设计。第3条:方案状态变化(选中/生成新方案)
// 已经通过案件通知机制覆盖,这里不需要再加一套独立通知。

interface OptionPayload {
  hotel?: string;
  room_type?: string;
  fee_diff?: number;
  currency?: string;
  distance_km?: number;
  reason?: string;
  room_description?: string;
  room_amenities?: string[];
  room_image_urls?: string[];
  refund_amount?: number;
  cancellation_fee?: number;
  eta_business_days?: number;
  new_check_in_offset_days?: number;
  new_check_out_offset_days?: number;
}

function parsePayload(json: string): OptionPayload {
  try {
    return JSON.parse(json) as OptionPayload;
  } catch {
    return {};
  }
}

function addDaysToDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const OPTION_TITLES: Record<Exclude<OptionType, "custom">, string> = {
  defer: "Defer & keep original hotel",
  alternate: "Move to an alternative stay",
  cancel: "Cancel & refund",
};
const OPTION_DESCRIPTIONS: Record<Exclude<OptionType, "custom">, string> = {
  defer: "Move your stay dates while keeping the original hotel.",
  alternate: "Relocate to a suitable partner hotel.",
  cancel: "Cancel this booking and review the refund details.",
};
const OPTION_ICONS: Record<OptionType, string> = { defer: "🗓", alternate: "🏨", cancel: "✕", custom: "✨" };

function optionTitle(o: CaseOption) {
  return o.optionType === "custom" ? (o.customTitle ?? "Special offer") : OPTION_TITLES[o.optionType];
}

function feasibilityLabel(availability: CaseOption["availability"]) {
  if (availability === "unavailable") return "Not available";
  if (availability === "pending") return "Awaiting hotel confirmation";
  return "Available now";
}

function ProposeDatesModal({
  defaultCheckIn,
  defaultCheckOut,
  onCancel,
  onConfirm,
}: {
  defaultCheckIn: string;
  defaultCheckOut: string;
  onCancel: () => void;
  onConfirm: (checkIn: string, checkOut: string) => void;
}) {
  const [checkIn, setCheckIn] = useState(defaultCheckIn);
  const [checkOut, setCheckOut] = useState(defaultCheckOut);
  const valid = DATE_RE.test(checkIn) && DATE_RE.test(checkOut) && checkOut > checkIn;

  return (
    <Modal transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Propose different dates</Text>
          <Text style={styles.modalHint}>Not happy with the dates we suggested? Propose your own — we'll ask the hotel to reconfirm.</Text>
          <Text style={styles.modalLabel}>New check-in (YYYY-MM-DD)</Text>
          <TextInput style={styles.modalInput} value={checkIn} onChangeText={setCheckIn} placeholder="2026-08-20" />
          <Text style={styles.modalLabel}>New check-out (YYYY-MM-DD)</Text>
          <TextInput style={styles.modalInput} value={checkOut} onChangeText={setCheckOut} placeholder="2026-08-22" />
          <View style={styles.modalActions}>
            <Pressable style={({ pressed }) => [styles.modalCancelButton, pressed && styles.pressedDim]} onPress={onCancel}>
              <Text style={styles.modalCancelButtonText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.modalConfirmButton, !valid && styles.modalConfirmButtonDisabled, pressed && valid && styles.modalConfirmButtonPressed]}
              disabled={!valid}
              onPress={() => onConfirm(checkIn, checkOut)}
            >
              <Text style={styles.modalConfirmButtonText}>Send to hotel</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// 通用功能优化需求.txt 第2条:费用对比用一排横向条形图代替纯文字并排读数字,一眼看出
// 哪个方案更贵/更省——cancel 算净退款(负值=拿回钱),其它方案算净费用差额,
// 都没有 fee_diff/refund_amount 字段的方案(比如custom)不参与对比。
function FeeComparisonBar({ options }: { options: CaseOption[] }) {
  const rows = options
    .map((o) => {
      const payload = parsePayload(o.payloadJson);
      const net = o.optionType === "cancel" ? -(payload.refund_amount ?? 0) : (payload.fee_diff ?? null);
      return net === null ? null : { id: o.id, title: optionTitle(o), net, currency: payload.currency ?? "NZD" };
    })
    .filter((r): r is { id: string; title: string; net: number; currency: string } => r !== null);

  if (rows.length < 2) return null;
  const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.net)));

  return (
    <View style={styles.compareCard}>
      <Text style={styles.compareLabel}>COST COMPARISON</Text>
      {rows.map((r) => (
        <View key={r.id} style={styles.compareRow}>
          <Text style={styles.compareRowTitle} numberOfLines={1}>{r.title}</Text>
          <View style={styles.compareTrack}>
            <View
              style={[
                styles.compareFill,
                { width: `${(Math.abs(r.net) / maxAbs) * 100}%`, backgroundColor: r.net > 0 ? "#f87171" : r.net < 0 ? "#18c39c" : "#cbd5e1" },
              ]}
            />
          </View>
          <Text style={[styles.compareValue, r.net > 0 && styles.compareValuePositive, r.net < 0 && styles.compareValueNegative]}>
            {r.net > 0 ? "+" : ""}
            {r.net} {r.currency}
          </Text>
        </View>
      ))}
    </View>
  );
}

const STEP_ORDER: { key: "compare" | "confirm"; label: string }[] = [
  { key: "compare", label: "Compare" },
  { key: "confirm", label: "Confirm" },
];

// StepIndicator(参考Web端)评估后加了个轻量版:两个步骤用两个点+连线,不用完整的
// 编号步骤条——手机屏幕宽度有限,这页真正的"步骤"只有 compare/confirm 两个,
// policy 是从 compare 弹出的旁支(选完还是回 compare),用点阵比编号条更省空间。
function StepDots({ current }: { current: "compare" | "policy" | "confirm" }) {
  const effective = current === "policy" ? "compare" : current;
  const currentIndex = STEP_ORDER.findIndex((s) => s.key === effective);
  return (
    <View style={styles.stepDotsRow}>
      {STEP_ORDER.map((s, i) => (
        <View key={s.key} style={styles.stepDotGroup}>
          <View style={[styles.stepDot, i <= currentIndex && styles.stepDotDone, i === currentIndex && styles.stepDotActive]} />
          <Text style={[styles.stepDotLabel, i === currentIndex && styles.stepDotLabelActive]}>{s.label}</Text>
          {i < STEP_ORDER.length - 1 && <View style={styles.stepDotConnector} />}
        </View>
      ))}
    </View>
  );
}

function PayloadFacts({ o, caseInfo }: { o: CaseOption; caseInfo: CaseSummary | null }) {
  const payload = parsePayload(o.payloadJson);
  return (
    <View style={styles.factGrid}>
      {o.optionType !== "cancel" && o.optionType !== "custom" && <Text style={styles.factLine}>Hotel: {payload.hotel ?? "Same hotel"}</Text>}
      {payload.room_type && <Text style={styles.factLine}>Room type: {payload.room_type}</Text>}
      {payload.room_image_urls && payload.room_image_urls.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.roomPhotoRow}>
          {payload.room_image_urls.map((uri, i) => (
            <Image key={i} source={{ uri }} style={styles.roomPhoto} />
          ))}
        </ScrollView>
      )}
      {payload.room_description && <Text style={styles.factLine}>{payload.room_description}</Text>}
      {payload.room_amenities && payload.room_amenities.length > 0 && (
        <Text style={styles.factLine}>Amenities: {payload.room_amenities.join(", ")}</Text>
      )}
      {payload.distance_km !== undefined && <Text style={styles.factLine}>Distance: {payload.distance_km} km</Text>}
      {payload.fee_diff !== undefined && (
        <Text style={styles.factLine}>
          Fee difference: {payload.fee_diff >= 0 ? "+" : ""}
          {payload.fee_diff} {payload.currency}
        </Text>
      )}
      {payload.refund_amount !== undefined && (
        <Text style={styles.factLine}>Refund amount: {payload.refund_amount} {payload.currency}</Text>
      )}
      {payload.cancellation_fee !== undefined && (
        <Text style={styles.factLine}>Cancellation fee: {payload.cancellation_fee} {payload.currency}</Text>
      )}
      {payload.eta_business_days !== undefined && <Text style={styles.factLine}>Processing time: {payload.eta_business_days} business days</Text>}
      {o.optionType === "defer" && payload.new_check_in_offset_days !== undefined && caseInfo?.checkIn && (
        <Text style={styles.factLine}>New check-in: {addDaysToDate(caseInfo.checkIn, payload.new_check_in_offset_days)}</Text>
      )}
      {o.optionType === "defer" && payload.new_check_out_offset_days !== undefined && caseInfo?.checkIn && (
        <Text style={styles.factLine}>New check-out: {addDaysToDate(caseInfo.checkIn, payload.new_check_out_offset_days)}</Text>
      )}
      {payload.reason && <Text style={styles.factReason}>Why we suggest this: {payload.reason}</Text>}
    </View>
  );
}

export function OptionsFlowScreen({ route, navigation }: Props) {
  const { caseId } = route.params;

  const [options, setOptions] = useState<CaseOption[]>([]);
  const [caseInfo, setCaseInfo] = useState<CaseSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<"compare" | "policy" | "confirm">("compare");
  const [activeOptionId, setActiveOptionId] = useState<string | null>(null);
  const [policy, setPolicy] = useState<PolicySummary | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<ConfirmExecutionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proposeDatesTarget, setProposeDatesTarget] = useState<CaseOption | null>(null);

  // 通用页面优化需求.txt 第3条:compare→policy→confirm 目前是硬切,加一个淡入过渡——
  // 步骤切换时内容不是硬生生替换,而是先淡出旧内容再淡入新内容。
  const stepFade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    stepFade.setValue(0);
    Animated.timing(stepFade, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [step, stepFade]);

  const refresh = useCallback(async () => {
    const [optionsRes, caseRes] = await Promise.all([api.fetchOptions(caseId), api.fetchCase(caseId)]);
    if (optionsRes.code === 0) setOptions(optionsRes.data);
    if (caseRes.code === 0) setCaseInfo(caseRes.data);
    setLoading(false);
  }, [caseId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const activeOption = options.find((o) => o.id === activeOptionId) ?? null;
  const selectedOption = options.find((o) => o.selected) ?? null;

  async function handleSelect(optionId: string) {
    setError(null);
    const res = await api.selectOption(caseId, optionId);
    if (res.code !== 0) {
      setError(res.message);
      return;
    }
    await refresh();
  }

  async function handleProposeDates(optionId: string, newCheckIn: string, newCheckOut: string) {
    setError(null);
    const res = await api.proposeDeferDates(caseId, optionId, newCheckIn, newCheckOut);
    if (res.code !== 0) {
      setError(res.message);
      return;
    }
    if (!res.data.success) {
      setError(res.data.message);
      return;
    }
    setProposeDatesTarget(null);
    await refresh();
  }

  async function openPolicy(optionId: string) {
    setActiveOptionId(optionId);
    setStep("policy");
    setPolicy(null);
    const res = await api.fetchPolicy(caseId, optionId);
    if (res.code === 0) setPolicy(res.data);
  }

  async function handleConfirm() {
    if (!selectedOption) return;
    setConfirming(true);
    setError(null);
    try {
      const res = await api.confirmExecution(caseId, selectedOption.id);
      if (res.code !== 0) throw new Error(res.message);
      setResult(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit");
    } finally {
      setConfirming(false);
    }
  }

  const availableCount = options.filter((o) => o.availability !== "unavailable").length;
  const closed = caseInfo?.status === "closed";
  const finalOption = options.find((o) => o.selected) ?? null;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Pressable
        style={({ pressed }) => [styles.backButton, pressed && styles.pressedDim]}
        onPress={() => navigation.navigate("CaseConversation", { caseId })}
      >
        <Text style={styles.backButtonText}>← Back to Case Conversation</Text>
      </Pressable>

      {caseInfo && (
        <View style={styles.contextCard}>
          <View style={styles.contextRow}>
            <Text style={styles.contextLabel}>Hotel</Text>
            <Text style={styles.contextValue}>{caseInfo.hotelName ?? "Not recorded"}</Text>
          </View>
          <View style={styles.contextRow}>
            <Text style={styles.contextLabel}>Stay dates</Text>
            <Text style={styles.contextValue}>{caseInfo.checkIn && caseInfo.checkOut ? `${caseInfo.checkIn} → ${caseInfo.checkOut}` : "Not recorded"}</Text>
          </View>
          <View style={styles.contextRow}>
            <Text style={styles.contextLabel}>Available options</Text>
            <Text style={styles.contextValue}>
              {availableCount} / {options.length}
            </Text>
          </View>
        </View>
      )}

      <View style={styles.titleRow}>
        <Text style={styles.title}>Recovery Options</Text>
        {!loading && !closed && <StepDots current={step} />}
      </View>

      {!loading && !closed && step === "compare" && options.length > 1 && <FeeComparisonBar options={options} />}

      <Animated.View style={{ opacity: stepFade }}>
      {loading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color="#7628e8" />
          <Text style={styles.loadingText}>Loading options…</Text>
        </View>
      ) : closed ? (
        <View style={styles.resolvedBanner}>
          <Text style={styles.resolvedTitle}>This case is resolved</Text>
          <Text style={styles.resolvedBody}>The options stage is closed — no further selection is needed.</Text>
          {finalOption && (
            <Text style={styles.resolvedPick}>
              Final pick: {optionTitle(finalOption)}
              {finalOption.perkNames.length > 0 ? ` — includes ${finalOption.perkNames.join(", ")}` : ""}
            </Text>
          )}
          {options.map((o) => (
            <View key={o.id} style={[styles.optionCard, o.selected && styles.optionCardSelected]}>
              <View style={styles.optionHeader}>
                <Text style={styles.optionIcon}>{OPTION_ICONS[o.optionType]}</Text>
                <View style={styles.optionHeaderText}>
                  <Text style={styles.optionTitle}>{optionTitle(o)}</Text>
                </View>
                <Text style={o.selected ? styles.optionStatusSelected : styles.optionStatusMuted}>{o.selected ? "Final pick" : "Not chosen"}</Text>
              </View>
              <PayloadFacts o={o} caseInfo={caseInfo} />
            </View>
          ))}
        </View>
      ) : step === "compare" ? (
        <>
          <Text style={styles.hint}>Only options confirmed or ready for your review are shown.</Text>
          {options.length === 0 ? (
            <Text style={styles.emptyText}>No options available yet — check back soon or ask in your conversation.</Text>
          ) : (
            options.map((o) => {
              const disabled = o.availability === "unavailable";
              return (
                <View key={o.id} style={[styles.optionCard, disabled && styles.optionCardDisabled, o.selected && styles.optionCardSelected]}>
                  <View style={styles.optionHeader}>
                    <Text style={styles.optionIcon}>{OPTION_ICONS[o.optionType]}</Text>
                    <View style={styles.optionHeaderText}>
                      <Text style={styles.optionTitle}>{optionTitle(o)}</Text>
                      <Text style={styles.optionDesc}>{o.optionType === "custom" ? "A tailored recovery option for this stay." : OPTION_DESCRIPTIONS[o.optionType]}</Text>
                    </View>
                  </View>
                  <Text style={[styles.availabilityBadge, o.availability === "available" && styles.availabilityBadgeAvailable, o.availability === "unavailable" && styles.availabilityBadgeUnavailable]}>
                    {feasibilityLabel(o.availability)}
                  </Text>
                  {o.perkNames.length > 0 && <Text style={styles.factLine}>Includes: {o.perkNames.join(", ")}</Text>}
                  <PayloadFacts o={o} caseInfo={caseInfo} />
                  {disabled && <Text style={styles.disabledReason}>This option is no longer available.</Text>}

                  <View style={styles.optionActionsRow}>
                    <Pressable onPress={() => void openPolicy(o.id)} style={({ pressed }) => pressed && styles.pressedDim}>
                      <Text style={styles.linkButton}>View policy &amp; fees</Text>
                    </Pressable>
                    {o.optionType === "defer" && (
                      <Pressable onPress={() => setProposeDatesTarget(o)} style={({ pressed }) => pressed && styles.pressedDim}>
                        <Text style={styles.linkButton}>Propose different dates</Text>
                      </Pressable>
                    )}
                  </View>
                  <Pressable
                    style={({ pressed }) => [
                      styles.selectButton,
                      disabled && styles.selectButtonDisabled,
                      o.selected && styles.selectButtonSelected,
                      pressed && !disabled && styles.selectButtonPressed,
                    ]}
                    disabled={disabled}
                    onPress={() => void handleSelect(o.id)}
                  >
                    <Text style={styles.selectButtonText}>{o.selected ? "Selected ✓ — change" : "Select this option"}</Text>
                  </Pressable>
                </View>
              );
            })
          )}

          {error && <Text style={styles.errorText}>{error}</Text>}

          <View style={styles.selectionCard}>
            <Text style={styles.selectionLabel}>Your selection</Text>
            <Text style={styles.selectionTitle}>{selectedOption ? optionTitle(selectedOption) : "Choose a recovery option"}</Text>
            <Text style={styles.selectionBody}>
              {selectedOption ? "Review your selected option before submitting it for final processing." : "Select one of the available options above to continue."}
            </Text>
            <Pressable
              style={({ pressed }) => [styles.continueButton, !selectedOption && styles.continueButtonDisabled, pressed && !!selectedOption && styles.continueButtonPressed]}
              disabled={!selectedOption}
              onPress={() => setStep("confirm")}
            >
              <Text style={styles.continueButtonText}>Continue to confirm →</Text>
            </Pressable>
          </View>
        </>
      ) : step === "policy" && activeOption ? (
        <View style={styles.focusPanel}>
          <Pressable style={({ pressed }) => [styles.backLinkButton, pressed && styles.pressedDim]} onPress={() => setStep("compare")}>
            <Text style={styles.backLinkText}>← Back to options</Text>
          </Pressable>
          <Text style={styles.focusTitle}>{optionTitle(activeOption)} — policy &amp; fees</Text>
          {policy ? (
            <>
              {policy.excerpt ? (
                <View style={styles.policyExcerpt}>
                  <Text style={styles.policyExcerptHeader}>
                    Policy excerpt {policy.docName && `— ${policy.docName}`} {policy.docVersion && `(v${policy.docVersion})`}
                  </Text>
                  <Text style={styles.policyExcerptBody}>{policy.excerpt}</Text>
                </View>
              ) : (
                <Text style={styles.emptyText}>No specific policy excerpt matched — general terms apply.</Text>
              )}
              <View style={styles.feeBreakdown}>
                {Object.entries(parsePayload(policy.payloadJson))
                  .filter(([key]) => key !== "hotel_id")
                  .map(([key, value]) => (
                    <View key={key} style={styles.feeRow}>
                      <Text style={styles.feeRowKey}>{key.replace(/_/g, " ")}</Text>
                      <Text style={styles.feeRowValue}>{value != null ? String(value) : "Pending"}</Text>
                    </View>
                  ))}
              </View>
            </>
          ) : (
            <Text style={styles.emptyText}>Loading policy…</Text>
          )}
        </View>
      ) : step === "confirm" && selectedOption ? (
        <View style={styles.focusPanel}>
          <Pressable style={({ pressed }) => [styles.backLinkButton, pressed && styles.pressedDim]} onPress={() => setStep("compare")}>
            <Text style={styles.backLinkText}>← Back to options</Text>
          </Pressable>
          <Text style={styles.focusTitle}>Confirm: {optionTitle(selectedOption)}</Text>

          {!result ? (
            <>
              <PayloadFacts o={selectedOption} caseInfo={caseInfo} />
              <Text style={styles.confirmSummary}>
                Review the details above, then confirm to submit this choice
                {selectedOption.optionType !== "cancel" ? " — we'll notify the hotel." : " — a coordinator will confirm your refund."}
              </Text>
              {error && <Text style={styles.errorText}>{error}</Text>}
              <Pressable
                style={({ pressed }) => [styles.confirmButton, confirming && styles.confirmButtonDisabled, pressed && !confirming && styles.confirmButtonPressed]}
                disabled={confirming}
                onPress={() => void handleConfirm()}
              >
                {confirming ? <ActivityIndicator color="#fff" /> : <Text style={styles.confirmButtonText}>Confirm &amp; submit</Text>}
              </Pressable>
            </>
          ) : (
            <View style={styles.resultCard}>
              <Text style={styles.resultMessage}>{result.message}</Text>
              {result.outcome === "success" && (
                <View style={styles.voucher}>
                  <Text style={styles.voucherLine}>Confirmation: {result.newConfirmationNo}</Text>
                  {result.newCheckIn && result.newCheckOut && (
                    <Text style={styles.voucherLine}>
                      {result.newCheckIn} → {result.newCheckOut}
                    </Text>
                  )}
                </View>
              )}
              {(result.outcome === "failed" || result.outcome === "processing") && (
                <Pressable onPress={() => navigation.navigate("CaseConversation", { caseId })} style={({ pressed }) => pressed && styles.pressedDim}>
                  <Text style={styles.linkButton}>{result.outcome === "failed" ? "Chat with your coordinator →" : "Back to conversation →"}</Text>
                </Pressable>
              )}
            </View>
          )}
        </View>
      ) : null}
      </Animated.View>

      {proposeDatesTarget &&
        caseInfo?.checkIn &&
        (() => {
          const payload = parsePayload(proposeDatesTarget.payloadJson);
          const defaultCheckIn = payload.new_check_in_offset_days !== undefined ? addDaysToDate(caseInfo.checkIn, payload.new_check_in_offset_days) : "";
          const defaultCheckOut = payload.new_check_out_offset_days !== undefined ? addDaysToDate(caseInfo.checkIn, payload.new_check_out_offset_days) : "";
          return (
            <ProposeDatesModal
              defaultCheckIn={defaultCheckIn}
              defaultCheckOut={defaultCheckOut}
              onCancel={() => setProposeDatesTarget(null)}
              onConfirm={(ci, co) => void handleProposeDates(proposeDatesTarget.id, ci, co)}
            />
          );
        })()}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f8fafc" },
  content: { padding: 16, paddingBottom: 40, gap: 12 },
  pressedDim: { opacity: 0.5 },
  backButton: { alignSelf: "flex-start" },
  backButtonText: { fontSize: 13, color: "#7628e8", fontWeight: "700" },
  contextCard: { backgroundColor: "#fff", borderRadius: 12, padding: 14, gap: 6 },
  contextRow: { flexDirection: "row", justifyContent: "space-between" },
  contextLabel: { fontSize: 12, color: "#64748b" },
  contextValue: { fontSize: 12, color: "#0f172a", fontWeight: "700" },
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { fontSize: 20, fontWeight: "700", color: "#0f172a" },
  hint: { fontSize: 12, color: "#64748b" },
  stepDotsRow: { flexDirection: "row", alignItems: "center" },
  stepDotGroup: { flexDirection: "row", alignItems: "center" },
  stepDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#e2e8f0" },
  stepDotDone: { backgroundColor: "#c9b5f2" },
  stepDotActive: { backgroundColor: "#7628e8", width: 10, height: 10, borderRadius: 5 },
  stepDotLabel: { fontSize: 10, color: "#94a3b8", marginLeft: 4, marginRight: 6 },
  stepDotLabelActive: { color: "#7628e8", fontWeight: "700" },
  stepDotConnector: { width: 12, height: 1, backgroundColor: "#e2e8f0", marginRight: 6 },
  compareCard: { backgroundColor: "#fff", borderRadius: 14, padding: 16, gap: 10 },
  compareLabel: { fontSize: 11, fontWeight: "700", color: "#94a3b8", letterSpacing: 1 },
  compareRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  compareRowTitle: { width: 90, fontSize: 11, color: "#334155", fontWeight: "600" },
  compareTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: "#f1f5f9", overflow: "hidden" },
  compareFill: { height: 8, borderRadius: 4 },
  compareValue: { width: 76, fontSize: 11, color: "#64748b", fontWeight: "700", textAlign: "right" },
  compareValuePositive: { color: "#dc2626" },
  compareValueNegative: { color: "#059669" },
  loadingRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 30 },
  loadingText: { fontSize: 12, color: "#64748b" },
  emptyText: { fontSize: 12, color: "#94a3b8", textAlign: "center", paddingVertical: 16 },
  optionCard: { backgroundColor: "#fff", borderRadius: 14, padding: 16, gap: 6, borderWidth: 1, borderColor: "#e2e8f0" },
  optionCardDisabled: { opacity: 0.6 },
  optionCardSelected: { borderColor: "#7628e8", borderWidth: 2 },
  optionHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  optionIcon: { fontSize: 20 },
  optionHeaderText: { flex: 1, gap: 2 },
  optionTitle: { fontSize: 15, fontWeight: "700", color: "#0f172a" },
  optionDesc: { fontSize: 11, color: "#64748b" },
  optionStatusSelected: { fontSize: 11, color: "#7628e8", fontWeight: "700" },
  optionStatusMuted: { fontSize: 11, color: "#94a3b8", fontWeight: "600" },
  availabilityBadge: { alignSelf: "flex-start", fontSize: 10, fontWeight: "700", color: "#334155", backgroundColor: "#f1f5f9", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  availabilityBadgeAvailable: { backgroundColor: "#d1fae5", color: "#078c77" },
  availabilityBadgeUnavailable: { backgroundColor: "#fee2e2", color: "#991b1b" },
  factGrid: { gap: 2, marginTop: 2 },
  factLine: { fontSize: 12, color: "#475569" },
  factReason: { fontSize: 12, color: "#7628e8", fontStyle: "italic", marginTop: 2 },
  roomPhotoRow: { marginVertical: 4 },
  roomPhoto: { width: 96, height: 72, borderRadius: 8, marginRight: 8, backgroundColor: "#e2e8f0" },
  disabledReason: { fontSize: 11, color: "#dc2626" },
  optionActionsRow: { flexDirection: "row", gap: 16, marginTop: 6 },
  linkButton: { fontSize: 12, color: "#7628e8", fontWeight: "700" },
  selectButton: { marginTop: 8, backgroundColor: "#7628e8", borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  selectButtonPressed: { backgroundColor: "#6220ca" },
  selectButtonDisabled: { backgroundColor: "#cbd5e1" },
  selectButtonSelected: { backgroundColor: "#6220ca" },
  selectButtonText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  errorText: { color: "#dc2626", fontSize: 12 },
  selectionCard: { backgroundColor: "#fff", borderRadius: 14, padding: 16, gap: 6 },
  selectionLabel: { fontSize: 11, color: "#64748b", fontWeight: "700" },
  selectionTitle: { fontSize: 16, fontWeight: "700", color: "#0f172a" },
  selectionBody: { fontSize: 12, color: "#64748b" },
  continueButton: { marginTop: 8, backgroundColor: "#0f172a", borderRadius: 10, paddingVertical: 14, alignItems: "center" },
  continueButtonPressed: { backgroundColor: "#1e293b" },
  continueButtonDisabled: { backgroundColor: "#cbd5e1" },
  continueButtonText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  focusPanel: { backgroundColor: "#fff", borderRadius: 14, padding: 16, gap: 10 },
  backLinkButton: { alignSelf: "flex-start" },
  backLinkText: { fontSize: 12, color: "#7628e8", fontWeight: "700" },
  focusTitle: { fontSize: 16, fontWeight: "700", color: "#0f172a" },
  policyExcerpt: { backgroundColor: "#f1ebff", borderRadius: 10, padding: 12, gap: 4 },
  policyExcerptHeader: { fontSize: 11, fontWeight: "700", color: "#6220ca" },
  policyExcerptBody: { fontSize: 13, color: "#0f172a" },
  feeBreakdown: { gap: 4 },
  feeRow: { flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: "#f1f5f9", paddingVertical: 6 },
  feeRowKey: { fontSize: 12, color: "#64748b", textTransform: "capitalize" },
  feeRowValue: { fontSize: 12, color: "#0f172a", fontWeight: "600" },
  confirmSummary: { fontSize: 12, color: "#64748b" },
  confirmButton: { backgroundColor: "#7628e8", borderRadius: 10, paddingVertical: 14, alignItems: "center" },
  confirmButtonPressed: { backgroundColor: "#6220ca" },
  confirmButtonDisabled: { opacity: 0.6 },
  confirmButtonText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  resultCard: { gap: 8 },
  resultMessage: { fontSize: 14, color: "#0f172a", fontWeight: "600" },
  voucher: { backgroundColor: "#f1ebff", borderRadius: 10, padding: 12, gap: 4 },
  voucherLine: { fontSize: 13, color: "#6220ca", fontWeight: "600" },
  resolvedBanner: { backgroundColor: "#fff", borderRadius: 14, padding: 16, gap: 10 },
  resolvedTitle: { fontSize: 16, fontWeight: "700", color: "#0f172a" },
  resolvedBody: { fontSize: 12, color: "#64748b" },
  resolvedPick: { fontSize: 12, color: "#7628e8", fontWeight: "700" },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(15,23,42,0.5)", alignItems: "center", justifyContent: "center", padding: 20 },
  modalCard: { backgroundColor: "#fff", borderRadius: 14, padding: 20, gap: 8, width: "100%", maxWidth: 360 },
  modalTitle: { fontSize: 16, fontWeight: "700", color: "#0f172a" },
  modalHint: { fontSize: 12, color: "#64748b" },
  modalLabel: { fontSize: 12, fontWeight: "600", color: "#334155", marginTop: 6 },
  modalInput: { borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13 },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 12 },
  modalCancelButton: { paddingHorizontal: 14, paddingVertical: 10 },
  modalCancelButtonText: { fontSize: 13, color: "#64748b", fontWeight: "600" },
  modalConfirmButton: { backgroundColor: "#7628e8", borderRadius: 8, paddingHorizontal: 16, paddingVertical: 10 },
  modalConfirmButtonPressed: { backgroundColor: "#6220ca" },
  modalConfirmButtonDisabled: { backgroundColor: "#cbd5e1" },
  modalConfirmButtonText: { color: "#fff", fontWeight: "700", fontSize: 13 },
});
