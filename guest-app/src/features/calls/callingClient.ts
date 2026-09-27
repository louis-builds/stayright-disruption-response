import { HubConnectionBuilder, HubConnectionState, HttpTransportType, LogLevel } from "@microsoft/signalr";
import { CallController } from "../../../../shared/calling/CallController";
import type { CallSession, IceServer } from "../../../../shared/calling/contracts";
import { BASE_URL } from "../../shared/api/client";
import { createAudioPeer } from "./audioPeer";

export function makeCallController(role: "guest" | "coordinator") {
  async function request<T>(path: string, method = "GET", data?: unknown): Promise<T> {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 10000);
    try {
      const response = await fetch(BASE_URL + path, {
        method, credentials: "include", signal: abort.signal,
        headers: { "Content-Type": "application/json" },
        body: data === undefined ? undefined : JSON.stringify(data),
      });
      const body = await response.json();
      if (!response.ok || body.code !== 0) throw new Error(body.message || "Call request failed.");
      return body.data;
    } finally { clearTimeout(timeout); }
  }
  const hub = new HubConnectionBuilder().withUrl(BASE_URL + "/api/hubs/calls", {
    accessTokenFactory: async () => (await request<{ token: string }>("/api/calls/signaling-token", "POST", {})).token,
    transport: HttpTransportType.WebSockets,
  }).configureLogging(LogLevel.Error).withAutomaticReconnect([0, 2000, 5000, 10000]).build();
  let starting: Promise<void> | null = null;
  return new CallController(role, {
    create: caseId => request<CallSession>("/api/cases/" + caseId + "/calls", "POST", { calleeType: "guest" }),
    get: id => request<CallSession>("/api/calls/" + id),
    incoming: () => request<CallSession[]>("/api/calls/incoming"),
    accept: id => request<CallSession>("/api/calls/" + id + "/accept", "POST", {}),
    reject: id => request<CallSession>("/api/calls/" + id + "/reject", "POST", {}),
    end: id => request<CallSession>("/api/calls/" + id + "/end", "POST", {}),
    iceServers: () => request<IceServer[]>("/api/calls/ice-servers"),
  }, {
    start: () => {
      if (starting) return starting;
      if (hub.state !== HubConnectionState.Disconnected) return Promise.resolve();
      starting = hub.start().finally(() => { starting = null; });
      return starting;
    },
    stop: () => hub.stop(),
    invoke: async (method, ...args) => { await hub.invoke(method, ...args); },
    on: (event, callback) => hub.on(event, callback),
    reconnected: callback => hub.onreconnected(callback),
    disconnected: callback => { hub.onreconnecting(callback); hub.onclose(callback); },
  }, createAudioPeer);
}
