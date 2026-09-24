import { StyleSheet, Text, View } from "react-native";

// 临时占位屏——Task 3-7 会逐个替换成真实功能页面，不是最终产物。
export function PlaceholderScreen({ title }: { title: string }) {
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>Coming soon</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#f7f8fc", gap: 8 },
  title: { fontSize: 18, fontWeight: "700", color: "#202438" },
  subtitle: { fontSize: 13, color: "#777b8e" },
});
