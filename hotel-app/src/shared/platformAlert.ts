import { Alert, Platform } from "react-native";

// react-native-web 的 Alert.alert() 是个空实现(node_modules/react-native-web/dist/exports/Alert —
// static alert() {})，在 Web 上直接调用会完全静默不弹窗，按钮回调也永远不会触发。这里按平台分流，
// Web 用真正会弹窗的 window.alert/confirm，原生平台仍用 RN 自己的 Alert。
export function showAlert(title: string, message?: string) {
  if (Platform.OS === "web") {
    window.alert(message ? `${title}\n\n${message}` : title);
    return;
  }
  Alert.alert(title, message);
}

export function confirmAsync(title: string, message: string, confirmLabel = "Delete"): Promise<boolean> {
  if (Platform.OS === "web") {
    return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: confirmLabel, style: "destructive", onPress: () => resolve(true) },
    ]);
  });
}
