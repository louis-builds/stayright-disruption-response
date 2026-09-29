import { PermissionsAndroid, Platform } from "react-native";
import type { MediaStream, RTCPeerConnection } from "react-native-webrtc";
import type { AudioPeer, IceCandidate, IceServer, PeerCallbacks } from "../../../../shared/calling/contracts";

export function createAudioPeer(callbacks: PeerCallbacks): AudioPeer {
  let closed = false;
  let remoteReady = false;
  const queued: IceCandidate[] = [];
  let pc: RTCPeerConnection | null = null;
  let local: MediaStream | null = null;
  let remote: MediaStream | null = null;
  let Stream: typeof MediaStream | null = null;
  let recorder: { stop(): Promise<import("../../../../shared/calling/contracts").CallRecordingFile | null> } | null = null;
  let recordingStartedAt = 0;
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
      Stream = rtc.MediaStream;
      pc = new PeerConnection({ iceServers });
      pc.onicecandidate = (event: unknown) => {
        const candidate = (event as unknown as { candidate: { toJSON(): IceCandidate } | null }).candidate;
        if (candidate && !closed) callbacks.candidate(candidate.toJSON());
      };
      pc.onconnectionstatechange = () => { if (!closed) callbacks.state(pc!.connectionState); };
      pc.ontrack = (event: { streams: MediaStream[]; track: { kind?: string } }) => {
        remote = event.streams[0] ?? new rtc.MediaStream([event.track as never]);
        Stream = rtc.MediaStream;
      };
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
    startRecording() {
      if (recorder || typeof MediaRecorder === "undefined" || !local) return;
      const mixed = new (Stream ?? MediaStream)([
        ...local.getAudioTracks(),
        ...(remote?.getAudioTracks() ?? []),
      ]);
      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find(type => {
        try { return MediaRecorder.isTypeSupported(type); } catch { return false; }
      }) ?? "";
      const chunks: Blob[] = [];
      const rec = new MediaRecorder(mixed, mimeType ? { mimeType } : undefined);
      rec.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      rec.start(1000);
      recordingStartedAt = Date.now();
      recorder = {
        stop: async () => {
          if (rec.state === "inactive") return null;
          const blob = await new Promise<Blob>(resolve => {
            rec.onstop = () => resolve(new Blob(chunks, { type: rec.mimeType || "audio/webm" }));
            rec.stop();
          });
          if (blob.size < 64) return null;
          const type = blob.type || "audio/webm";
          return {
            blob,
            mimeType: type,
            fileName: type.includes("mp4") ? "call.m4a" : "call.webm",
            durationSeconds: Math.max(1, Math.round((Date.now() - recordingStartedAt) / 1000)),
          };
        },
      };
    },
    async stopRecording() {
      const file = recorder ? await recorder.stop() : null;
      recorder = null;
      return file;
    },
    close() {
      closed = true;
      recorder = null;
      local?.getTracks().forEach(t => t.stop());
      pc?.close(); pc = null;
      local?.release();
      local = null;
      remote = null;
      queued.length = 0;
    },
  };
}
