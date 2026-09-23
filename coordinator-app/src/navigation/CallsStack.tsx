import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { MyCallsScreen } from "../features/calls/MyCallsScreen";

export type CallsStackParamList = {
  MyCalls: undefined;
  RecordingDetail: { callId: string };
};

const Stack = createNativeStackNavigator<CallsStackParamList>();

export function CallsStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="MyCalls" component={MyCallsScreen} options={{ title: "My Calls" }} />
    </Stack.Navigator>
  );
}
