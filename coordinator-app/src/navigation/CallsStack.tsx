import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { MyCallsScreen } from "../features/calls/MyCallsScreen";
import { RecordingDetailScreen } from "../features/calls/RecordingDetailScreen";

export type CallsStackParamList = {
  MyCalls: undefined;
  RecordingDetail: { callId: string };
};

const Stack = createNativeStackNavigator<CallsStackParamList>();

export function CallsStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="MyCalls" component={MyCallsScreen} options={{ title: "My Calls" }} />
      <Stack.Screen name="RecordingDetail" component={RecordingDetailScreen} options={{ title: "Recording" }} />
    </Stack.Navigator>
  );
}
