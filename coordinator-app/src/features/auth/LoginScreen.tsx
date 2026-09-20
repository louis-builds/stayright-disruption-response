import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useAuth } from "./AuthContext";
import { PasswordEyeButton } from "../../shared/PasswordEyeButton";

// 通用功能优化需求.txt 的分页/搜索/图表/通知机制/额外实用功能几条对登录页不适用——
// 登录页只有一个提交动作，没有列表/统计可言，跳过，不为了凑数硬加。

export function LoginScreen() {
  const { login, rememberedIdentifier } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 通用页面优化需求.txt 第3条:页面变化要有渐变——卡片进场淡入+轻微上移，不是生硬地一下子出现。
  const entrance = useRef(new Animated.Value(0)).current;
  const errorFade = useRef(new Animated.Value(0)).current;
  const errorShake = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(entrance, {
      toValue: 1,
      duration: 500,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [entrance]);

  // 通用页面优化需求.txt 第6条:眼前一亮的特效——品牌徽标背后一圈缓慢明暗的光晕,
  // 让深色登录背景不那么死板,成本只是一个循环透明度动画。
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
    Animated.timing(errorFade, {
      toValue: error ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
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

  return (
    <LinearGradient colors={["#0f172a", "#1e1b4b", "#0f172a"]} style={styles.screen}>
      <View pointerEvents="none" style={styles.backdrop}>
        <Text style={styles.watermarkIcon}>🎧</Text>
        <Text style={styles.watermark}>COORDINATOR</Text>
      </View>
      <KeyboardAvoidingView style={styles.flexCenter} behavior={Platform.OS === "ios" ? "padding" : undefined}>
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
              <Text style={styles.brandBadgeIcon}>🎧</Text>
            </View>
          </View>
          <Text style={styles.brandLabel}>StayRight NZ</Text>
          <Text style={styles.brandTagline}>Operations · cases and calls</Text>
        </Animated.View>

        <Animated.View
          style={[
            styles.card,
            { opacity: entrance, transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }] },
          ]}
        >
          <Text style={styles.title}>Coordinator App</Text>
          <Text style={styles.subtitle}>Sign in to the coordinator desk</Text>

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

          <View style={styles.rememberRow}>
            <Switch value={rememberMe} onValueChange={setRememberMe} />
            <Text style={styles.rememberLabel}>Remember me</Text>
          </View>

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
            style={({ pressed }) => [
              styles.submitButton,
              submitting && styles.submitButtonDisabled,
              pressed && !submitting && styles.submitButtonPressed,
            ]}
            onPress={submit}
            disabled={submitting}
          >
            {submitting ? (
              <SpinningDot />
            ) : (
              <Text style={styles.submitButtonText}>Sign In</Text>
            )}
          </Pressable>
        </Animated.View>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

// 通用页面优化需求.txt 第2条:运行中要有明显 loading 效果——用一个跟品牌色一致的旋转指示器
// 替代默认白色 ActivityIndicator，跟按钮底色贴合度更高，比系统默认转圈更有细节。
function SpinningDot() {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 800, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [spin]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  return <Animated.View style={[styles.spinner, { transform: [{ rotate }] }]} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  backdrop: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center" },
  watermark: {
    position: "absolute",
    fontSize: 54,
    fontWeight: "900",
    color: "rgba(255,255,255,0.08)",
    letterSpacing: 6,
    transform: [{ rotate: "-18deg" }],
  },
  watermarkIcon: { fontSize: 220, opacity: 0.1 },
  flexCenter: { flex: 1, justifyContent: "center", padding: 24, gap: 28 },
  brandBlock: { alignItems: "center", gap: 8 },
  brandGlowWrap: { alignItems: "center", justifyContent: "center" },
  brandGlow: { position: "absolute", width: 80, height: 80, borderRadius: 40, backgroundColor: "#818cf8" },
  brandBadge: {
    width: 56, height: 56, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.12)",
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
  rememberRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  rememberLabel: { fontSize: 14, color: "#334155" },
  error: { color: "#dc2626", fontSize: 13 },
  submitButton: { backgroundColor: "#4f46e5", borderRadius: 10, paddingVertical: 14, alignItems: "center", marginTop: 8 },
  submitButtonPressed: { backgroundColor: "#4338ca" },
  submitButtonDisabled: { opacity: 0.6 },
  submitButtonText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  spinner: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: "rgba(255,255,255,0.35)", borderTopColor: "#fff" },
});
