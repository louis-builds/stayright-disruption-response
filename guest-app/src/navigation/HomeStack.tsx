import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { CaseConversationScreen } from "../features/cases/CaseConversationScreen";
import { OptionsFlowScreen } from "../features/cases/OptionsFlowScreen";
import { HomeScreen } from "../features/home/HomeScreen";

export type HomeStackParamList = {
  HomeMain: undefined;
  CaseConversation: { caseId: string };
  OptionsFlow: { caseId: string };
};

const Stack = createNativeStackNavigator<HomeStackParamList>();

export function HomeStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="HomeMain" component={HomeScreen} options={{ title: "Home" }} />
      <Stack.Screen name="CaseConversation" component={CaseConversationScreen} options={{ title: "Case" }} />
      <Stack.Screen name="OptionsFlow" component={OptionsFlowScreen} options={{ title: "Recovery Options" }} />
    </Stack.Navigator>
  );
}
