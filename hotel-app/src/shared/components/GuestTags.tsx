import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { CustomTag, GuestTags } from "../api/tags";
import { theme } from "../theme";

const SYSTEM_TAG_LABELS: Array<{ key: keyof GuestTags; label: string }> = [
  { key: "emotionallySensitive", label: "emotionally sensitive" },
  { key: "aiDifficult", label: "AI difficult" },
  { key: "highRejectionRate", label: "high rejection" },
  { key: "slowResponder", label: "slow responder" },
];

export function GuestTagChips({ guestUserId, nickname, tags, onManage }: {
  guestUserId: string | null;
  nickname: string;
  tags: GuestTags | undefined;
  onManage: (target: { guestUserId: string; nickname: string }) => void;
}) {
  if (!guestUserId) return null;
  return (
    <View style={styles.tagRow}>
      {(tags?.customTags ?? []).map((t) => (
        <View key={t.id} style={styles.tagPurple}>
          <Text style={styles.tagPurpleText}>{t.label}</Text>
        </View>
      ))}
      {tags && SYSTEM_TAG_LABELS.filter((s) => Boolean(tags[s.key])).map((s) => (
        <View key={s.key} style={styles.tagGray}>
          <Text style={styles.tagGrayText}>{s.label}</Text>
        </View>
      ))}
      <Pressable style={styles.tagAddButton} onPress={() => onManage({ guestUserId, nickname })}>
        <Text style={styles.tagAddButtonText}>+ Tag</Text>
      </Pressable>
    </View>
  );
}

export function TagManageModal({ visible, target, customTags, guestTags, onToggle, onCreate, onClose }: {
  visible: boolean;
  target: { guestUserId: string; nickname: string } | null;
  customTags: CustomTag[];
  guestTags: GuestTags | undefined;
  onToggle: (tag: CustomTag) => void;
  onCreate: (label: string) => void;
  onClose: () => void;
}) {
  const [newLabel, setNewLabel] = useState("");
  const appliedIds = new Set((guestTags?.customTags ?? []).map((t) => t.id));
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Guest tags — {target?.nickname}</Text>
          <Text style={styles.modalHint}>Visible to your hotel and StayRight coordinators only — the guest can&apos;t see these.</Text>
          {customTags.length === 0 ? (
            <Text style={styles.emptyHint}>No tags yet — create one below.</Text>
          ) : (
            <ScrollView style={styles.tagScroll}>
              {customTags.map((tag) => {
                const checked = appliedIds.has(tag.id);
                return (
                  <Pressable key={tag.id} style={styles.checkRow} onPress={() => onToggle(tag)}>
                    <View style={[styles.checkbox, checked && styles.checkboxChecked]}>{checked && <Text style={styles.checkboxMark}>✓</Text>}</View>
                    <Text style={styles.checkRowText}>{tag.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
          <View style={styles.tagCreateRow}>
            <TextInput style={[styles.input, styles.tagCreateInput]} value={newLabel} onChangeText={setNewLabel} placeholder="New tag (e.g. corporate account)" />
            <Pressable
              style={[styles.primaryButton, !newLabel.trim() && styles.buttonDisabled]}
              disabled={!newLabel.trim()}
              onPress={() => {
                const l = newLabel.trim();
                setNewLabel("");
                onCreate(l);
              }}
            >
              <Text style={styles.primaryButtonText}>Create</Text>
            </Pressable>
          </View>
          <View style={styles.modalActions}>
            <Pressable style={styles.secondaryButton} onPress={onClose}>
              <Text style={styles.secondaryButtonText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" },
  tagPurple: { backgroundColor: theme.accentSoft, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  tagPurpleText: { fontSize: 10, color: theme.accent, fontWeight: "700" },
  tagGray: { backgroundColor: theme.borderLight, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  tagGrayText: { fontSize: 10, color: theme.mutedDark, fontWeight: "600" },
  tagAddButton: { paddingHorizontal: 8, paddingVertical: 3 },
  tagAddButtonText: { fontSize: 10, color: theme.accent, fontWeight: "700" },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(32,36,56,0.5)", alignItems: "center", justifyContent: "center", padding: 20 },
  modalCard: { backgroundColor: theme.surface, borderRadius: 16, padding: 20, width: "100%", maxWidth: 420, gap: 10 },
  modalTitle: { fontSize: 16, fontWeight: "800", color: theme.ink },
  modalHint: { fontSize: 12, color: theme.muted },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 4 },
  emptyHint: { fontSize: 12, color: theme.muted, fontStyle: "italic" },
  tagScroll: { maxHeight: 180 },
  checkRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 },
  checkRowText: { fontSize: 13, color: theme.ink },
  checkbox: { width: 18, height: 18, borderRadius: 4, borderWidth: 1.5, borderColor: theme.border, alignItems: "center", justifyContent: "center" },
  checkboxChecked: { backgroundColor: theme.accent, borderColor: theme.accent },
  checkboxMark: { color: "#fff", fontSize: 12, fontWeight: "700" },
  tagCreateRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  tagCreateInput: { flex: 1 },
  input: { borderWidth: 1, borderColor: theme.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: theme.ink, textAlignVertical: "center" },
  primaryButton: { backgroundColor: theme.accent, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9, alignItems: "center", justifyContent: "center" },
  primaryButtonText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  secondaryButton: { backgroundColor: theme.borderLight, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9, alignItems: "center", justifyContent: "center" },
  secondaryButtonText: { color: theme.ink, fontSize: 12, fontWeight: "700" },
  buttonDisabled: { opacity: 0.5 },
});
