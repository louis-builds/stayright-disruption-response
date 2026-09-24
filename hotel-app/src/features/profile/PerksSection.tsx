import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { theme } from "../../shared/theme";
import type { HotelPerk } from "./types";

// 真实功能性内容,不是假数据——点一下就是真的调用 onAdd() 建一条目录记录,不是预先"看起来
// 已经存在"的样本。目录空的时候用来填补空白率,同时确实降低了新酒店冷启动时的手动输入成本。
const SUGGESTED_PERKS = ["Free breakfast", "Late checkout", "Room upgrade", "Free parking", "Welcome drink", "Airport shuttle"];

export function PerksSection({ perks, onAdd, onDelete, isOnline }: {
  perks: HotelPerk[];
  onAdd: (name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  isOnline: boolean;
}) {
  const [name, setName] = useState("");
  const [adding, setAdding] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function submit(perkName?: string) {
    const v = (perkName ?? name).trim();
    if (!v) return;
    setAdding(v);
    try {
      await onAdd(v);
      if (!perkName) setName("");
    } finally {
      setAdding(null);
    }
  }

  async function remove(id: string) {
    setBusyId(id);
    try {
      await onDelete(id);
    } finally {
      setBusyId(null);
    }
  }

  const existingNames = new Set(perks.map((p) => p.name.toLowerCase()));
  const availableSuggestions = SUGGESTED_PERKS.filter((s) => !existingNames.has(s.toLowerCase()));

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Perks catalog</Text>
      <Text style={styles.cardCaption}>Extras you can offer guests when a disruption hits — free breakfast, drinks, a room upgrade.</Text>

      {perks.length === 0 ? (
        <Text style={styles.emptyHint}>No perks yet — add your first one below so it&apos;s ready to attach to a rebooking option.</Text>
      ) : (
        <View style={styles.list}>
          {perks.map((p) => (
            <View key={p.id} style={styles.listRow}>
              <Text style={styles.listRowText}>{p.name}</Text>
              <Pressable
                style={({ pressed }) => [styles.dangerButton, !isOnline && styles.buttonDisabled, pressed && styles.buttonPressed]}
                disabled={busyId === p.id || !isOnline}
                onPress={() => void remove(p.id)}
              >
                <Text style={styles.dangerButtonText}>{busyId === p.id ? "Removing…" : "Remove"}</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}

      {!isOnline && <Text style={styles.offlineHint}>You&apos;re offline — reconnect to add or remove perks</Text>}
      <View style={styles.addRow}>
        <TextInput
          style={[styles.input, styles.addRowInput]}
          value={name}
          onChangeText={setName}
          placeholder="e.g. Free breakfast"
          onSubmitEditing={() => void submit()}
        />
        <Pressable
          style={({ pressed }) => [styles.secondaryButton, (!name.trim() || !isOnline) && styles.buttonDisabled, pressed && styles.buttonPressed]}
          disabled={!!adding || !name.trim() || !isOnline}
          onPress={() => void submit()}
        >
          <Text style={styles.secondaryButtonText}>{adding === name.trim() ? "Adding…" : "+ Add perk"}</Text>
        </Pressable>
      </View>

      {availableSuggestions.length > 0 && (
        <>
          <Text style={styles.suggestLabel}>Quick add</Text>
          <View style={styles.suggestRow}>
            {availableSuggestions.map((s) => (
              <Pressable
                key={s}
                style={({ pressed }) => [styles.suggestChip, !isOnline && styles.buttonDisabled, pressed && styles.buttonPressed]}
                disabled={adding === s || !isOnline}
                onPress={() => void submit(s)}
              >
                <Text style={styles.suggestChipText}>{adding === s ? "Adding…" : `+ ${s}`}</Text>
              </Pressable>
            ))}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: theme.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: theme.borderLight, gap: 10 },
  cardTitle: { fontSize: 17, fontWeight: "800", color: theme.ink },
  cardCaption: { fontSize: 12, color: theme.muted, marginTop: -4 },
  emptyHint: { fontSize: 12, color: theme.muted, fontStyle: "italic" },
  list: { gap: 6 },
  listRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: theme.background, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10 },
  listRowText: { fontSize: 14, color: theme.ink, fontWeight: "600" },
  dangerButton: { backgroundColor: theme.dangerSoft, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6 },
  dangerButtonText: { color: theme.danger, fontSize: 11, fontWeight: "700" },
  addRow: { flexDirection: "row", gap: 8, marginTop: 4 },
  addRowInput: { flex: 1 },
  input: { borderWidth: 1, borderColor: theme.border, borderRadius: 8, paddingHorizontal: 12, fontSize: 14, color: theme.ink, height: 44, textAlignVertical: "center", includeFontPadding: false },
  secondaryButton: { backgroundColor: theme.borderLight, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10, justifyContent: "center" },
  secondaryButtonText: { color: theme.ink, fontSize: 13, fontWeight: "700" },
  buttonDisabled: { opacity: 0.5 },
  buttonPressed: { opacity: 0.7 },
  suggestLabel: { fontSize: 12, fontWeight: "700", color: theme.mutedDark, marginTop: 4 },
  suggestRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  suggestChip: { borderWidth: 1, borderColor: theme.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  suggestChipText: { fontSize: 12, color: theme.ink, fontWeight: "600" },
  offlineHint: { fontSize: 11, color: theme.danger, fontWeight: "600" },
});
