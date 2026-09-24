import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { CaseDetailScreen } from "../features/cases/CaseDetailScreen";
import { CaseQueueScreen } from "../features/cases/CaseQueueScreen";
import type { CalleeType } from "../features/calls/types";

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
    </Stack.Navigator>
  );
}
