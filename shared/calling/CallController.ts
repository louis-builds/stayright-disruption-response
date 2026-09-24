import { terminal } from "./contracts.ts";
import type { AudioPeer, CallApi, CallSession, CallTransport, CallView, PeerCallbacks } from "./contracts.ts";

// No React/native imports: the same lifecycle runs in both apps and in unit tests.
export class CallController {
  view: CallView = { call: null, phase: "idle", online: false, busy: false, muted: false,
    playbackBlocked: false, error: null, connectedAt: null };
  private listeners = new Set<() => void>();
  private peer: AudioPeer | null = null;
  private stopped = true;
  private generation = 0;
  private offered = false;
  private messages: Promise<void> = Promise.resolve();
  private poll: ReturnType<typeof setInterval> | null = null;
  private deadline: ReturnType<typeof setTimeout> | null = null;
  private refreshing = false;
  private pendingEnd: string | null = null;
  private seen = new Set<string>();
  private api: CallApi;
  private transport: CallTransport;
  private makePeer: (callbacks: PeerCallbacks) => AudioPeer;
  private role: "coordinator" | "guest";

  constructor(role: "coordinator" | "guest", api: CallApi, transport: CallTransport,
    makePeer: (callbacks: PeerCallbacks) => AudioPeer) {
    this.role = role; this.api = api; this.transport = transport; this.makePeer = makePeer;
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
        }).catch(e => this.fail(e));
      });
    }
    transport.disconnected(() => {
      this.set({ online: false });
      if (this.peer) void this.fail(new Error("Connection lost. Please call again."));
    });
    transport.reconnected(() => { this.set({ online: true }); void this.refresh(); });
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
          void this.transport.invoke("SendIceCandidate", call.id, candidate).catch(e => this.fail(e));
      },
      state: state => {
        if (generation !== this.generation || !this.peer) return;
        if (state === "connected") {
          if (this.deadline) clearTimeout(this.deadline);
          this.deadline = null;
          this.set({ phase: "connected", connectedAt: this.view.connectedAt ?? Date.now() });
        }
        if (state === "failed") void this.fail(new Error("Audio connection failed. Check your network and TURN configuration."));
        if (state === "disconnected") {
          this.set({ phase: "connecting" });
          this.armTimeout(15000, "Audio connection was lost.");
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
      this.armTimeout(45000, "No answer.");
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
        this.armTimeout(25000, "Could not connect audio. Check your network and TURN configuration.");
      }
      if (this.role === "coordinator" && !this.offered) {
        this.offered = true;
        const peer = this.peer;
        void (async () => {
          await this.transport.invoke("JoinCall", call.id);
          const sdp = await peer.offer();
          if (this.peer === peer) await this.transport.invoke("SendOffer", call.id, sdp);
        })().catch(e => this.fail(e));
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

  private finish() {
    const id = this.view.call?.id;
    if (id) {
      this.seen.add(id);
      void this.transport.invoke("LeaveCall", id).catch(() => {});
    }
    this.generation++;
    this.peer?.close(); this.peer = null;
    if (this.deadline) clearTimeout(this.deadline);
    this.deadline = null;
    this.set({ phase: "ended", playbackBlocked: false });
  }

  private reset() {
    this.generation++;
    this.offered = false;
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
