import type { AudioPeer, IceCandidate, IceServer, PeerCallbacks } from "../../../../shared/calling/contracts";
import { createCallRecorder } from "../../../../shared/calling/recordAudio";

export function createAudioPeer(callbacks: PeerCallbacks): AudioPeer {
  let closed = false;
  let remoteReady = false;
  const queued: IceCandidate[] = [];
  const PeerConnection = globalThis.RTCPeerConnection;
  let pc: RTCPeerConnection | null = null;
  let local: MediaStream | null = null;
  let audio: HTMLAudioElement | null = null;
  const recorder = createCallRecorder();
  async function remote(sdp: string, type: "offer" | "answer") {
    if (type === "offer") queued.length = 0;
    await pc!.setRemoteDescription({ type, sdp });
    remoteReady = true;
    for (const candidate of queued.splice(0)) await pc!.addIceCandidate(candidate);
  }
  return {
    async prepare(iceServers: IceServer[]) {
      if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia)
        throw new Error("Microphone requires HTTPS or localhost.");
      if (!PeerConnection) throw new Error("This browser does not support voice calls.");
      audio = document.createElement("audio");
      audio.autoplay = true;
      audio.setAttribute("playsinline", "true");
      document.body.appendChild(audio);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      if (closed) { stream.getTracks().forEach(t => t.stop());  return; }
      local = stream;
      recorder.attachLocal(stream);
      pc = new PeerConnection({ iceServers });
      pc.addEventListener("icecandidate", event => {
        const c = event.candidate;
        if (c && !closed) callbacks.candidate({ candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex });
      });
      pc.addEventListener("connectionstatechange", () => { if (!closed) callbacks.state(pc!.connectionState); });
      pc.addEventListener("track", event => {
        if (closed || !audio) return;
        const remote = event.streams[0] ?? new MediaStream([event.track]);
        recorder.attachRemote(remote);
        audio.srcObject = remote;
        void audio.play().catch(() => { if (!closed) callbacks.playbackBlocked(); });
      });
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
    async play() { await audio?.play(); },
    startRecording() { recorder.start(); },
    stopRecording() { return recorder.stop(); },
    close() {
      closed = true;
      recorder.close();
      local?.getTracks().forEach(t => t.stop());
      pc?.close(); pc = null;
      if (audio) { audio.pause(); audio.srcObject = null; audio.remove(); audio = null; }
      local = null;
      queued.length = 0;
    },
  };
}
