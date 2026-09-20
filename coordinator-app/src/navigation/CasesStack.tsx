import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { CaseDetailScreen } from "../features/cases/CaseDetailScreen";
import { CaseQueueScreen } from "../features/cases/CaseQueueScreen";
import type { CalleeType } from "../features/calls/types";
import { CallSummaryScreen } from "../features/calls/CallSummaryScreen";
import { InCallScreen } from "../features/calls/InCallScreen";
import { RecordingDetailScreen } from "../features/calls/RecordingDetailScreen";

export type CasesStackParamList = {
  CaseQueue: undefined;
  CaseDetail: { caseId: string };
  InCall: { caseId: string; callId: string; calleeType: CalleeType };
  CallSummary: { caseId: string; callId: string; calleeType: CalleeType };
  RecordingDetail: { callId: string };
};

const Stack = createNativeStackNavigator<CasesStackParamList>();

export function CasesStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="CaseQueue" component={CaseQueueScreen} options={{ title: "Cases" }} />
      <Stack.Screen name="CaseDetail" component={CaseDetailScreen} options={{ title: "Case Detail" }} />
      <Stack.Screen name="InCall" component={InCallScreen} options={{ title: "In Call", gestureEnabled: false, contentStyle: { flex: 1, backgroundColor: "#0f172a" } }} />
      <Stack.Screen name="CallSummary" component={CallSummaryScreen} options={{ title: "Call Summary", gestureEnabled: false, contentStyle: { flex: 1, backgroundColor: "#f1f5f9" } }} />
      <Stack.Screen name="RecordingDetail" component={RecordingDetailScreen} options={{ title: "Recording" }} />
    </Stack.Navigator>
  );
}
