import { PermissionsAndroid, Platform } from "react-native";
import type { MediaStream, RTCPeerConnection } from "react-native-webrtc";
import type { AudioPeer, IceCandidate, IceServer, PeerCallbacks } from "../../../../shared/calling/contracts";

export function createAudioPeer(callbacks: PeerCallbacks): AudioPeer {
  let closed = false;
  let remoteReady = false;
  const queued: IceCandidate[] = [];
  let pc: RTCPeerConnection | null = null;
  let local: MediaStream | null = null;
  async function remote(sdp: string, type: "offer" | "answer") {
    if (type === "offer") queued.length = 0;
    await pc!.setRemoteDescription({ type, sdp });
    remoteReady = true;
    for (const candidate of queued.splice(0)) await pc!.addIceCandidate(candidate);
  }
  return {
    async prepare(iceServers: IceServer[]) {
      // Lazy import keeps ordinary app screens usable even in Expo Go.
      let rtc: typeof import("react-native-webrtc");
      try { rtc = require("react-native-webrtc"); }
      catch { throw new Error("Voice calls require an Android/iOS development build. Expo Go cannot run this module."); }
      if (Platform.OS === "android") {
        const permission = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
        if (permission !== PermissionsAndroid.RESULTS.GRANTED) throw new Error("Microphone permission was denied.");
      }
      const PeerConnection = rtc.RTCPeerConnection;
      const stream = await rtc.mediaDevices.getUserMedia({ audio: true, video: false });
      if (closed) { stream.getTracks().forEach(t => t.stop()); stream.release(); return; }
      local = stream;
      pc = new PeerConnection({ iceServers });
      pc.onicecandidate = (event: unknown) => {
        const candidate = (event as unknown as { candidate: { toJSON(): IceCandidate } | null }).candidate;
        if (candidate && !closed) callbacks.candidate(candidate.toJSON());
      };
      pc.onconnectionstatechange = () => { if (!closed) callbacks.state(pc!.connectionState); };
      // Native WebRTC plays remote audio through its audio device module.
      for (const track of stream.getTracks()) pc.addTrack(track, stream);
    },
    async offer(iceRestart = false) {
      const description = await pc!.createOffer(iceRestart ? { iceRestart: true } : {});
      await pc!.setLocalDescription(description);
      return description.sdp!;
    },
    async answer(sdp) {
      await remote(sdp, "offer");
      const description = await pc!.createAnswer();
      await pc!.setLocalDescription(description);
      return description.sdp!;
    },
    async receiveAnswer(sdp) { await remote(sdp, "answer"); },
    async addCandidate(candidate) {
      if (closed) return;
      if (!remoteReady) { queued.push(candidate); return; }
      await pc!.addIceCandidate(candidate);
    },
    mute(value) { local?.getAudioTracks().forEach(t => { t.enabled = !value; }); },
    async play() {},
    close() {
      closed = true;
      local?.getTracks().forEach(t => t.stop());
      pc?.close(); pc = null;
      local?.release();
      local = null;
      queued.length = 0;
    },
  };
}
