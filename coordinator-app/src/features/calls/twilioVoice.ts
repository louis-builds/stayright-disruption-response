export async function connectVoice(_token: string, _callId: string) {
  // Native Expo shell has no Twilio Voice SDK. Backend PlaceBridge rings the coordinator phone instead.
}

export function setMuted(_muted: boolean) {}

export async function disconnectVoice() {}
