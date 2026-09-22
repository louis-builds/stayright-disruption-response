import type { Call as TwilioCall, Device as TwilioDevice } from "@twilio/voice-sdk";

let device: TwilioDevice | null = null;
let connection: TwilioCall | null = null;

export async function connectVoice(token: string, callId: string) {
  await disconnectVoice();
  const { Device } = await import("@twilio/voice-sdk");
  device = new Device(token, { logLevel: "error" });
  await device.register();
  connection = await device.connect({ params: { CallId: callId } });
}

export function setMuted(muted: boolean) {
  connection?.mute(muted);
}

export async function disconnectVoice() {
  try {
    connection?.disconnect();
  } catch {
    /* already down */
  }
  connection = null;
  if (device) {
    try {
      device.unregister();
    } catch {
      /* already down */
    }
    device.destroy();
    device = null;
  }
}
