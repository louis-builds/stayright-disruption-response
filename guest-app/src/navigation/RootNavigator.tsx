import AsyncStorage from "@react-native-async-storage/async-storage";
import { NavigationContainer } from "@react-navigation/native";
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { LoginScreen, PermissionsScreen, RegisterScreen, useAuth } from "../features/auth";
import { AppTabs } from "./AppTabs";

const ONBOARDING_DONE_KEY = "guest-app:onboardingDone";

function AuthGate() {
  const [screen, setScreen] = useState<"login" | "register">("login");
  return screen === "login" ? (
    <LoginScreen onGoToRegister={() => setScreen("register")} />
  ) : (
    <RegisterScreen onGoToLogin={() => setScreen("login")} />
  );
}

export function RootNavigator() {
  const { status } = useAuth();
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null);

  useEffect(() => {
    void AsyncStorage.getItem(ONBOARDING_DONE_KEY).then((v) => setOnboardingDone(v === "true"));
  }, []);

  if (status === "checking" || onboardingDone === null) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  // 权限引导页要调 POST /api/push/register(需要登录态),所以必须排在登录之后、
  // 主界面之前——不能像 Task 1 占位实现那样排在登录之前,那时候还没有 session cookie。
  if (status !== "authenticated") {
    return (
      <View style={{ flex: 1 }}>
        <NavigationContainer>
          <AuthGate />
        </NavigationContainer>
      </View>
    );
  }

  if (!onboardingDone) {
    return (
      <PermissionsScreen
        onContinue={() => {
          void AsyncStorage.setItem(ONBOARDING_DONE_KEY, "true");
          setOnboardingDone(true);
        }}
      />
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <NavigationContainer>
        <AppTabs />
      </NavigationContainer>
    </View>
  );
}
