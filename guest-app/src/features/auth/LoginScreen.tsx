import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { forgotPassword } from "./api";
import { useAuth } from "./AuthContext";
import { PasswordEyeButton } from "../../shared/PasswordEyeButton";

// 通用功能优化需求.txt 第1-3条(分页/搜索/图表/通知机制)对登录页不适用——这里只有一个
// 提交动作,没有列表/统计/持续通知可言。第4条(额外实用功能)对应下面新增的忘记密码入口:
// 之前完全没做,但 Web 端 LoginPage 早就有对应的真实接口(POST /api/auth/forgot-password),
// 客户端App漏了这一个真实能用的功能,不是装饰性补充。

export function LoginScreen({ onGoToRegister }: { onGoToRegister: () => void }) {
  const { login, rememberedIdentifier } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSubmitting, setForgotSubmitting] = useState(false);
  const [forgotStatus, setForgotStatus] = useState<string | null>(null);
  const forgotAnim = useRef(new Animated.Value(0)).current;

  const entrance = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0)).current;
  const errorFade = useRef(new Animated.Value(0)).current;
  const errorShake = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(entrance, { toValue: 1, duration: 500, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [entrance]);

  // 通用页面优化需求.txt 第6条:品牌徽标背后一圈缓慢明暗的光晕,让深色登录背景不那么死板。
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 2200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0, duration: 2200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [glow]);

  useEffect(() => {
    if (rememberedIdentifier) {
      setIdentifier(rememberedIdentifier);
      setRememberMe(true);
    }
  }, [rememberedIdentifier]);

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

  async function submit() {
    if (!identifier.trim() || !password || submitting) return;
    setSubmitting(true);
    setError(null);
    const result = await login(identifier.trim(), password, rememberMe);
    if (!result.ok) setError(result.message);
    setSubmitting(false);
  }

  function toggleForgot() {
    const next = !showForgot;
    setShowForgot(next);
    setForgotStatus(null);
    Animated.timing(forgotAnim, { toValue: next ? 1 : 0, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }

  async function submitForgot() {
    if (!forgotEmail.trim() || forgotSubmitting) return;
    setForgotSubmitting(true);
    setForgotStatus(null);
    try {
      await forgotPassword(forgotEmail.trim());
      setForgotStatus("Reset link generated — check the server log (demo environment, no real email sent).");
    } catch {
      setForgotStatus("Failed to generate reset link, please try again later.");
    } finally {
      setForgotSubmitting(false);
    }
  }

  return (
    <LinearGradient colors={["#151126", "#422879", "#151126"]} style={styles.screen}>
      <View pointerEvents="none" style={styles.backdrop}>
        <Text style={styles.watermarkIcon}>🧳</Text>
        <Text style={styles.watermark}>GUEST</Text>
      </View>
      <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.flexCenter} keyboardShouldPersistTaps="handled">
        <Animated.View
          style={[
            styles.brandBlock,
            { opacity: entrance, transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] },
          ]}
        >
          <View style={styles.brandGlowWrap}>
            <Animated.View
              style={[
                styles.brandGlow,
                { opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0.15, 0.4] }), transform: [{ scale: glow.interpolate({ inputRange: [0, 1], outputRange: [1, 1.15] }) }] },
              ]}
            />
            <View style={styles.brandBadge}>
              <Text style={styles.brandBadgeIcon}>🧳</Text>
            </View>
          </View>
          <Text style={styles.brandLabel}>StayRight NZ</Text>
          <Text style={styles.brandTagline}>Travelers · stay updates</Text>
        </Animated.View>

        <Animated.View
          style={[
            styles.card,
            { opacity: entrance, transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }] },
          ]}
        >
          <Text style={styles.title}>Guest App</Text>
          <Text style={styles.subtitle}>Sign in to see your stays and disruption alerts</Text>

          <TextInput
            style={styles.input}
            placeholder="Username / Email"
            autoCapitalize="none"
            autoCorrect={false}
            value={identifier}
            onChangeText={setIdentifier}
          />

          <View style={styles.passwordWrap}>
            <TextInput
              style={[styles.input, styles.passwordInput]}
              placeholder="Password"
              secureTextEntry={!showPassword}
              value={password}
              onChangeText={setPassword}
            />
            <PasswordEyeButton visible={showPassword} onPress={() => setShowPassword((v) => !v)} />
          </View>

          <View style={styles.rememberForgotRow}>
            <Pressable style={styles.rememberRow} onPress={() => setRememberMe((v) => !v)}>
              <Switch value={rememberMe} onValueChange={setRememberMe} trackColor={{ true: "#7628e8" }} />
              <Text style={styles.rememberLabel}>Remember me</Text>
            </Pressable>
            <Pressable onPress={toggleForgot} style={({ pressed }) => pressed && styles.pressedDim}>
              <Text style={styles.forgotToggle}>{showForgot ? "Hide" : "Forgot password?"}</Text>
            </Pressable>
          </View>

          {showForgot && (
            <Animated.View
              style={[
                styles.forgotPanel,
                { opacity: forgotAnim, transform: [{ translateY: forgotAnim.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) }] },
              ]}
            >
              <TextInput
                style={styles.input}
                placeholder="Your account email"
                autoCapitalize="none"
                autoCorrect={false}
                value={forgotEmail}
                onChangeText={setForgotEmail}
              />
              <Pressable
                style={({ pressed }) => [
                  styles.forgotButton,
                  !forgotEmail.trim() && styles.forgotButtonDisabled,
                  pressed && !forgotSubmitting && styles.forgotButtonPressed,
                ]}
                onPress={() => void submitForgot()}
                disabled={forgotSubmitting || !forgotEmail.trim()}
              >
                {forgotSubmitting ? <SpinningDot variant="teal" /> : <Text style={styles.forgotButtonText}>Send reset link</Text>}
              </Pressable>
              {forgotStatus && <Text style={styles.forgotStatus}>{forgotStatus}</Text>}
            </Animated.View>
          )}

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
            {submitting ? <SpinningDot /> : <Text style={styles.submitButtonText}>Sign In</Text>}
          </Pressable>

          <Pressable onPress={onGoToRegister} style={({ pressed }) => pressed && styles.pressedDim}>
            <Text style={styles.link}>New here? Create an account</Text>
          </Pressable>
        </Animated.View>
      </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

function SpinningDot({ variant = "light" }: { variant?: "light" | "teal" }) {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 800, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [spin]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  return <Animated.View style={[styles.spinner, variant === "teal" && styles.spinnerTeal, { transform: [{ rotate }] }]} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  backdrop: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center" },
  watermark: {
    position: "absolute",
    fontSize: 92,
    fontWeight: "900",
    color: "rgba(255,255,255,0.07)",
    letterSpacing: 10,
    transform: [{ rotate: "-18deg" }],
  },
  watermarkIcon: { fontSize: 220, opacity: 0.08 },
  flexCenter: { flex: 1, justifyContent: "center", padding: 24, gap: 28 },
  brandBlock: { alignItems: "center", gap: 8 },
  brandGlowWrap: { alignItems: "center", justifyContent: "center" },
  brandGlow: { position: "absolute", width: 80, height: 80, borderRadius: 40, backgroundColor: "#a78bfa" },
  brandBadge: {
    width: 56, height: 56, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.25)",
  },
  brandBadgeIcon: { fontSize: 26 },
  brandLabel: { color: "rgba(255,255,255,0.7)", fontSize: 12, letterSpacing: 2, textTransform: "uppercase" },
  brandTagline: { color: "rgba(255,255,255,0.45)", fontSize: 12 },
  card: { backgroundColor: "#ffffff", borderRadius: 20, padding: 24, gap: 12, shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 20, shadowOffset: { width: 0, height: 10 }, elevation: 8 },
  title: { fontSize: 24, fontWeight: "700", color: "#0f172a" },
  subtitle: { fontSize: 13, color: "#64748b", marginBottom: 8 },
  input: { borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  passwordWrap: { position: "relative" },
  passwordInput: { paddingRight: 40 },
  pressedDim: { opacity: 0.5 },
  rememberForgotRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  rememberRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  rememberLabel: { fontSize: 14, color: "#334155" },
  forgotToggle: { fontSize: 12, color: "#7628e8", fontWeight: "600" },
  forgotPanel: { gap: 8, marginTop: -4 },
  forgotButton: { borderWidth: 1, borderColor: "#7628e8", borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  forgotButtonDisabled: { borderColor: "#c9b5f2", opacity: 0.6 },
  forgotButtonPressed: { backgroundColor: "#f1ebff" },
  forgotButtonText: { color: "#7628e8", fontWeight: "700", fontSize: 13 },
  forgotStatus: { fontSize: 11, color: "#6220ca" },
  error: { color: "#dc2626", fontSize: 13 },
  submitButton: { backgroundColor: "#7628e8", borderRadius: 10, paddingVertical: 14, alignItems: "center", marginTop: 8 },
  submitButtonPressed: { backgroundColor: "#6220ca" },
  submitButtonDisabled: { opacity: 0.6 },
  submitButtonText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  spinner: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: "rgba(255,255,255,0.35)", borderTopColor: "#fff" },
  spinnerTeal: { borderColor: "rgba(118,40,232,0.25)", borderTopColor: "#7628e8" },
  link: { color: "#7628e8", textAlign: "center", marginTop: 4, fontSize: 13, fontWeight: "600" },
});
