import { Linking, Platform } from "react-native";
import type { ApiResponse } from "../../shared/api/types";
import * as api from "./api";
import { connectVoice } from "./twilioVoice";
import type { Call, CalleeType } from "./types";

export async function startCoordinatorCall(caseId: string, calleeType: CalleeType): Promise<ApiResponse<Call>> {
  const res = await api.initiateCall(caseId, calleeType);
  if (res.code !== 0 || !res.data) return res;

  if (res.data.provider === "system") {
    const phone = res.data.calleePhone?.replace(/[^\d+]/g, "");
    if (!phone) return { code: 400, message: "No phone number on this case.", data: res.data };
    const url = `tel:${phone}`;
    try {
      await Linking.openURL(url);
    } catch {
      return { code: 500, message: `Could not open the phone dialer for ${phone}.`, data: res.data };
    }
    return res;
  }

  if (res.data.voiceEnabled && Platform.OS === "web") {
    const token = await api.getVoiceToken();
    if (token.code !== 0 || !token.data) {
      await api.endCall(res.data.id);
      return { code: token.code, message: token.message, data: res.data };
    }
    try {
      await connectVoice(token.data.token, res.data.id);
    } catch (err) {
      await api.endCall(res.data.id);
      return { code: 500, message: err instanceof Error ? err.message : "Could not start microphone call.", data: res.data };
    }
  } else if (res.data.voiceEnabled) {
    const bridge = await api.placeBridge(res.data.id);
    if (bridge.code !== 0) {
      await api.endCall(res.data.id);
      return { code: bridge.code, message: bridge.message, data: res.data };
    }
  }

  return res;
}
