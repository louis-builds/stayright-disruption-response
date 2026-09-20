import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import * as api from "./api";
import type { AdminOption } from "./types";

const OPTION_TITLES: Record<string, string> = {
  defer: "Defer & keep original hotel",
  alternate: "Move to an alternative stay",
  cancel: "Cancel & refund",
};

const OPTION_DESCRIPTIONS: Record<string, string> = {
  defer: "Shift reservation dates while keeping the original hotel.",
  alternate: "Relocate the guest to a suitable partner hotel.",
  cancel: "Cancel the booking and review the refund details.",
};

const FIELD_LABELS: Record<string, string> = {
  hotel: "Hotel",
  room_type: "Room type",
  fee_diff: "Price difference",
  currency: "Currency",
  refund_amount: "Refund amount",
  cancellation_fee: "Cancellation fee",
  eta_business_days: "Refund ETA (business days)",
  distance_km: "Distance (km)",
  new_check_in_offset_days: "Check-in offset (days)",
  new_check_out_offset_days: "Check-out offset (days)",
  room_amenities: "Amenities",
  room_description: "Room",
  reason: "Reason",
};

const HIDDEN_KEYS = new Set(["hotel_id", "room_image_urls"]);
const OFFSET_KEYS = new Set(["new_check_in_offset_days", "new_check_out_offset_days"]);

function parsePayload(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function stringifyField(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

function addDaysToDate(dateValue: string | null, days: number): string | null {
  if (!dateValue || !Number.isFinite(days)) return null;
  const parts = dateValue.split("-").map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null;
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toLocaleDateString("en-NZ", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

function ReasonPrompt({
  title,
  onCancel,
  onConfirm,
}: {
  title: string;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <View style={styles.prompt}>
      <Text style={styles.promptTitle}>{title}</Text>
      <TextInput
        style={styles.promptInput}
        placeholder="Reason (required)"
        value={reason}
        onChangeText={setReason}
        multiline
      />
      <View style={styles.actionRow}>
        <Pressable style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]} onPress={onCancel}>
          <Text style={styles.secondaryButtonText}>Cancel</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.primaryButton, !reason.trim() && styles.disabled, pressed && !!reason.trim() && styles.pressed]}
          disabled={!reason.trim()}
          onPress={() => onConfirm(reason.trim())}
        >
          <Text style={styles.primaryButtonText}>Confirm</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function OptionCard({
  option,
  caseId,
  readOnly,
  bookingCheckIn,
  onChanged,
}: {
  option: AdminOption;
  caseId: string;
  readOnly: boolean;
  bookingCheckIn: string | null;
  onChanged: () => void;
}) {
  const payload = parsePayload(option.payloadJson);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [showUnavailable, setShowUnavailable] = useState(false);
  const [showUnlock, setShowUnlock] = useState(false);

  useEffect(() => {
    setFields(Object.fromEntries(Object.entries(payload).map(([k, v]) => [k, stringifyField(v)])));
  }, [option.payloadJson]);

  const title = option.optionType === "custom" ? (option.customTitle ?? "Custom option") : (OPTION_TITLES[option.optionType] ?? option.optionType);
  const description = OPTION_DESCRIPTIONS[option.optionType] ?? "Coordinator-created option for this case.";
  const submitted = Boolean(option.executionRequestedAt);
  const showConcreteDates = readOnly && option.optionType === "defer" && bookingCheckIn != null;
  const checkInOffset = Number(fields.new_check_in_offset_days);
  const checkOutOffset = Number(fields.new_check_out_offset_days);
  const statusLabel = submitted ? "guest submitted" : option.availability;
  const fieldsDisabled = option.locked || readOnly;
  const visibleKeys = Object.keys(fields).filter((key) => !HIDDEN_KEYS.has(key) && !(showConcreteDates && OFFSET_KEYS.has(key)));

  async function save() {
    setSaving(true);
    const next: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(fields)) {
      const original = payload[key];
      if (Array.isArray(original)) {
        next[key] = raw.split(",").map((part) => part.trim()).filter(Boolean);
      } else if (raw !== "" && !Number.isNaN(Number(raw))) {
        next[key] = Number(raw);
      } else {
        next[key] = raw;
      }
    }
    await api.updateOptionPayload(caseId, option.id, next);
    setSaving(false);
    onChanged();
  }

  return (
    <View style={[styles.card, option.availability === "unavailable" && styles.cardUnavailable]}>
      <View style={styles.header}>
        <View style={styles.titleWrap}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.description}>{description}</Text>
        </View>
        <View style={styles.tags}>
          <Text style={[styles.tag, option.availability === "unavailable" ? styles.tagWarn : styles.tagNeutral]}>{statusLabel}</Text>
          {option.selected && !submitted && <Text style={styles.tag}>selected</Text>}
          {option.locked && <Text style={[styles.tag, styles.tagWarn]}>locked</Text>}
        </View>
      </View>

      {option.perkNames.length > 0 && <Text style={styles.perks}>Perks: {option.perkNames.join(", ")}</Text>}

      {option.optionType === "cancel" && !readOnly && (
        <View style={styles.visibility}>
          <Text style={styles.fieldLabel}>Show to guest</Text>
          <View style={styles.visibilityRow}>
            {([
              { mode: "auto" as const, value: null, label: "Auto" },
              { mode: "show" as const, value: true, label: "Show" },
              { mode: "hide" as const, value: false, label: "Hide" },
            ]).map((item) => {
              const active = option.coordinatorVisibilityOverride === item.value;
              return (
                <Pressable
                  key={item.mode}
                  style={({ pressed }) => [styles.visibilityBtn, active && styles.visibilityBtnActive, pressed && styles.pressed]}
                  onPress={() => void api.setOptionVisibility(caseId, option.id, item.value).then(onChanged)}
                >
                  <Text style={[styles.visibilityBtnText, active && styles.visibilityBtnTextActive]}>{item.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}

      {option.availability === "unavailable" && option.unavailableReason ? (
        <Text style={styles.unavailable}>Unavailable: {option.unavailableReason}</Text>
      ) : (
        <View style={styles.fields}>
          {visibleKeys.map((key) => (
            <View key={key} style={styles.field}>
              <Text style={styles.fieldLabel}>{FIELD_LABELS[key] ?? key.replace(/_/g, " ")}</Text>
              {fieldsDisabled ? (
                <Text style={styles.fieldValue}>{fields[key] || "—"}</Text>
              ) : (
                <TextInput
                  style={styles.fieldInput}
                  value={fields[key] ?? ""}
                  onChangeText={(value) => setFields((prev) => ({ ...prev, [key]: value }))}
                />
              )}
            </View>
          ))}
          {showConcreteDates && (
            <>
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>New check-in date</Text>
                <Text style={styles.fieldValue}>{addDaysToDate(bookingCheckIn, checkInOffset) ?? "Date unavailable"}</Text>
              </View>
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>New check-out date</Text>
                <Text style={styles.fieldValue}>{addDaysToDate(bookingCheckIn, checkOutOffset) ?? "Date unavailable"}</Text>
              </View>
            </>
          )}
        </View>
      )}

      <View style={styles.actionRow}>
        {readOnly ? (
          <Text style={styles.readOnlyNote}>{option.executionRequestedAt ? "Guest submitted — read-only" : "Case closed — read-only"}</Text>
        ) : (
          <>
            {option.availability !== "unavailable" && (
              <Pressable style={({ pressed }) => [styles.secondaryButton, (option.locked || saving) && styles.disabled, pressed && !option.locked && !saving && styles.pressed]} disabled={option.locked || saving} onPress={() => void save()}>
                <Text style={styles.secondaryButtonText}>{saving ? "Saving…" : "Save fields"}</Text>
              </Pressable>
            )}
            {option.locked ? (
              <Pressable style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]} onPress={() => setShowUnlock(true)}>
                <Text style={styles.secondaryButtonText}>Unlock</Text>
              </Pressable>
            ) : (
              <Pressable style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]} onPress={() => void api.lockOption(caseId, option.id).then(onChanged)}>
                <Text style={styles.secondaryButtonText}>Lock</Text>
              </Pressable>
            )}
            {option.availability !== "unavailable" && (
              <Pressable style={({ pressed }) => [styles.dangerButton, pressed && styles.pressed]} onPress={() => setShowUnavailable(true)}>
                <Text style={styles.dangerButtonText}>Mark unavailable</Text>
              </Pressable>
            )}
          </>
        )}
      </View>

      {showUnavailable && (
        <ReasonPrompt
          title="Mark unavailable"
          onCancel={() => setShowUnavailable(false)}
          onConfirm={(reason) => {
            void api.markOptionUnavailable(caseId, option.id, reason).then(() => {
              setShowUnavailable(false);
              onChanged();
            });
          }}
        />
      )}
      {showUnlock && (
        <ReasonPrompt
          title="Unlock option"
          onCancel={() => setShowUnlock(false)}
          onConfirm={(reason) => {
            void api.unlockOption(caseId, option.id, reason).then(() => {
              setShowUnlock(false);
              onChanged();
            });
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: "#fff", borderRadius: 12, padding: 14, gap: 10, borderWidth: 1, borderColor: "#eef0f4" },
  cardUnavailable: { opacity: 0.85 },
  header: { gap: 8 },
  titleWrap: { gap: 4 },
  title: { fontSize: 14, fontWeight: "700", color: "#0f172a" },
  description: { fontSize: 11, color: "#64748b", lineHeight: 16 },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tag: { fontSize: 10, fontWeight: "700", textTransform: "uppercase", backgroundColor: "#e2e8f0", color: "#334155", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  tagNeutral: { backgroundColor: "#ede9fe", color: "#6d28d9" },
  tagWarn: { backgroundColor: "#ffedd5", color: "#c2410c" },
  perks: { fontSize: 12, color: "#475569" },
  unavailable: { fontSize: 12, color: "#b45309" },
  visibility: { gap: 6 },
  visibilityRow: { flexDirection: "row", gap: 8 },
  visibilityBtn: { borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: "#fff" },
  visibilityBtnActive: { backgroundColor: "#7628e8", borderColor: "#7628e8" },
  visibilityBtnText: { fontSize: 11, fontWeight: "700", color: "#475569" },
  visibilityBtnTextActive: { color: "#fff" },
  fields: { gap: 8 },
  field: { borderTopWidth: 1, borderTopColor: "#eef0f4", paddingTop: 8, gap: 4 },
  fieldLabel: { fontSize: 10, fontWeight: "700", color: "#969daf", textTransform: "uppercase" },
  fieldValue: { fontSize: 13, fontWeight: "700", color: "#252b3e" },
  fieldInput: { borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, color: "#0f172a", backgroundColor: "#fff" },
  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  primaryButton: { backgroundColor: "#4f46e5", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  primaryButtonText: { color: "#fff", fontWeight: "700", fontSize: 12 },
  secondaryButton: { backgroundColor: "#e2e8f0", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  secondaryButtonText: { color: "#334155", fontWeight: "700", fontSize: 12 },
  dangerButton: { paddingHorizontal: 8, paddingVertical: 8 },
  dangerButtonText: { color: "#dc2626", fontWeight: "700", fontSize: 12 },
  readOnlyNote: { fontSize: 11, color: "#94a3b8" },
  prompt: { gap: 8, backgroundColor: "#f8fafc", borderRadius: 10, padding: 10 },
  promptTitle: { fontSize: 13, fontWeight: "700", color: "#0f172a" },
  promptInput: { borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 8, padding: 10, minHeight: 56, fontSize: 12, textAlignVertical: "top", backgroundColor: "#fff" },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
});
