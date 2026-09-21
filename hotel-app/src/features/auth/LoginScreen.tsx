import Constants from "expo-constants";
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
import * as api from "./api";
import { useAuth } from "./AuthContext";
import { PasswordEyeButton } from "../../shared/PasswordEyeButton";

// 通用功能优化需求.txt 的分页/搜索/图表/通知机制几条对登录页不适用——
// 登录页只有一个提交动作，没有列表/统计可言，跳过，不为了凑数硬加。
// 第4条"额外实用功能"：web端 frontend/src/features/auth/LoginPage.tsx 已经有 Forgot password
// 流程，后端 /api/auth/forgot-password 也是真实存在的接口，只是这个移动端一直没接——
// 补齐这个已有真实后端支撑的功能，而不是凭空发明一个新特性。

export function LoginScreen() {
  const { login, rememberedIdentifier } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // error 变 null 后还要留着这份文案给 errorFade 淡出动画播完，不然 {error && ...} 会让
  // Animated.Text 在这一帧直接卸载，动画根本没机会跑，错误提示是硬生生消失而不是淡出的。
  const [displayedError, setDisplayedError] = useState<string | null>(null);
  const [identifierFocused, setIdentifierFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const passwordInputRef = useRef<TextInput>(null);

  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotEmailFocused, setForgotEmailFocused] = useState(false);
  const [forgotSubmitting, setForgotSubmitting] = useState(false);
  const [forgotStatus, setForgotStatus] = useState<{ ok: boolean; text: string } | null>(null);

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

  // 通用页面优化需求.txt 第6条:眼前一亮的特效——品牌徽标背后一圈缓慢明暗的光晕。
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
    if (error) {
      setDisplayedError(error);
      Animated.timing(errorFade, { toValue: 1, duration: 200, useNativeDriver: true }).start();
      errorShake.setValue(0);
      Animated.sequence([
        Animated.timing(errorShake, { toValue: 1, duration: 60, useNativeDriver: true }),
        Animated.timing(errorShake, { toValue: -1, duration: 60, useNativeDriver: true }),
        Animated.timing(errorShake, { toValue: 1, duration: 60, useNativeDriver: true }),
        Animated.timing(errorShake, { toValue: 0, duration: 60, useNativeDriver: true }),
      ]).start();
    } else {
      // finished 为 false 说明这次淡出动画被下一次 setError(message) 打断了(连续两次失败登录挤在一起)，
      // 这时 displayedError 已经是新错误文案，不能被这个旧动画的回调清空。
      Animated.timing(errorFade, { toValue: 0, duration: 200, useNativeDriver: true }).start(({ finished }) => {
        if (finished) setDisplayedError(null);
      });
    }
  }, [error, errorFade, errorShake]);

  const canSubmit = !!identifier.trim() && !!password;

  async function submit() {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError(null);
    const result = await login(identifier.trim(), password, rememberMe);
    if (!result.ok) setError(result.message);
    setSubmitting(false);
  }

  async function submitForgot() {
    if (!forgotEmail.trim() || forgotSubmitting) return;
    setForgotSubmitting(true);
    setForgotStatus(null);
    try {
      await api.forgotPassword(forgotEmail.trim());
      setForgotStatus({ ok: true, text: "Reset link generated — check the server log (demo environment, no real email sent)." });
    } catch {
      setForgotStatus({ ok: false, text: "Failed to generate reset link, please try again later." });
    }
    setForgotSubmitting(false);
  }

  return (
    <LinearGradient colors={["#151126", "#24183f", "#422879"]} style={styles.screen}>
      <View pointerEvents="none" style={styles.backdrop}>
        <Text style={styles.watermarkIcon}>🏨</Text>
        <Text style={styles.watermark}>HOTEL</Text>
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
              <Text style={styles.brandBadgeIcon}>🏨</Text>
            </View>
          </View>
          <Text style={styles.brandLabel}>StayRight NZ</Text>
          <Text style={styles.brandTagline}>Hotel partners · incoming requests</Text>
        </Animated.View>

        <Animated.View
          style={[
            styles.card,
            { opacity: entrance, transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }] },
          ]}
        >
          <Text style={styles.title}>Hotel App</Text>
          <Text style={styles.subtitle}>Sign in with your username or email</Text>

          <TextInput
            style={[styles.input, identifierFocused && styles.inputFocused]}
            placeholder="Username / Email"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username"
            textContentType="username"
            returnKeyType="next"
            onSubmitEditing={() => passwordInputRef.current?.focus()}
            value={identifier}
            onChangeText={(v) => { setIdentifier(v); setError(null); }}
            onFocus={() => setIdentifierFocused(true)}
            onBlur={() => setIdentifierFocused(false)}
          />

          <View style={styles.passwordWrap}>
            <TextInput
              ref={passwordInputRef}
              style={[styles.input, styles.passwordInput, passwordFocused && styles.inputFocused]}
              placeholder="Password"
              secureTextEntry={!showPassword}
              autoComplete="password"
              textContentType="password"
              returnKeyType="go"
              onSubmitEditing={() => void submit()}
              value={password}
              onChangeText={(v) => { setPassword(v); setError(null); }}
              onFocus={() => setPasswordFocused(true)}
              onBlur={() => setPasswordFocused(false)}
            />
            <PasswordEyeButton visible={showPassword} onPress={() => setShowPassword((v) => !v)} />
          </View>

          <View style={styles.rowBetween}>
            <Pressable
              style={({ pressed }) => [styles.rememberRow, pressed && styles.pressedDim]}
              onPress={() => setRememberMe((v) => !v)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Switch value={rememberMe} onValueChange={setRememberMe} trackColor={{ true: "#7628e8" }} />
              <Text style={styles.rememberLabel}>Remember me</Text>
            </Pressable>
            <Pressable
              onPress={() => setForgotOpen((v) => !v)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={({ pressed }) => pressed && styles.pressedDim}
            >
              <Text style={styles.forgotLink}>Forgot password?</Text>
            </Pressable>
          </View>

          {forgotOpen && (
            <View style={styles.forgotBox}>
              <TextInput
                style={[styles.input, forgotEmailFocused && styles.inputFocused]}
                placeholder="Email"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                autoComplete="email"
                textContentType="emailAddress"
                returnKeyType="send"
                onSubmitEditing={() => void submitForgot()}
                value={forgotEmail}
                onChangeText={(v) => { setForgotEmail(v); setForgotStatus(null); }}
                onFocus={() => setForgotEmailFocused(true)}
                onBlur={() => setForgotEmailFocused(false)}
              />
              <Pressable
                style={({ pressed }) => [
                  styles.forgotSubmitButton,
                  (!forgotEmail.trim() || forgotSubmitting) && styles.buttonDisabled,
                  pressed && !!forgotEmail.trim() && !forgotSubmitting && styles.pressedDim,
                ]}
                disabled={!forgotEmail.trim() || forgotSubmitting}
                onPress={() => void submitForgot()}
              >
                <Text style={styles.forgotSubmitButtonText}>{forgotSubmitting ? "Sending…" : "Send reset link"}</Text>
              </Pressable>
              {forgotStatus && (
                <Text style={forgotStatus.ok ? styles.successText : styles.error}>{forgotStatus.text}</Text>
              )}
            </View>
          )}

          {displayedError && (
            <Animated.Text
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
              style={[
                styles.error,
                { opacity: errorFade, transform: [{ translateX: errorShake.interpolate({ inputRange: [-1, 1], outputRange: [-6, 6] }) }] },
              ]}
            >
              {displayedError}
            </Animated.Text>
          )}

          <Pressable
            style={({ pressed }) => [
              styles.submitButton,
              (submitting || !canSubmit) && styles.submitButtonDisabled,
              pressed && !submitting && canSubmit && styles.submitButtonPressed,
            ]}
            onPress={submit}
            disabled={submitting || !canSubmit}
          >
            {submitting ? (
              <SpinningDot />
            ) : (
              <Text style={styles.submitButtonText}>Sign In</Text>
            )}
          </Pressable>
        </Animated.View>
      </ScrollView>
      <View style={styles.footer}>
        <Text style={styles.footerBrand}>StayRight NZ Hotel App · v{Constants.expoConfig?.version ?? "—"}</Text>
        <Text style={styles.footerText}>
          Need help? <Text style={styles.footerLink}>support@traveldisruption.example</Text> · +64 4 800 0000
        </Text>
      </View>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

// 通用页面优化需求.txt 第2条:运行中要有明显 loading 效果。
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
    fontSize: 88,
    fontWeight: "900",
    color: "rgba(255,255,255,0.08)",
    letterSpacing: 10,
    transform: [{ rotate: "-18deg" }],
  },
  watermarkIcon: { fontSize: 220, opacity: 0.1 },
  flexCenter: { flex: 1, justifyContent: "center", padding: 24, gap: 28 },
  brandBlock: { alignItems: "center", gap: 8, alignSelf: "center", width: "100%", maxWidth: 420 },
  brandGlowWrap: { alignItems: "center", justifyContent: "center" },
  brandGlow: { position: "absolute", width: 96, height: 96, borderRadius: 48, backgroundColor: "#7628e8" },
  brandBadge: {
    width: 60, height: 60, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.25)",
  },
  brandBadgeIcon: { fontSize: 28 },
  brandLabel: { color: "rgba(255,255,255,0.7)", fontSize: 12, letterSpacing: 2, textTransform: "uppercase" },
  brandTagline: { color: "rgba(255,255,255,0.45)", fontSize: 12, marginTop: 2, textAlign: "center" },
  card: {
    backgroundColor: "#ffffff", borderRadius: 20, padding: 24, gap: 12, alignSelf: "center", width: "100%", maxWidth: 420,
    shadowColor: "#24183f", shadowOpacity: 0.35, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 8,
  },
  title: { fontSize: 24, fontWeight: "700", color: "#202438" },
  subtitle: { fontSize: 13, color: "#777b8e", marginBottom: 8 },
  input: {
    borderWidth: 1, borderColor: "#e1e4ec", borderRadius: 10, paddingHorizontal: 14, fontSize: 15, color: "#202438",
    // HyperOS/Android 15 上 paddingVertical + 默认行高会让单行输入文字偏上:
    // 去掉纵向 padding、改用固定高度 + 显式居中(includeFontPadding 去掉中文字体的额外下留白)。
    height: 48, textAlignVertical: "center", includeFontPadding: false,
    // Web 预览下 Chromium 自带的焦点描边(橙色)会盖过下面 inputFocused 的紫色边框——
    // 真机上没有浏览器 outline 这回事,这条纯粹是让 Expo Web 调试预览显示得和真机一致。
    ...(Platform.OS === "web" ? { outlineStyle: "none" as const } : {}),
  },
  inputFocused: { borderColor: "#7628e8", borderWidth: 1.5 },
  passwordWrap: { position: "relative" },
  passwordInput: { paddingRight: 40 },
  pressedDim: { opacity: 0.5 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  rememberRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  rememberLabel: { fontSize: 14, color: "#555a6e" },
  forgotLink: { color: "#7628e8", fontWeight: "600", fontSize: 13 },
  forgotBox: { gap: 8, backgroundColor: "#f7f5fc", borderRadius: 10, padding: 12 },
  forgotSubmitButton: { backgroundColor: "#7628e8", borderRadius: 8, paddingVertical: 10, alignItems: "center" },
  forgotSubmitButtonText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  buttonDisabled: { opacity: 0.5 },
  successText: { color: "#118568", fontSize: 12, fontWeight: "600" },
  error: { color: "#c0392b", fontSize: 13 },
  submitButton: { backgroundColor: "#7628e8", borderRadius: 10, paddingVertical: 14, alignItems: "center", marginTop: 8 },
  submitButtonPressed: { backgroundColor: "#5f4df3" },
  submitButtonDisabled: { opacity: 0.6 },
  submitButtonText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  spinner: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: "rgba(255,255,255,0.35)", borderTopColor: "#fff" },
  footer: { alignItems: "center", gap: 4, paddingBottom: 20, paddingTop: 12, paddingHorizontal: 24 },
  footerBrand: { color: "rgba(255,255,255,0.4)", fontSize: 11, fontWeight: "600", letterSpacing: 0.5 },
  footerText: { textAlign: "center", color: "rgba(255,255,255,0.55)", fontSize: 12 },
  footerLink: { color: "rgba(255,255,255,0.8)", fontWeight: "600" },
});
