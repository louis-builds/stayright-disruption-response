import AsyncStorage from "@react-native-async-storage/async-storage";
import { NavigationContainer } from "@react-navigation/native";
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { LoginScreen, PermissionsScreen, RegisterScreen, ServerGateScreen, useAuth } from "../features/auth";
import { AppTabs } from "./AppTabs";

const ONBOARDING_DONE_KEY = "guest-app:onboardingDone";
const SERVER_CONFIRMED_KEY = "guest-app:serverConfirmed";

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
  const [serverConfirmed, setServerConfirmed] = useState<boolean | null>(null);

  useEffect(() => {
    void AsyncStorage.getItem(ONBOARDING_DONE_KEY).then((v) => setOnboardingDone(v === "true"));
    void AsyncStorage.getItem(SERVER_CONFIRMED_KEY).then((v) => setServerConfirmed(v === "true"));
  }, []);

  if (status === "checking" || onboardingDone === null || serverConfirmed === null) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  // 服务器地址跟登录态无关,而且地址填错了连登录请求都发不出去——排在登录之前,只在
  // 第一次打开、从没确认过地址时挡一下,确认过一次以后不再出现,直接走正常登录流程。
  if (!serverConfirmed) {
    return (
      <ServerGateScreen
        onContinue={() => {
          void AsyncStorage.setItem(SERVER_CONFIRMED_KEY, "true");
          setServerConfirmed(true);
        }}
      />
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
