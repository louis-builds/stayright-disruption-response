import type { CallRecordingFile } from "./contracts";

export function createCallRecorder() {
  let ctx: AudioContext | null = null;
  let dest: MediaStreamAudioDestinationNode | null = null;
  let recorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let startedAt = 0;

  function ensure() {
    if (ctx) return;
    const AudioCtx = globalThis.AudioContext ?? (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx || typeof MediaRecorder === "undefined") return;
    ctx = new AudioCtx();
    dest = ctx.createMediaStreamDestination();
  }

  function connect(stream: MediaStream) {
    ensure();
    if (!ctx || !dest) return;
    ctx.createMediaStreamSource(stream).connect(dest);
  }

  return {
    attachLocal(stream: MediaStream) { connect(stream); },
    attachRemote(stream: MediaStream) { connect(stream); },
    start() {
      if (recorder || !dest || typeof MediaRecorder === "undefined") return;
      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find(type => MediaRecorder.isTypeSupported(type)) ?? "";
      chunks = [];
      recorder = new MediaRecorder(dest.stream, mimeType ? { mimeType } : undefined);
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.start(1000);
      startedAt = Date.now();
      void ctx?.resume();
    },
    async stop(): Promise<CallRecordingFile | null> {
      const rec = recorder;
      if (!rec || rec.state === "inactive") return null;
      const blob = await new Promise<Blob>(resolve => {
        rec.onstop = () => resolve(new Blob(chunks, { type: rec.mimeType || "audio/webm" }));
        rec.stop();
      });
      recorder = null;
      if (blob.size < 64) return null;
      const mimeType = blob.type || "audio/webm";
      return {
        blob,
        mimeType,
        fileName: mimeType.includes("mp4") ? "call.m4a" : "call.webm",
        durationSeconds: Math.max(1, Math.round((Date.now() - startedAt) / 1000)),
      };
    },
    close() {
      try { if (recorder && recorder.state !== "inactive") recorder.stop(); } catch { /* already stopped */ }
      recorder = null;
      void ctx?.close();
      ctx = null;
      dest = null;
      chunks = [];
    },
  };
}
