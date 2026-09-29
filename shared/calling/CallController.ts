import { terminal } from "./contracts.ts";
import type { AudioPeer, CallApi, CallSession, CallTransport, CallView, PeerCallbacks } from "./contracts.ts";

const CONNECT_WINDOW_MS = 30_000;
const RETRY_EVERY_MS = 3_000;
const RING_TIMEOUT_MS = 45_000;

// No React/native imports: the same lifecycle runs in both apps and in unit tests.
export class CallController {
  view: CallView = { call: null, phase: "idle", online: false, busy: false, muted: false,
    playbackBlocked: false, error: null, connectedAt: null };
  private listeners = new Set<() => void>();
  private peer: AudioPeer | null = null;
  private stopped = true;
  private generation = 0;
  private offered = false;
  private recovering = false;
  private offerFailed = false;
  private lastIce: string | null = null;
  private messages: Promise<void> = Promise.resolve();
  private poll: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setInterval> | null = null;
  private deadline: ReturnType<typeof setTimeout> | null = null;
  private refreshing = false;
  private pendingEnd: string | null = null;
  private seen = new Set<string>();
  private api: CallApi;
  private transport: CallTransport;
  private makePeer: (callbacks: PeerCallbacks) => AudioPeer;
  private role: "coordinator" | "guest";
  private connectWindowMs: number;
  private retryEveryMs: number;

  constructor(role: "coordinator" | "guest", api: CallApi, transport: CallTransport,
    makePeer: (callbacks: PeerCallbacks) => AudioPeer,
    options?: { connectWindowMs?: number; retryEveryMs?: number }) {
    this.role = role; this.api = api; this.transport = transport; this.makePeer = makePeer;
    this.connectWindowMs = options?.connectWindowMs ?? CONNECT_WINDOW_MS;
    this.retryEveryMs = options?.retryEveryMs ?? RETRY_EVERY_MS;
    transport.on("IncomingCall", (call: CallSession) => this.receive(call));
    for (const event of ["CallAccepted", "CallRejected", "CallEnded", "CallUpdated"])
      transport.on(event, (call: CallSession) => this.update(call));
    for (const [event, handler] of [
      ["ReceiveOffer", async (m: any) => {
        if (this.role !== "guest" || !this.peer) return;
        const answer = await this.peer.answer(m.sdp);
        if (this.view.call?.id === m.callId && this.peer)
          await transport.invoke("SendAnswer", m.callId, answer);
      }],
      ["ReceiveAnswer", async (m: any) => { if (this.role === "coordinator") await this.peer?.receiveAnswer(m.sdp); }],
      ["ReceiveIceCandidate", async (m: any) => { await this.peer?.addCandidate(m.candidate); }],
    ] as const) {
      transport.on(event, (m: any) => {
        if (this.view.call?.id !== m.callId || !this.peer) return;
        this.messages = this.messages.then(async () => {
          if (this.view.call?.id === m.callId && this.peer) await handler(m);
        }).catch(() => { /* Transient SDP/ICE errors are retried until the connect window ends. */ });
      });
    }
    transport.disconnected(() => {
      this.set({ online: false });
    });
    transport.reconnected(() => {
      this.set({ online: true });
      void this.refresh();
      if (this.view.phase === "connecting") void this.recoverAudio();
    });
  }

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.view;
  private set(patch: Partial<CallView>) {
    this.view = { ...this.view, ...patch };
    this.listeners.forEach(fn => fn());
  }

  async start() {
    this.stopped = false;
    await this.connect();
    if (!this.stopped) this.poll = setInterval(() => void this.refresh(), 3000);
  }

  async handleAppStateChange(next: string, platform: string) {
    if (next === "active") await this.refresh();
    // Browser visibility changes are not hangups. Native calling is still a
    // foreground-only MVP until background audio/foreground services are built.
    else if (next === "background" && platform !== "web") await this.end();
  }

  private async connect() {
    try {
      await this.transport.start();
      if (this.stopped) { await this.transport.stop(); return; }
      this.set({ online: true });
      await this.refresh();
    } catch { this.set({ online: false }); }
  }

  private receive(call: CallSession) {
    if (this.stopped || this.role !== "guest" || call.status !== "ringing" || this.seen.has(call.id)) return;
    if (this.view.busy || (this.view.call && this.view.phase !== "ended")) return;
    this.set({ call, phase: "incoming", error: null, muted: false, connectedAt: null });
  }

  private async prepare() {
    const generation = this.generation;
    const peer = this.makePeer({
      candidate: candidate => {
        const call = this.view.call;
        if (generation === this.generation && call && this.peer)
          void this.transport.invoke("SendIceCandidate", call.id, candidate).catch(() => {});
      },
      state: state => {
        if (generation !== this.generation || !this.peer) return;
        this.lastIce = state;
        if (state === "connected") {
          this.offerFailed = false;
          this.clearConnectWindow();
          this.set({ phase: "connected", connectedAt: this.view.connectedAt ?? Date.now() });
        }
        if (state === "failed" || state === "disconnected" || state === "closed") {
          const wasConnected = this.view.phase === "connected";
          this.set({ phase: "connecting" });
          if (wasConnected) {
            this.clearConnectWindow();
            this.beginConnectWindow("Audio connection was lost.");
          }
          void this.recoverAudio();
        }
      },
      playbackBlocked: () => this.set({ playbackBlocked: true }),
    });
    this.peer = peer;
    const servers = await this.api.iceServers();
    if (generation !== this.generation) return;
    await peer.prepare(servers);
    if (generation !== this.generation) peer.close();
  }

  async call(caseId: string) {
    if (this.view.busy || (this.view.call && this.view.phase !== "ended")) return;
    this.reset();
    this.set({ phase: "preparing", busy: true });
    const generation = this.generation;
    try {
      if (!this.view.online) throw new Error("Calling is offline. Check the backend connection.");
      await this.prepare();
      if (generation !== this.generation) return;
      const call = await this.api.create(caseId);
      if (generation !== this.generation) { await this.api.end(call.id); return; }
      this.set({ call, phase: "ringing" });
      await this.transport.invoke("JoinCall", call.id);
      this.armTimeout(RING_TIMEOUT_MS, "No answer.");
      this.update(await this.api.get(call.id));
    } catch (e) { await this.fail(e); }
    finally { this.set({ busy: false }); }
  }

  async accept() {
    const call = this.view.call;
    if (!call || this.view.busy || this.view.phase !== "incoming") return;
    this.set({ busy: true, error: null });
    const generation = this.generation;
    try {
      await this.prepare();
      if (generation !== this.generation) return;
      // Subscribe before accept: the caller may send its offer immediately.
      await this.transport.invoke("JoinCall", call.id);
      if (generation !== this.generation) return;
      this.update(await this.api.accept(call.id));
    } catch (e) { await this.fail(e); }
    finally { this.set({ busy: false }); }
  }

  private update(call: CallSession) {
    if (this.stopped || call.id !== this.view.call?.id || terminal(this.view.call.status)) return;
    // Delayed accepted/ringing events must not resurrect a finished local call.
    if (this.view.phase === "ended" && !terminal(call.status)) return;
    if (this.view.call.status === "in_progress" && call.status === "ringing") return;
    this.set({ call });
    if (terminal(call.status)) { this.finish(); return; }
    if (call.status === "in_progress" && this.peer) {
      if (this.view.phase !== "connected") {
        if (this.view.phase !== "connecting" && this.deadline) {
          clearTimeout(this.deadline);
          this.deadline = null;
        }
        this.set({ phase: "connecting" });
        this.beginConnectWindow("Could not connect audio. Check your network and try again.");
      }
      if (this.role === "coordinator" && !this.offered) {
        this.offered = true;
        const peer = this.peer;
        void (async () => {
          await this.transport.invoke("JoinCall", call.id);
          const sdp = await peer.offer();
          if (this.peer === peer) await this.transport.invoke("SendOffer", call.id, sdp);
        })().catch(() => {
          this.offerFailed = true;
          void this.recoverAudio();
        });
      }
    }
  }

  async reject() { await this.end(true); }
  async end(reject = false) {
    const call = this.view.call;
    // Background/effect cleanup can run without a call. Keep the modal hidden,
    // but still allow cancellation during preparation before a session exists.
    if (this.view.phase === "idle" && !call && !this.peer) return;
    this.finish(); // Stop microphone immediately, even if the server is unreachable.
    if (!call || terminal(call.status)) return;
    this.set({ busy: true });
    try {
      const next = reject ? await this.api.reject(call.id) : await this.api.end(call.id);
      if (this.view.call?.id === next.id) this.set({ call: next });
    } catch {
      this.pendingEnd = call.id;
      this.set({ error: "Audio stopped. Waiting to synchronize the call status." });
    } finally { this.set({ busy: false }); }
  }

  private async fail(error: unknown) {
    const message = error instanceof Error ? error.message : "Could not connect the call.";
    await this.end();
    this.set({ error: message });
  }

  private armTimeout(ms: number, message: string) {
    if (this.deadline) return;
    this.deadline = setTimeout(() => { this.deadline = null; void this.fail(new Error(message)); }, ms);
  }

  private beginConnectWindow(message: string) {
    this.startConnectRetries();
    this.armTimeout(this.connectWindowMs, message);
  }

  private startConnectRetries() {
    if (this.retryTimer) return;
    this.retryTimer = setInterval(() => {
      if (this.view.phase !== "connecting") return;
      if (this.offerFailed || this.lastIce === "failed" || this.lastIce === "disconnected" || this.lastIce === "closed")
        void this.recoverAudio();
    }, this.retryEveryMs);
  }

  private clearConnectWindow() {
    if (this.retryTimer) clearInterval(this.retryTimer);
    this.retryTimer = null;
    if (this.deadline) clearTimeout(this.deadline);
    this.deadline = null;
  }

  private async recoverAudio() {
    if (this.recovering || this.role !== "coordinator" || !this.peer || !this.view.call) return;
    if (this.view.phase !== "connecting" || !this.view.online) return;
    this.recovering = true;
    const peer = this.peer;
    const call = this.view.call;
    try {
      this.offered = true;
      await this.transport.invoke("JoinCall", call.id);
      const sdp = await peer.offer(true);
      if (this.peer === peer && this.view.call?.id === call.id)
        await this.transport.invoke("SendOffer", call.id, sdp);
      this.offerFailed = false;
    } catch { this.offerFailed = true; }
    finally { this.recovering = false; }
  }

  private finish() {
    const id = this.view.call?.id;
    if (id) {
      this.seen.add(id);
      void this.transport.invoke("LeaveCall", id).catch(() => {});
    }
    this.generation++;
    this.peer?.close(); this.peer = null;
    this.clearConnectWindow();
    this.offered = false;
    this.recovering = false;
    this.offerFailed = false;
    this.lastIce = null;
    this.set({ phase: "ended", playbackBlocked: false });
  }

  private reset() {
    this.generation++;
    this.offered = false;
    this.recovering = false;
    this.offerFailed = false;
    this.lastIce = null;
    this.clearConnectWindow();
    this.set({ call: null, phase: "idle", error: null, connectedAt: null, muted: false, playbackBlocked: false });
  }
  dismiss() { if (this.view.phase === "ended") this.reset(); }
  mute() { const value = !this.view.muted; this.peer?.mute(value); this.set({ muted: value }); }
  async play() {
    try { await this.peer?.play(); this.set({ playbackBlocked: false }); }
    catch { this.set({ error: "Allow audio playback in your browser, then try again." }); }
  }

  async refresh() {
    if (this.stopped || this.refreshing) return;
    this.refreshing = true;
    try {
      if (!this.view.online) {
        await this.transport.start();
        if (this.stopped) return;
        this.set({ online: true });
      }
      if (this.pendingEnd) { await this.api.end(this.pendingEnd); this.pendingEnd = null; }
      const call = this.view.call;
      if (call && !terminal(call.status)) this.update(await this.api.get(call.id));
      if (this.role === "guest" && (!this.view.call || this.view.phase === "ended"))
        for (const incoming of await this.api.incoming()) this.receive(incoming);
    } catch { /* A later poll resynchronizes REST state after transient network errors. */ }
    finally { this.refreshing = false; }
  }

  async stop() {
    this.stopped = true;
    if (this.poll) clearInterval(this.poll);
    this.poll = null;
    await this.end();
    await this.transport.stop();
    this.set({ online: false });
  }
}
