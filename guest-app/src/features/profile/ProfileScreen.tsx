import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, Easing, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as authApi from "../auth/api";
import { useAuth } from "../auth";
import * as api from "./api";

// 通用功能优化需求.txt 第1、3条:个人资料页不是列表/持续通知场景,分页搜索和通知机制
// 都不适用。第4条:头像上传(参考RegisterScreen同样的决定)、联系支持(已经在SettingsScreen
// 加过)都不在这页重复加。第2条:资料完整度进度条已经是这页唯一有意义的可视化维度,
// 邮箱/密码/账号信息都是单值展示,没有更多可图形化的东西。
function FadeMessage({ text, style }: { text: string | null; style?: object }) {
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    fade.setValue(0);
    if (text) Animated.timing(fade, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [text, fade]);
  if (!text) return null;
  return <Animated.Text style={[style, { opacity: fade }]}>{text}</Animated.Text>;
}

const GENDER_OPTIONS = [
  { value: "unspecified", label: "Prefer not to say" },
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
];
const LANGUAGE_OPTIONS = [
  { value: "en", label: "English" },
  { value: "zh", label: "中文" },
  { value: "mi", label: "Māori" },
];
const PHONE_RE = /^\+?[0-9]{7,15}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function OptionPills({ value, options, onChange }: { value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <View style={styles.pillRow}>
      {options.map((opt) => {
        const selected = value === opt.value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            style={({ pressed }) => [styles.pill, selected && styles.pillSelected, pressed && !selected && styles.pillPressed]}
          >
            <Text style={[styles.pillText, selected && styles.pillTextSelected]}>{opt.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function passwordStrength(pw: string): { pct: number; label: string; color: string } {
  if (!pw) return { pct: 0, label: "", color: "#cbd5e1" };
  let classes = 0;
  if (/[a-z]/.test(pw)) classes++;
  if (/[A-Z]/.test(pw)) classes++;
  if (/[0-9]/.test(pw)) classes++;
  if (/[^a-zA-Z0-9]/.test(pw)) classes++;
  const lengthScore = Math.min(pw.length / 12, 1);
  const score = lengthScore * 0.6 + (classes / 4) * 0.4;
  if (score < 0.4) return { pct: Math.max(score * 100, 8), label: "Weak", color: "#dc2626" };
  if (score < 0.7) return { pct: score * 100, label: "Fair", color: "#f59e0b" };
  return { pct: 100, label: "Strong", color: "#059669" };
}

function formatJoinDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-NZ", { year: "numeric", month: "long", day: "numeric" });
}

export function ProfileScreen() {
  const { user, updateUser } = useAuth();
  if (!user) return null;

  const [nickname, setNickname] = useState(user.nickname);
  const [gender, setGender] = useState(user.gender);
  const [language, setLanguage] = useState(user.language);
  const [phone, setPhone] = useState(user.phone);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const phoneError = phone && !PHONE_RE.test(phone) ? "Invalid phone format" : null;

  const completeness = useMemo(() => {
    const fields = [user.avatarUrl, nickname, gender !== "unspecified", language, phone && !phoneError];
    const filled = fields.filter(Boolean).length;
    return Math.round((filled / fields.length) * 100);
  }, [user.avatarUrl, nickname, gender, language, phone, phoneError]);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const strength = passwordStrength(newPassword);

  const [newEmail, setNewEmail] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [emailStage, setEmailStage] = useState<"idle" | "code-sent">("idle");
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailMessage, setEmailMessage] = useState<string | null>(null);
  const newEmailError = newEmail && !EMAIL_RE.test(newEmail) ? "Invalid email format" : null;

  const entrance = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(entrance, { toValue: 1, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [entrance]);

  async function handleSaveProfile() {
    if (phoneError) return;
    setProfileSaving(true);
    setProfileMessage(null);
    try {
      const res = await api.updateProfile({ nickname, gender, language, phone });
      if (res.code !== 0) throw new Error(res.message);
      updateUser(res.data);
      setProfileMessage("Profile saved");
    } catch (err) {
      setProfileMessage(err instanceof Error ? err.message : "Save failed");
    } finally {
      setProfileSaving(false);
    }
  }

  async function handleChangePassword() {
    setPasswordSaving(true);
    setPasswordMessage(null);
    try {
      const res = await authApi.changePassword(currentPassword, newPassword);
      if (res.code !== 0) throw new Error(res.message);
      setPasswordMessage("Password changed");
      setCurrentPassword("");
      setNewPassword("");
    } catch (err) {
      setPasswordMessage(err instanceof Error ? err.message : "Change failed");
    } finally {
      setPasswordSaving(false);
    }
  }

  async function handleSendCode() {
    setEmailSaving(true);
    setEmailMessage(null);
    try {
      const res = await api.requestEmailChange(newEmail);
      if (res.code !== 0) throw new Error(res.message);
      setEmailStage("code-sent");
      setEmailMessage(`Verification code generated (demo environment): ${res.data.devCode}`);
    } catch (err) {
      setEmailMessage(err instanceof Error ? err.message : "Send failed");
    } finally {
      setEmailSaving(false);
    }
  }

  async function handleConfirmEmail() {
    setEmailSaving(true);
    setEmailMessage(null);
    try {
      const res = await api.confirmEmailChange(newEmail, emailCode);
      if (res.code !== 0) throw new Error(res.message);
      updateUser(res.data);
      setEmailStage("idle");
      setNewEmail("");
      setEmailCode("");
      setEmailMessage("Email updated");
    } catch (err) {
      setEmailMessage(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setEmailSaving(false);
    }
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Animated.View style={{ opacity: entrance, transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }], gap: 14 }}>
      <Text style={styles.overline}>ACCOUNT</Text>
      <Text style={styles.title}>Profile</Text>
      <Text style={styles.subtitle}>Manage your personal details, email credentials, and security preferences.</Text>

      <View style={styles.card}>
        <View style={styles.cardHeaderRow}>
          <Text style={styles.cardTitle}>Basic info</Text>
          <View style={styles.completenessWrap}>
            <View style={styles.completenessTrack}>
              <View style={[styles.completenessFill, { width: `${completeness}%` }]} />
            </View>
            <Text style={styles.completenessLabel}>{completeness}% complete</Text>
          </View>
        </View>

        <Text style={styles.label}>Nickname</Text>
        <TextInput style={styles.input} value={nickname} onChangeText={setNickname} />

        <Text style={styles.label}>Gender</Text>
        <OptionPills value={gender} options={GENDER_OPTIONS} onChange={setGender} />

        <Text style={styles.label}>Language</Text>
        <OptionPills value={language} options={LANGUAGE_OPTIONS} onChange={setLanguage} />

        <Text style={styles.label}>Phone</Text>
        <TextInput style={styles.input} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
        {phoneError && <Text style={styles.fieldError}>{phoneError}</Text>}

        <Text style={styles.label}>Account type</Text>
        <View style={styles.readonlyField}>
          <Text style={styles.readonlyFieldText}>Traveller</Text>
        </View>

        <FadeMessage text={profileMessage} style={styles.message} />
        <Pressable
          style={({ pressed }) => [styles.submitButton, profileSaving && styles.submitButtonDisabled, pressed && !profileSaving && styles.submitButtonPressed]}
          onPress={() => void handleSaveProfile()}
          disabled={profileSaving}
        >
          {profileSaving ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitButtonText}>Save Profile Changes</Text>}
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Email</Text>
        <View style={styles.currentValueRow}>
          <Text style={styles.currentValueLabel}>Current email</Text>
          <Text style={styles.currentValueText}>{user.email}</Text>
        </View>
        {emailStage === "idle" ? (
          <>
            <Text style={styles.label}>New email</Text>
            <TextInput style={styles.input} value={newEmail} onChangeText={setNewEmail} placeholder="new@example.com" autoCapitalize="none" />
            {newEmailError && <Text style={styles.fieldError}>{newEmailError}</Text>}
            <Pressable
              style={({ pressed }) => [
                styles.secondaryButton,
                (!newEmail || !!newEmailError || emailSaving) && styles.submitButtonDisabled,
                pressed && !!newEmail && !newEmailError && !emailSaving && styles.secondaryButtonPressed,
              ]}
              disabled={!newEmail || !!newEmailError || emailSaving}
              onPress={() => void handleSendCode()}
            >
              <Text style={styles.secondaryButtonText}>{emailSaving ? "Sending…" : "Send verification code"}</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={styles.label}>Verification code</Text>
            <TextInput style={styles.input} value={emailCode} onChangeText={setEmailCode} />
            <Pressable
              style={({ pressed }) => [styles.submitButton, emailSaving && styles.submitButtonDisabled, pressed && !emailSaving && styles.submitButtonPressed]}
              disabled={emailSaving}
              onPress={() => void handleConfirmEmail()}
            >
              <Text style={styles.submitButtonText}>{emailSaving ? "Verifying…" : "Confirm change"}</Text>
            </Pressable>
          </>
        )}
        <FadeMessage text={emailMessage} style={styles.message} />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Change password</Text>
        <Text style={styles.label}>Current password</Text>
        <TextInput style={styles.input} value={currentPassword} onChangeText={setCurrentPassword} secureTextEntry />
        <Text style={styles.label}>New password</Text>
        <TextInput style={styles.input} value={newPassword} onChangeText={setNewPassword} secureTextEntry />
        {!!newPassword && (
          <View style={styles.strengthRow}>
            <View style={styles.strengthTrack}>
              <View style={[styles.strengthFill, { width: `${strength.pct}%`, backgroundColor: strength.color }]} />
            </View>
            <Text style={[styles.strengthLabel, { color: strength.color }]}>{strength.label}</Text>
          </View>
        )}
        <FadeMessage text={passwordMessage} style={styles.message} />
        <Pressable
          style={({ pressed }) => [styles.submitButton, passwordSaving && styles.submitButtonDisabled, pressed && !passwordSaving && styles.submitButtonPressed]}
          disabled={passwordSaving}
          onPress={() => void handleChangePassword()}
        >
          {passwordSaving ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitButtonText}>Update Password</Text>}
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Account</Text>
        <View style={styles.currentValueRow}>
          <Text style={styles.currentValueLabel}>Member since</Text>
          <Text style={styles.currentValueText}>{formatJoinDate(user.createdAt)}</Text>
        </View>
        <View style={styles.currentValueRow}>
          <Text style={styles.currentValueLabel}>Account type</Text>
          <Text style={styles.currentValueText}>Traveller</Text>
        </View>
        <Text style={styles.blurb}>You get matched to disruptions automatically and can pick a rebooking, hotel move, or refund in one tap.</Text>
      </View>
      </Animated.View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f8fafc" },
  content: { padding: 16, paddingBottom: 40, gap: 14 },
  overline: { fontSize: 11, fontWeight: "700", color: "#7628e8", letterSpacing: 1.5 },
  title: { fontSize: 22, fontWeight: "700", color: "#0f172a" },
  subtitle: { fontSize: 13, color: "#64748b" },
  card: { backgroundColor: "#fff", borderRadius: 14, padding: 16, gap: 8 },
  cardHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 8 },
  cardTitle: { fontSize: 15, fontWeight: "700", color: "#0f172a" },
  completenessWrap: { alignItems: "flex-end", gap: 4, minWidth: 90 },
  completenessTrack: { width: 90, height: 5, borderRadius: 3, backgroundColor: "#e2e8f0" },
  completenessFill: { height: 5, borderRadius: 3, backgroundColor: "#7628e8" },
  completenessLabel: { fontSize: 10, color: "#64748b" },
  label: { fontSize: 12, fontWeight: "600", color: "#334155", marginTop: 6 },
  input: { borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, backgroundColor: "#fff" },
  fieldError: { color: "#dc2626", fontSize: 11 },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pill: { borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: "#fff" },
  pillSelected: { backgroundColor: "#7628e8", borderColor: "#7628e8" },
  pillPressed: { backgroundColor: "#f1ebff", borderColor: "#c9b5f2" },
  pillText: { fontSize: 12, color: "#334155", fontWeight: "600" },
  pillTextSelected: { color: "#fff" },
  readonlyField: { borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: "#f1f5f9" },
  readonlyFieldText: { fontSize: 14, color: "#64748b" },
  message: { fontSize: 12, color: "#7628e8", fontWeight: "600" },
  submitButton: { marginTop: 8, backgroundColor: "#7628e8", borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  submitButtonPressed: { backgroundColor: "#6220ca" },
  submitButtonDisabled: { opacity: 0.6 },
  submitButtonText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  secondaryButton: { marginTop: 8, borderWidth: 1, borderColor: "#7628e8", borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  secondaryButtonPressed: { backgroundColor: "#f1ebff" },
  secondaryButtonText: { color: "#7628e8", fontWeight: "700", fontSize: 13 },
  currentValueRow: { flexDirection: "row", justifyContent: "space-between" },
  currentValueLabel: { fontSize: 12, color: "#64748b" },
  currentValueText: { fontSize: 12, color: "#0f172a", fontWeight: "700" },
  strengthRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  strengthTrack: { flex: 1, height: 5, borderRadius: 3, backgroundColor: "#e2e8f0" },
  strengthFill: { height: 5, borderRadius: 3 },
  strengthLabel: { fontSize: 11, fontWeight: "700" },
  blurb: { fontSize: 12, color: "#64748b", marginTop: 4 },
});
