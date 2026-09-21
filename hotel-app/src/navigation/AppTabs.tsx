import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Text } from "react-native";
import { HistoryScreen } from "../features/history";
import { InboxScreen, useInboxBadgeCount } from "../features/inbox";
import { NotificationCenterScreen, useNotificationBadgeCount } from "../features/notifications";
import { ProfileScreen } from "../features/profile";
import { SettingsScreen } from "../features/settings";

// 常见问题.txt: app 底部横排一级导航。五个一级 Tab 对应脑图 Common Frame 的 Tab Navigation。
const Tab = createBottomTabNavigator();

function tabIcon(icon: string) {
  return () => <Text style={{ fontSize: 18 }}>{icon}</Text>;
}

export function AppTabs() {
  const inboxBadge = useInboxBadgeCount();
  const notificationBadge = useNotificationBadgeCount();
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: true,
        tabBarActiveTintColor: "#7628e8",
        tabBarInactiveTintColor: "#64748b",
        tabBarLabelStyle: { fontSize: 11, fontWeight: "700" },
        tabBarStyle: {
          backgroundColor: "#fff",
          borderTopWidth: 1,
          borderTopColor: "#e2e8f0",
          height: 64,
          paddingTop: 6,
          paddingBottom: 8,
        },
      }}
    >
      <Tab.Screen
        name="Inbox"
        component={InboxScreen}
        options={{ title: "To-dos", tabBarIcon: tabIcon("📥"), tabBarBadge: inboxBadge > 0 ? inboxBadge : undefined }}
      />
      <Tab.Screen name="History" component={HistoryScreen} options={{ title: "Done", tabBarIcon: tabIcon("🗂️") }} />
      <Tab.Screen name="Profile" component={ProfileScreen} options={{ title: "Hotel Profile", tabBarIcon: tabIcon("🏨") }} />
      <Tab.Screen
        name="Notifications"
        component={NotificationCenterScreen}
        options={{ title: "Notifications", tabBarIcon: tabIcon("🔔"), tabBarBadge: notificationBadge > 0 ? notificationBadge : undefined }}
      />
      <Tab.Screen name="Settings" component={SettingsScreen} options={{ title: "Settings", tabBarIcon: tabIcon("👤") }} />
    </Tab.Navigator>
  );
}
