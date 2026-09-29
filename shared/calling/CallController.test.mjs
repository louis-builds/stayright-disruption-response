import assert from "node:assert/strict";
import { test } from "node:test";
import { CallController } from "./CallController.ts";

const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
function fixture() {
  let sequence = 0;
  const calls = new Map();
  const endpoints = [];
  const peers = [];
  function endpoint(role, options = {}) {
    const handlers = new Map();
    const groups = new Set();
    const log = [];
    let disconnected;
    let reconnected;
    const emit = (event, value) => handlers.get(event)?.(structuredClone(value));
    const transport = {
      start: async () => {}, stop: async () => {},
      on: (event, handler) => handlers.set(event, handler),
      reconnected: cb => { reconnected = cb; }, disconnected: cb => { disconnected = cb; },
      invoke: async (method, id, payload) => {
        log.push(method);
        if (method === "JoinCall") groups.add(id);
        else if (method === "LeaveCall") groups.delete(id);
        else for (const target of endpoints) {
          if (target !== result && target.groups.has(id)) target.emit(method.replace("Send", "Receive"),
            { callId: id, ...(method === "SendIceCandidate" ? { candidate: payload } : { sdp: payload }) });
        }
      },
    };
    const api = {
      create: async caseId => {
        const call = { id: String(++sequence), caseId, receiverUserId: "guest", calleeType: "guest",
          status: "ringing", startedAt: new Date().toISOString(), answeredAt: null, endedAt: null,
          endedReason: null, durationSeconds: null };
        calls.set(call.id, call);
        for (const endpoint of endpoints) endpoint.emit("IncomingCall", call);
        return structuredClone(call);
      },
      incoming: async () => [...calls.values()].filter(c => c.status === "ringing"),
      get: async id => structuredClone(calls.get(id)),
      iceServers: async () => [],
      accept: async id => {
        log.push("accept");
        const call = calls.get(id);
        assert.equal(call.status, "ringing");
        call.status = "in_progress";
        call.answeredAt = new Date().toISOString();
        for (const endpoint of endpoints) endpoint.emit("CallAccepted", call);
        return structuredClone(call);
      },
      reject: async id => {
        const call = calls.get(id); call.status = "rejected";
        for (const endpoint of endpoints) endpoint.emit("CallRejected", call);
        return structuredClone(call);
      },
      end: async id => {
        const call = calls.get(id);
        if (!["completed", "rejected", "no_answer"].includes(call.status))
          call.status = call.status === "ringing" ? "no_answer" : "completed";
        for (const endpoint of endpoints) endpoint.emit("CallEnded", call);
        return structuredClone(call);
      },
      uploadRecording: async (_id, file) => { log.push("uploadRecording"); log.push(file.fileName); },
    };
    const controller = new CallController(role, api, transport, callbacks => {
      const peer = {
        closed: false, muted: false, answers: 0, offers: 0, lastIceRestart: false, callbacks,
        prepare: options.prepare ?? (async () => {}),
        offer: async (iceRestart = false) => {
          peer.offers++;
          peer.lastIceRestart = !!iceRestart;
          return "offer-sdp";
        },
        answer: async sdp => {
          assert.equal(sdp, "offer-sdp");
          peer.answers++;
          if (!options.holdConnect) callbacks.state("connected");
          return "answer-sdp";
        },
        receiveAnswer: async sdp => {
          assert.equal(sdp, "answer-sdp");
          if (!options.holdConnect) callbacks.state("connected");
        },
        addCandidate: async () => {},
        mute: value => { peer.muted = value; }, play: async () => {},
        startRecording: () => { peer.recording = true; },
        stopRecording: async () => peer.recording
          ? { blob: new Blob(["audio"]), mimeType: "audio/webm", fileName: "call.webm", durationSeconds: 3 }
          : null,
        close: () => { peer.closed = true; },
      };
      peers.push(peer);
      return peer;
    }, { connectWindowMs: options.connectWindowMs, retryEveryMs: options.retryEveryMs });
    const result = { controller, emit, groups, log, disconnect: () => disconnected(), reconnect: () => reconnected?.() };
    endpoints.push(result);
    return result;
  }
  return { endpoint, calls, peers, close: async () => { for (const e of endpoints) await e.controller.stop(); } };
}

for (const role of ["coordinator", "guest"]) {
  test(`${role}: idle background cleanup and connection restart never show call ended`, async () => {
    const f = fixture();
    try {
      const { controller, log } = f.endpoint(role);
      const phases = [];
      controller.subscribe(() => phases.push(controller.view.phase));
      await controller.start();
      await controller.end(); // AppState background event with no call.
      assert.equal(controller.view.phase, "idle");
      assert.equal(controller.view.online, true);
      await controller.stop(); // Effect cleanup with no call.
      assert.equal(controller.view.phase, "idle");
      assert.equal(controller.view.online, false);
      await controller.start();
      assert.equal(controller.view.phase, "idle");
      assert.equal(controller.view.online, true);
      assert.equal(phases.includes("ended"), false);
      assert.equal(controller.view.call, null);
      assert.equal(f.calls.size, 0);
      assert.equal(f.peers.length, 0);
      assert.deepEqual(log, []);
    } finally { await f.close(); }
  });

  test(`${role}: dismissed call stays idle after background cleanup`, async () => {
    const f = fixture();
    try {
      const caller = f.endpoint("coordinator"), guest = f.endpoint("guest");
      await caller.controller.start(); await guest.controller.start();
      await caller.controller.call("case"); await guest.controller.reject();
      const { controller } = role === "coordinator" ? caller : guest;
      assert.equal(controller.view.phase, "ended");
      controller.dismiss();
      await controller.end();
      assert.equal(controller.view.phase, "idle");
      assert.equal(controller.view.call, null);
    } finally { await f.close(); }
  });
}

test("cancelling microphone preparation still closes the peer before a call exists", async () => {
  const f = fixture();
  let ready;
  try {
    const { controller } = f.endpoint("coordinator", {
      prepare: () => new Promise(resolve => { ready = resolve; }),
    });
    await controller.start();
    const pending = controller.call("case"); await flush();
    assert.equal(controller.view.phase, "preparing");
    assert.equal(controller.view.call, null);
    await controller.end();
    assert.equal(controller.view.phase, "ended");
    assert.equal(f.peers[0].closed, true);
    ready(); await pending;
    assert.equal(f.calls.size, 0);
    assert.equal(controller.view.phase, "ended");
  } finally { await f.close(); }
});

test("web: hiding caller while ringing still lets the guest accept", async () => {
  const f = fixture();
  try {
    const caller = f.endpoint("coordinator"), guest = f.endpoint("guest");
    await caller.controller.start(); await guest.controller.start();
    await caller.controller.call("case");
    await caller.controller.handleAppStateChange("background", "web");
    assert.equal(caller.controller.view.phase, "ringing");
    assert.equal(guest.controller.view.phase, "incoming");
    assert.equal(f.calls.values().next().value.status, "ringing");
    await guest.controller.accept(); await flush();
    assert.equal(caller.controller.view.phase, "connected");
    assert.equal(guest.controller.view.phase, "connected");
  } finally { await f.close(); }
});

test("web: hiding either connected page and returning preserves audio", async () => {
  const f = fixture();
  try {
    const caller = f.endpoint("coordinator"), guest = f.endpoint("guest");
    await caller.controller.start(); await guest.controller.start();
    await caller.controller.call("case"); await guest.controller.accept(); await flush();
    for (const endpoint of [caller, guest]) {
      await endpoint.controller.handleAppStateChange("background", "web");
      await endpoint.controller.handleAppStateChange("active", "web");
      assert.equal(endpoint.controller.view.phase, "connected");
    }
    assert.ok(f.peers.every(p => !p.closed));
    assert.equal(f.calls.values().next().value.status, "in_progress");
  } finally { await f.close(); }
});

for (const platform of ["android", "ios"]) {
  test(`${platform}: foreground-only MVP still releases microphone on background`, async () => {
    const f = fixture();
    try {
      const caller = f.endpoint("coordinator"), guest = f.endpoint("guest");
      await caller.controller.start(); await guest.controller.start();
      await caller.controller.call("case"); await guest.controller.accept(); await flush();
      await guest.controller.handleAppStateChange("inactive", platform);
      assert.equal(guest.controller.view.phase, "connected");
      await guest.controller.handleAppStateChange("background", platform);
      await flush();
      assert.equal(guest.controller.view.phase, "ended");
      assert.equal(caller.controller.view.phase, "ended");
      assert.ok(f.peers.every(p => p.closed));
    } finally { await f.close(); }
  });
}

test("two apps: guest joins before accepting; one offer; audio connects; mute and remote end", async () => {
  const f = fixture();
  try {
    const caller = f.endpoint("coordinator"), guest = f.endpoint("guest");
    await caller.controller.start(); await guest.controller.start();
    await caller.controller.call("case");
    assert.equal(guest.controller.view.phase, "incoming");
    await guest.controller.accept(); await flush();
    assert.ok(guest.log.indexOf("JoinCall") < guest.log.indexOf("accept"));
    assert.equal(caller.controller.view.phase, "connected");
    assert.equal(guest.controller.view.phase, "connected");
    assert.equal(caller.log.filter(m => m === "SendOffer").length, 1);
    caller.controller.mute(); assert.equal(f.peers[0].muted, true);
    await guest.controller.end(); await flush();
    assert.equal(caller.controller.view.phase, "ended");
    assert.equal(guest.controller.view.phase, "ended");
    assert.ok(f.peers.every(p => p.closed));
    assert.ok(caller.log.includes("uploadRecording"));
    assert.equal(guest.log.includes("uploadRecording"), false);
  } finally { await f.close(); }
});

test("reject never opens guest microphone and late accept cannot resurrect call", async () => {
  const f = fixture();
  try {
    const caller = f.endpoint("coordinator"), guest = f.endpoint("guest");
    await caller.controller.start(); await guest.controller.start(); await caller.controller.call("case");
    const call = structuredClone(caller.controller.view.call);
    await guest.controller.reject();
    caller.emit("CallAccepted", { ...call, status: "in_progress" });
    assert.equal(caller.controller.view.phase, "ended");
    assert.equal(caller.controller.view.call.status, "rejected");
    assert.equal(f.peers.length, 1);
  } finally { await f.close(); }
});

test("microphone denied creates no server call and releases resources", async () => {
  const f = fixture();
  try {
    const caller = f.endpoint("coordinator", { prepare: async () => { throw new Error("Microphone denied"); } });
    await caller.controller.start(); await caller.controller.call("case");
    assert.equal(f.calls.size, 0);
    assert.equal(caller.controller.view.error, "Microphone denied");
    assert.equal(caller.controller.view.phase, "ended");
    assert.equal(f.peers[0].closed, true);
  } finally { await f.close(); }
});

test("caller cancellation during guest microphone prompt must not accept after prompt resolves", async () => {
  const f = fixture();
  let ready;
  try {
    const caller = f.endpoint("coordinator");
    const guest = f.endpoint("guest", { prepare: () => new Promise(resolve => { ready = resolve; }) });
    await caller.controller.start(); await guest.controller.start(); await caller.controller.call("case");
    const pending = guest.controller.accept(); await flush();
    await caller.controller.end();
    ready(); await pending;
    assert.equal(guest.log.includes("accept"), false);
    assert.equal(guest.controller.view.phase, "ended");
    assert.ok(f.peers.every(p => p.closed));
  } finally { await f.close(); }
});

test("signaling disconnect keeps audio until the caller hangs up", async () => {
  const f = fixture();
  try {
    const caller = f.endpoint("coordinator"), guest = f.endpoint("guest");
    await caller.controller.start(); await guest.controller.start(); await caller.controller.call("case");
    await guest.controller.accept(); await flush();
    caller.disconnect(); await flush();
    assert.equal(caller.log.includes("uploadRecording"), false);
    assert.equal(caller.controller.view.phase, "connected");
    assert.equal(caller.controller.view.online, false);
    assert.equal(guest.controller.view.phase, "connected");
    assert.ok(f.peers.every(p => !p.closed));
    assert.equal(f.calls.values().next().value.status, "in_progress");
    caller.reconnect(); await flush();
    assert.equal(caller.controller.view.online, true);
    assert.equal(caller.controller.view.phase, "connected");
  } finally { await f.close(); }
});

test("ICE failure retries with iceRestart and connects within the window", async () => {
  const f = fixture();
  try {
    const caller = f.endpoint("coordinator", { holdConnect: true });
    const guest = f.endpoint("guest", { holdConnect: true });
    await caller.controller.start(); await guest.controller.start();
    await caller.controller.call("case"); await guest.controller.accept(); await flush();
    assert.equal(caller.controller.view.phase, "connecting");
    assert.equal(caller.log.filter(m => m === "SendOffer").length, 1);
    f.peers[0].callbacks.state("failed"); await flush();
    assert.equal(caller.controller.view.phase, "connecting");
    assert.equal(caller.controller.view.error, null);
    assert.ok(caller.log.filter(m => m === "SendOffer").length >= 2);
    assert.equal(f.peers[0].lastIceRestart, true);
    f.peers[0].callbacks.state("connected");
    f.peers[1].callbacks.state("connected");
    await flush();
    assert.equal(caller.controller.view.phase, "connected");
    assert.equal(guest.controller.view.phase, "connected");
  } finally { await f.close(); }
});

test("call fails only after 30s of unsuccessful audio connect retries", async () => {
  const f = fixture();
  try {
    const caller = f.endpoint("coordinator", { holdConnect: true, connectWindowMs: 30, retryEveryMs: 5 });
    const guest = f.endpoint("guest", { holdConnect: true, connectWindowMs: 30, retryEveryMs: 5 });
    await caller.controller.start(); await guest.controller.start();
    await caller.controller.call("case"); await guest.controller.accept(); await flush();
    assert.equal(caller.controller.view.phase, "connecting");
    f.peers[0].callbacks.state("failed"); await flush();
    assert.equal(caller.controller.view.phase, "connecting");
    await new Promise(resolve => setTimeout(resolve, 15));
    assert.equal(caller.controller.view.phase, "connecting");
    await new Promise(resolve => setTimeout(resolve, 40));
    await flush();
    assert.equal(caller.controller.view.phase, "ended");
    assert.match(caller.controller.view.error, /Could not connect audio/);
    assert.ok(caller.log.filter(m => m === "SendOffer").length >= 2);
  } finally { await f.close(); }
});

test("mid-call ICE drop reconnects without ending the server call", async () => {
  const f = fixture();
  try {
    const caller = f.endpoint("coordinator"), guest = f.endpoint("guest");
    await caller.controller.start(); await guest.controller.start();
    await caller.controller.call("case"); await guest.controller.accept(); await flush();
    assert.equal(caller.controller.view.phase, "connected");
    const offersBefore = caller.log.filter(m => m === "SendOffer").length;
    f.peers[0].callbacks.state("disconnected");
    assert.equal(caller.controller.view.phase, "connecting");
    assert.equal(caller.controller.view.error, null);
    await flush();
    assert.ok(caller.log.filter(m => m === "SendOffer").length > offersBefore);
    assert.equal(f.calls.values().next().value.status, "in_progress");
    assert.equal(caller.controller.view.phase, "connected");
  } finally { await f.close(); }
});

test("guest opening later recovers pending incoming call through REST", async () => {
  const f = fixture();
  try {
    const caller = f.endpoint("coordinator"); await caller.controller.start(); await caller.controller.call("case");
    const guest = f.endpoint("guest"); await guest.controller.start();
    assert.equal(guest.controller.view.phase, "incoming");
  } finally { await f.close(); }
});
