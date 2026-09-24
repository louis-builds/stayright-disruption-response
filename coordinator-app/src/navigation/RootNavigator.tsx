import AsyncStorage from "@react-native-async-storage/async-storage";
import { NavigationContainer } from "@react-navigation/native";
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { LoginScreen, PermissionsScreen, useAuth } from "../features/auth";
import { AppTabs } from "./AppTabs";

const ONBOARDING_DONE_KEY = "coordinator-app:onboardingDone";

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
      <NavigationContainer>{status === "authenticated" ? <AppTabs /> : <LoginScreen />}</NavigationContainer>
    </View>
  );
}
