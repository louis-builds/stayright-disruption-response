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
    const emit = (event, value) => handlers.get(event)?.(structuredClone(value));
    const transport = {
      start: async () => {}, stop: async () => {},
      on: (event, handler) => handlers.set(event, handler),
      reconnected: () => {}, disconnected: cb => { disconnected = cb; },
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
    };
    const controller = new CallController(role, api, transport, callbacks => {
      const peer = {
        closed: false, muted: false, answers: 0, callbacks,
        prepare: options.prepare ?? (async () => {}),
        offer: async () => "offer-sdp",
        answer: async sdp => { assert.equal(sdp, "offer-sdp"); peer.answers++; callbacks.state("connected"); return "answer-sdp"; },
        receiveAnswer: async sdp => { assert.equal(sdp, "answer-sdp"); callbacks.state("connected"); },
        addCandidate: async () => {},
        mute: value => { peer.muted = value; }, play: async () => {},
        close: () => { peer.closed = true; },
      };
      peers.push(peer);
      return peer;
    });
    const result = { controller, emit, groups, log, disconnect: () => disconnected() };
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
    await guest.controller.end();
    assert.equal(caller.controller.view.phase, "ended");
    assert.equal(guest.controller.view.phase, "ended");
    assert.ok(f.peers.every(p => p.closed));
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

test("signaling disconnect stops audio and closes server call", async () => {
  const f = fixture();
  try {
    const caller = f.endpoint("coordinator"), guest = f.endpoint("guest");
    await caller.controller.start(); await guest.controller.start(); await caller.controller.call("case");
    await guest.controller.accept(); await flush();
    caller.disconnect(); await flush();
    assert.equal(caller.controller.view.phase, "ended");
    assert.equal(guest.controller.view.phase, "ended");
    assert.ok(f.peers.every(p => p.closed));
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
