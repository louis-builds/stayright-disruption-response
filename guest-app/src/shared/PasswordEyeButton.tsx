import { createElement, type ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text } from "react-native";

export function PasswordEyeButton({
  visible,
  onPress,
  color = "#5c7690",
}: {
  visible: boolean;
  onPress: () => void;
  color?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={visible ? "Hide password" : "Show password"}
      hitSlop={8}
      style={({ pressed }) => [styles.btn, pressed && styles.pressed]}
    >
      <EyeIcon slashed={!visible} color={color} />
    </Pressable>
  );
}

function EyeIcon({ slashed, color }: { slashed: boolean; color: string }) {
  if (Platform.OS !== "web") {
    return <Text style={{ color, fontSize: 16 }}>{slashed ? "⊘" : "◎"}</Text>;
  }
  const children: ReactNode[] = [
    createElement("path", { key: "p", d: "M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z" }),
    createElement("circle", { key: "c", cx: 12, cy: 12, r: 3 }),
  ];
  if (slashed) children.push(createElement("line", { key: "l", x1: 2, y1: 2, x2: 22, y2: 22 }));
  return createElement(
    "svg",
    {
      width: 18,
      height: 18,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: color,
      strokeWidth: 2,
      strokeLinecap: "round",
      strokeLinejoin: "round",
    },
    children,
  );
}

const styles = StyleSheet.create({
  btn: { position: "absolute", right: 8, top: 0, bottom: 0, justifyContent: "center", paddingHorizontal: 4 },
  pressed: { opacity: 0.55 },
});
