import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { theme } from "../../shared/theme";
import { useMinLoadingDuration } from "../../shared/useMinLoadingDuration";
import { usePolicy } from "./usePolicy";

export function PolicySection({ isOnline }: { isOnline: boolean }) {
  const policy = usePolicy();
  const showLoading = useMinLoadingDuration(policy.loading);

  if (showLoading) {
    return (
      <View style={[styles.card, styles.loadingBox]}>
        <ActivityIndicator size="large" color={theme.accent} />
      </View>
    );
  }

  const uploadDisabled = policy.extractStatus === "extracting" || !isOnline;

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Cancellation & refund policy</Text>
      <Text style={styles.cardCaption}>Upload your policy document or type it below. Guests see this content when they view your policy.</Text>

      <Pressable
        style={({ pressed }) => [styles.uploadBox, (policy.extractStatus === "extracting" || !isOnline) && styles.uploadBoxBusy, pressed && !uploadDisabled && styles.buttonPressed]}
        disabled={uploadDisabled}
        onPress={() => void policy.pickAndUploadDocument()}
      >
        {policy.extractStatus === "extracting" ? (
          <>
            <ActivityIndicator size="small" color={theme.accent} />
            <Text style={styles.uploadTitle}>Reading your document…</Text>
            <Text style={styles.uploadHint}>AI is extracting the text from {policy.uploadedFileName ?? "the file"}.</Text>
          </>
        ) : policy.uploadedFileName && policy.extractStatus === "done" ? (
          <>
            <Text style={styles.uploadTitleSuccess}>✓ {policy.uploadedFileName}</Text>
            <Text style={styles.uploadHint}>AI has read your document. Edit the text below or upload a new file to replace it.</Text>
          </>
        ) : (
          <>
            <Text style={styles.uploadTitle}>↑ Tap to upload your policy file</Text>
            <Text style={styles.uploadHint}>
              {isOnline
                ? "Supports PDF, Word (.docx), Markdown and plain text. AI will read the file and fill in the form below."
                : "You're offline — reconnect to upload a document."}
            </Text>
          </>
        )}
      </Pressable>

      {policy.extractStatus === "error" && policy.canRetryUpload && (
        <Pressable
          style={({ pressed }) => [styles.retryButton, pressed && isOnline && styles.buttonPressed]}
          disabled={!isOnline}
          onPress={() => void policy.retryUpload()}
        >
          <Text style={styles.retryButtonText}>{isOnline ? "↻ Retry upload" : "Reconnect to retry upload"}</Text>
        </Pressable>
      )}

      {policy.aiUnavailableNotice && (
        <Text style={styles.aiWarning}>AI unavailable — prefill may be incomplete. Check the fields below before saving.</Text>
      )}

      <Text style={styles.fieldLabel}>Policy content (shown to guests)</Text>
      <TextInput style={[styles.input, styles.textArea]} value={policy.content} onChangeText={policy.setContent} multiline />

      <Text style={styles.cardCaption}>Refund amounts are calculated automatically from this policy text by AI — no extra configuration needed.</Text>

      <Text style={styles.sectionSubtitle}>Detected rules (optional — edit if AI got it wrong)</Text>
      <View style={styles.row}>
        <View style={styles.rowItem}>
          <Text style={styles.fieldLabel}>Free cancellation (hours before check-in)</Text>
          <TextInput style={styles.input} value={policy.freeCancellationHours} onChangeText={policy.setFreeCancellationHours} keyboardType="number-pad" placeholder="e.g. 48" />
        </View>
        <View style={styles.rowItem}>
          <Text style={styles.fieldLabel}>Cancellation fee (%)</Text>
          <TextInput style={styles.input} value={policy.cancellationFeePercent} onChangeText={policy.setCancellationFeePercent} keyboardType="decimal-pad" placeholder="e.g. 10" />
        </View>
      </View>
      <View style={styles.row}>
        <View style={styles.rowItem}>
          <Text style={styles.fieldLabel}>Fixed fee</Text>
          <TextInput style={styles.input} value={policy.cancellationFeeFixed} onChangeText={policy.setCancellationFeeFixed} keyboardType="decimal-pad" placeholder="e.g. 20" />
        </View>
        <View style={styles.rowItem}>
          <Text style={styles.fieldLabel}>Currency</Text>
          <TextInput style={styles.input} value={policy.currency} onChangeText={policy.setCurrency} autoCapitalize="characters" />
        </View>
      </View>

      <Text style={styles.sectionSubtitle}>Effective dates</Text>
      <Text style={styles.cardCaption}>Use 24-hour format: YYYY-MM-DD HH:mm, e.g. 2026-09-15 14:30.</Text>
      <View style={styles.row}>
        <View style={styles.rowItem}>
          <Text style={styles.fieldLabel}>Effective from</Text>
          <TextInput style={styles.input} value={policy.effectiveFrom} onChangeText={policy.setEffectiveFrom} placeholder="YYYY-MM-DD HH:mm" />
        </View>
        <View style={styles.rowItem}>
          <Text style={styles.fieldLabel}>Effective until</Text>
          <TextInput style={styles.input} value={policy.effectiveUntil} onChangeText={policy.setEffectiveUntil} placeholder="YYYY-MM-DD HH:mm" />
        </View>
      </View>

      {policy.error && <Text style={styles.errorText}>{policy.error}</Text>}
      {!isOnline && <Text style={styles.errorText}>You&apos;re offline — reconnect to save</Text>}

      <View style={styles.actionsRow}>
        <Pressable
          style={({ pressed }) => [styles.primaryButton, !isOnline && styles.buttonDisabled, pressed && styles.buttonPressed]}
          disabled={policy.saving || !isOnline}
          onPress={() => void policy.save()}
        >
          <Text style={styles.primaryButtonText}>{policy.saving ? "Saving…" : "Save refund policy"}</Text>
        </Pressable>
        {policy.saved && <Text style={styles.savedText}>Saved successfully</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  loadingBox: { padding: 40, alignItems: "center" },
  card: { backgroundColor: theme.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: theme.borderLight, gap: 10 },
  cardTitle: { fontSize: 17, fontWeight: "800", color: theme.ink },
  cardCaption: { fontSize: 12, color: theme.muted, marginTop: -4 },
  sectionSubtitle: { fontSize: 13, fontWeight: "700", color: theme.ink, marginTop: 6 },
  uploadBox: { borderWidth: 1.5, borderColor: theme.border, borderStyle: "dashed", borderRadius: 10, padding: 16, alignItems: "center", gap: 4 },
  uploadBoxBusy: { opacity: 0.7 },
  uploadTitle: { fontSize: 13, fontWeight: "700", color: theme.ink },
  uploadTitleSuccess: { fontSize: 13, fontWeight: "700", color: theme.success },
  uploadHint: { fontSize: 11, color: theme.muted, textAlign: "center" },
  aiWarning: { fontSize: 12, color: theme.warning, backgroundColor: theme.warningSoft, borderRadius: 8, padding: 10, fontWeight: "600" },
  fieldLabel: { fontSize: 12, fontWeight: "700", color: theme.mutedDark, marginTop: 6 },
  input: { borderWidth: 1, borderColor: theme.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: theme.ink, textAlignVertical: "center" },
  textArea: { minHeight: 120, textAlignVertical: "top" },
  row: { flexDirection: "row", gap: 10 },
  rowItem: { flex: 1 },
  errorText: { fontSize: 12, color: theme.danger, fontWeight: "600" },
  actionsRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 6 },
  primaryButton: { backgroundColor: theme.accent, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 11, alignItems: "center" },
  primaryButtonText: { color: theme.surface, fontSize: 13, fontWeight: "700" },
  savedText: { fontSize: 12, color: theme.success, fontWeight: "600" },
  buttonDisabled: { opacity: 0.5 },
  buttonPressed: { opacity: 0.7 },
  retryButton: { alignSelf: "flex-start", backgroundColor: theme.dangerSoft, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 9 },
  retryButtonText: { fontSize: 12, color: theme.danger, fontWeight: "700" },
});
