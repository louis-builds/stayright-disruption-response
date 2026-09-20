import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BookingsScreen } from "../features/bookings/BookingsScreen";
import { NotificationCenterScreen } from "../features/notifications/NotificationCenterScreen";
import { HomeStack } from "./HomeStack";
import { SettingsStack } from "./SettingsStack";

const Tab = createBottomTabNavigator();

const TAB_ICONS: Record<string, string> = {
  Home: "🏠",
  Bookings: "🧳",
  Notifications: "🔔",
  Settings: "👤",
};

function GuestTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  return (
    <View nativeID="guest-tabbar" style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const label = descriptors[route.key].options.title ?? route.name;
        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            onPress={() => {
              const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
            }}
            style={styles.item}
          >
            <Text style={styles.icon}>{TAB_ICONS[route.name] ?? "•"}</Text>
            <Text style={[styles.label, focused && styles.labelActive]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function AppTabs() {
  return (
    <Tab.Navigator
      tabBar={(props) => <GuestTabBar {...props} />}
      screenOptions={{ headerShown: true }}
    >
      <Tab.Screen name="Home" component={HomeStack} options={{ title: "Home", headerShown: false }} />
      <Tab.Screen name="Bookings" component={BookingsScreen} options={{ title: "Bookings" }} />
      <Tab.Screen name="Notifications" component={NotificationCenterScreen} options={{ title: "Notifications" }} />
      <Tab.Screen name="Settings" component={SettingsStack} options={{ title: "Settings", headerShown: false }} />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 100,
    flexDirection: "row",
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
    minHeight: 64,
    paddingTop: 8,
  },
  item: { flex: 1, alignItems: "center", justifyContent: "center", gap: 2 },
  icon: { fontSize: 18 },
  label: { fontSize: 11, fontWeight: "700", color: "#64748b" },
  labelActive: { color: "#7628e8" },
});
