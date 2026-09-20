import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useAuth } from "./AuthContext";
import { PasswordEyeButton } from "../../shared/PasswordEyeButton";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9]{7,15}$/;

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

/** 跟 ProfileScreen 里那份密码强度启发式逻辑一致(长度+字符类别数),两边各自独立一个
   纯函数比为了几行逻辑抽公共 util 更划算——Web 端 RegisterPage/ProfilePage 也是这么做的。 */
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

// guest 角色注册不需要地址/地图字段(RegisterRequest.Hotel 只在 role=hotel 时必填),
// 这个 App 从一开始就没有这个字段,不是漏做。
// 通用功能优化需求.txt 第4条:头像上传(Web端有)本轮不加——需要新引入
// expo-image-picker 原生依赖,属于新功能而非本轮"优化打磨"范围,留给专门的功能迭代。
export function RegisterScreen({ onGoToLogin }: { onGoToLogin: () => void }) {
  const { register } = useAuth();
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [nickname, setNickname] = useState("");
  const [gender, setGender] = useState("unspecified");
  const [language, setLanguage] = useState("en");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const entrance = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(entrance, { toValue: 1, duration: 450, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [entrance]);

  const errorFade = useRef(new Animated.Value(0)).current;
  const errorShake = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(errorFade, { toValue: error ? 1 : 0, duration: 200, useNativeDriver: true }).start();
    if (error) {
      errorShake.setValue(0);
      Animated.sequence([
        Animated.timing(errorShake, { toValue: 1, duration: 60, useNativeDriver: true }),
        Animated.timing(errorShake, { toValue: -1, duration: 60, useNativeDriver: true }),
        Animated.timing(errorShake, { toValue: 1, duration: 60, useNativeDriver: true }),
        Animated.timing(errorShake, { toValue: 0, duration: 60, useNativeDriver: true }),
      ]).start();
    }
  }, [error, errorFade, errorShake]);

  const emailError = email && !EMAIL_RE.test(email) ? "Invalid email format" : null;
  const phoneError = phone && !PHONE_RE.test(phone) ? "Invalid phone format" : null;
  const passwordMismatch = confirmPassword.length > 0 && password !== confirmPassword;
  const strength = passwordStrength(password);

  async function submit() {
    if (submitting) return;
    if (!email.trim() || !phone.trim() || !nickname.trim() || !password || !confirmPassword) {
      setError("Please fill in all fields");
      return;
    }
    if (emailError || phoneError) {
      setError("Please fix the errors in the form");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    setSubmitting(true);
    setError(null);
    const result = await register({
      email: email.trim(),
      phone: phone.trim(),
      nickname: nickname.trim(),
      gender,
      language,
      password,
      confirmPassword,
      role: "guest",
    });
    if (!result.ok) setError(result.message);
    setSubmitting(false);
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Animated.View
        style={{ opacity: entrance, transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] }}
      >
        <Text style={styles.title}>Create your account</Text>
        <Text style={styles.subtitle}>Get matched to disruptions automatically and pick a fix in one tap.</Text>

        <Text style={styles.label}>Nickname</Text>
        <TextInput style={styles.input} placeholder="How should we call you?" value={nickname} onChangeText={setNickname} />

        <Text style={styles.label}>Gender</Text>
        <OptionPills value={gender} options={GENDER_OPTIONS} onChange={setGender} />

        <Text style={styles.label}>Language</Text>
        <OptionPills value={language} options={LANGUAGE_OPTIONS} onChange={setLanguage} />

        <Text style={styles.label}>Email</Text>
        <TextInput style={styles.input} placeholder="you@example.com" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} />
        {emailError && <Text style={styles.fieldError}>{emailError}</Text>}

        <Text style={styles.label}>Phone</Text>
        <TextInput style={styles.input} placeholder="+64211234567" keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
        {phoneError && <Text style={styles.fieldError}>{phoneError}</Text>}

        <Text style={styles.label}>Password</Text>
        <View style={styles.passwordWrap}>
          <TextInput
            style={[styles.input, styles.passwordInput]}
            placeholder="Min 8 characters"
            secureTextEntry={!showPassword}
            value={password}
            onChangeText={setPassword}
          />
          <PasswordEyeButton visible={showPassword} onPress={() => setShowPassword((v) => !v)} />
        </View>
        {!!password && (
          <View style={styles.strengthRow}>
            <View style={styles.strengthTrack}>
              <View style={[styles.strengthFill, { width: `${strength.pct}%`, backgroundColor: strength.color }]} />
            </View>
            <Text style={[styles.strengthLabel, { color: strength.color }]}>{strength.label}</Text>
          </View>
        )}

        <Text style={styles.label}>Confirm password</Text>
        <View style={styles.passwordWrap}>
          <TextInput style={[styles.input, styles.passwordInput]} placeholder="Re-enter password" secureTextEntry={!showPassword} value={confirmPassword} onChangeText={setConfirmPassword} />
          <PasswordEyeButton visible={showPassword} onPress={() => setShowPassword((v) => !v)} />
        </View>
        {passwordMismatch && <Text style={styles.fieldError}>Passwords do not match</Text>}

        {error && (
          <Animated.Text
            style={[
              styles.error,
              { opacity: errorFade, transform: [{ translateX: errorShake.interpolate({ inputRange: [-1, 1], outputRange: [-6, 6] }) }] },
            ]}
          >
            {error}
          </Animated.Text>
        )}

        <Pressable
          style={({ pressed }) => [styles.submitButton, submitting && styles.submitButtonDisabled, pressed && !submitting && styles.submitButtonPressed]}
          onPress={submit}
          disabled={submitting}
        >
          {submitting ? <SpinningDot /> : <Text style={styles.submitButtonText}>Create Account</Text>}
        </Pressable>

        <Pressable onPress={onGoToLogin} style={({ pressed }) => pressed && styles.pressedDim}>
          <Text style={styles.link}>Already have an account? Sign in</Text>
        </Pressable>
      </Animated.View>
    </ScrollView>
  );
}

function SpinningDot() {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 800, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [spin]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  return <Animated.View style={[styles.spinner, { transform: [{ rotate }] }]} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f8fafc" },
  content: { padding: 24, paddingTop: 56, paddingBottom: 40, gap: 6 },
  title: { fontSize: 24, fontWeight: "700", color: "#0f172a" },
  subtitle: { fontSize: 13, color: "#64748b", marginBottom: 16 },
  label: { fontSize: 13, fontWeight: "600", color: "#334155", marginTop: 12, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, backgroundColor: "#fff" },
  fieldError: { color: "#dc2626", fontSize: 12, marginTop: 4 },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pill: { borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: "#fff" },
  pillSelected: { backgroundColor: "#7628e8", borderColor: "#7628e8" },
  pillPressed: { backgroundColor: "#f1ebff", borderColor: "#c9b5f2" },
  pillText: { fontSize: 13, color: "#334155", fontWeight: "600" },
  pillTextSelected: { color: "#fff" },
  passwordWrap: { position: "relative" },
  passwordInput: { paddingRight: 40 },
  strengthRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  strengthTrack: { flex: 1, height: 5, borderRadius: 3, backgroundColor: "#e2e8f0" },
  strengthFill: { height: 5, borderRadius: 3 },
  strengthLabel: { fontSize: 11, fontWeight: "700" },
  pressedDim: { opacity: 0.5 },
  error: { color: "#dc2626", fontSize: 13, marginTop: 12 },
  submitButton: { backgroundColor: "#7628e8", borderRadius: 10, paddingVertical: 14, alignItems: "center", marginTop: 20 },
  submitButtonPressed: { backgroundColor: "#6220ca" },
  submitButtonDisabled: { opacity: 0.6 },
  submitButtonText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  spinner: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: "rgba(255,255,255,0.35)", borderTopColor: "#fff" },
  link: { color: "#7628e8", textAlign: "center", marginTop: 16, fontSize: 13, fontWeight: "600" },
});
