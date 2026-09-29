import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { AppState, Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { CallController } from "../../../../shared/calling/CallController";
import { useAuth } from "../auth";
import { makeCallController } from "./callingClient";

const Context = createContext<CallController | null>(null);
export function useCalling() {
  const controller = useContext(Context);
  if (!controller) throw new Error("CallProvider missing");
  const view = useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot);
  return { controller, ...view };
}
export function CallProvider({ children }: { children: ReactNode }) {
  const { user, status } = useAuth();
  const controller = useMemo(() => makeCallController("guest"), [user?.id]);
  useEffect(() => {
    if (status !== "authenticated") return;
    void controller.start();
    const subscription = AppState.addEventListener("change", next => {
      void controller.handleAppStateChange(next, Platform.OS);
    });
    return () => { subscription.remove(); void controller.stop(); };
  }, [controller, status]);
  return <Context.Provider value={controller}>{children}<CallModal /></Context.Provider>;
}

function CallModal() {
  const { controller, call, phase, busy, muted, playbackBlocked, error, connectedAt } = useCalling();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (phase !== "connected") return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [phase]);
  const seconds = connectedAt ? Math.max(0, Math.floor((now - connectedAt) / 1000)) : 0;
  const duration = String(Math.floor(seconds / 60)).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0");
  const labels = { idle: "", preparing: "Preparing microphone…", incoming: "Incoming voice call",
    ringing: "Waiting for guest…", connecting: "Connecting audio…", connected: "Connected", ended: "Call ended" };
  const outcome = call?.status === "rejected" ? "Call declined" : call?.status === "no_answer" ? "Not answered" : "Call ended";
  return (
    <Modal visible={phase !== "idle"} animationType="slide" onRequestClose={() => {
      if (phase === "ended") controller.dismiss();
      else void controller.end(phase === "incoming");
    }}>
      <View style={styles.screen}>
        <Text style={styles.title}>{phase === "ended" ? outcome : labels[phase]}</Text>
        <Text style={styles.name}>{"Coordinator"}</Text>
        {call && <Text style={styles.detail}>Case {call.caseId.slice(0, 8)}{call.confirmationNo ? " · " + call.confirmationNo : ""}</Text>}
        {phase === "connected" && <Text style={styles.timer}>{duration}</Text>}
        <Text style={styles.detail}>Voice only · This call may be recorded</Text>
        {error && <Text style={styles.error} accessibilityRole="alert">{error}</Text>}
        {playbackBlocked && <Pressable style={styles.button} onPress={() => void controller.play()}><Text style={styles.buttonText}>Enable audio</Text></Pressable>}
        {phase === "incoming" && <View style={styles.row}>
          <Pressable accessibilityRole="button" disabled={busy} style={[styles.button, styles.accept]} onPress={() => void controller.accept()}>
            <Text style={styles.buttonText}>{busy ? "Preparing…" : "Accept"}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" style={[styles.button, styles.end]} onPress={() => void controller.reject()}><Text style={styles.buttonText}>Reject</Text></Pressable>
        </View>}
        {(phase === "connected" || phase === "connecting") && <Pressable accessibilityRole="button" style={styles.button} onPress={() => controller.mute()}>
          <Text style={styles.buttonText}>{muted ? "Unmute" : "Mute"}</Text>
        </Pressable>}
        {phase !== "incoming" && phase !== "ended" && <Pressable accessibilityRole="button" style={[styles.button, styles.end]} onPress={() => void controller.end()}>
          <Text style={styles.buttonText}>End call</Text>
        </Pressable>}
        {phase === "ended" && <Pressable accessibilityRole="button" disabled={busy} style={styles.button} onPress={() => controller.dismiss()}>
          <Text style={styles.buttonText}>{busy ? "Ending…" : "Done"}</Text>
        </Pressable>}
      </View>
    </Modal>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0f172a", justifyContent: "center", alignItems: "center", padding: 28, gap: 22 },
  title: { color: "#cbd5e1", fontSize: 20, textAlign: "center" },
  name: { color: "#fff", fontWeight: "700", fontSize: 30 },
  detail: { color: "#94a3b8", textAlign: "center" },
  timer: { color: "#fff", fontSize: 42, fontVariant: ["tabular-nums"] },
  error: { color: "#fca5a5", textAlign: "center", maxWidth: 450 },
  row: { flexDirection: "row", gap: 20 },
  button: { paddingVertical: 16, paddingHorizontal: 30, borderRadius: 30, backgroundColor: "#475569" },
  buttonText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  accept: { backgroundColor: "#15803d" },
  end: { backgroundColor: "#b91c1c" },
});
