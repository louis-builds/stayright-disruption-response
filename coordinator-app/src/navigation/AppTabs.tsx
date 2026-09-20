import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Platform, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { NotificationCenterScreen } from "../features/notifications";
import { SettingsScreen } from "../features/settings";
import { CallsStack } from "./CallsStack";
import { CasesStack } from "./CasesStack";

const Tab = createBottomTabNavigator();

function tabIcon(icon: string) {
  return () => <Text style={{ fontSize: 18 }}>{icon}</Text>;
}

export function useAppTabBarStyle() {
  const insets = useSafeAreaInsets();
  const paddingBottom = Math.max(insets.bottom, Platform.OS === "android" ? 32 : 8);
  return {
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
    height: 56 + paddingBottom,
    paddingTop: 6,
    paddingBottom,
  };
}

export function AppTabs() {
  const tabBarStyle = useAppTabBarStyle();
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: true,
        tabBarActiveTintColor: "#4f46e5",
        tabBarInactiveTintColor: "#64748b",
        tabBarLabelStyle: { fontSize: 11, fontWeight: "700" },
        tabBarStyle,
      }}
    >
      <Tab.Screen
        name="Cases"
        component={CasesStack}
        options={{ title: "Cases", headerShown: false, tabBarIcon: tabIcon("📋") }}
      />
      <Tab.Screen
        name="Calls"
        component={CallsStack}
        options={{ title: "Calls", headerShown: false, tabBarIcon: tabIcon("📞") }}
      />
      <Tab.Screen
        name="Notifications"
        component={NotificationCenterScreen}
        options={{ title: "Notifications", tabBarIcon: tabIcon("🔔") }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ title: "Settings", tabBarIcon: tabIcon("👤") }}
      />
    </Tab.Navigator>
  );
}
