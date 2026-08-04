import { nanoid } from "nanoid/non-secure";
import { ServerEnvelope } from "./types";

export type MessagePayload = Record<string, unknown> | undefined;
export type Listener = (msg: ServerEnvelope) => void;
export type OpenListener = () => void;
export type CloseListener = () => void;
export type ReconnectListener = () => void;
export type ErrorListener = (err: Event) => void;

const BASE_RECONNECT_DELAY_MS = 1500;
const MAX_RECONNECT_DELAY_MS = 15000;

// Doubles per consecutive failed attempt, capped, with +/-20% jitter so a
// pile of clients that dropped together (e.g. a server restart) don't all
// hammer it back open in lockstep. Exported so its bounds/growth can be unit
// tested without depending on real timers or Math.random.
export function computeReconnectDelay(attempt: number, random: () => number = Math.random): number {
  const capped = Math.min(BASE_RECONNECT_DELAY_MS * 2 ** attempt, MAX_RECONNECT_DELAY_MS);
  const jitter = capped * 0.2 * (random() * 2 - 1);
  return Math.max(0, Math.round(capped + jitter));
}

export class WSClient {
  private socket?: WebSocket;
  private connecting = false;
  private reconnectAttempts = 0;
  private listeners = new Set<Listener>();
  private openListeners = new Set<OpenListener>();
  private closeListeners = new Set<CloseListener>();
  private reconnectListeners = new Set<ReconnectListener>();
  private errorListeners = new Set<ErrorListener>();
  private queue: Array<{ type: string; payload?: MessagePayload; requestId: string }> = [];

  constructor(private url: string) {}

  connect(onReconnect?: ReconnectListener) {
    if (onReconnect) this.reconnectListeners.add(onReconnect);
    // Guard against duplicate concurrent sockets (e.g. React StrictMode's dev-only
    // double-invoked effects calling connect() twice in quick succession) — a second
    // live socket would race the first to resume the same session token, and the
    // loser's invalid_session error would wipe out the winner's just-restored state.
    if (this.connecting || this.socket?.readyState === WebSocket.OPEN) return;
    this.connecting = true;
    try {
      this.socket = new WebSocket(this.url);
    } catch (err) {
      this.connecting = false;
      this.closeListeners.forEach((fn) => fn());
      setTimeout(() => {
        this.reconnectListeners.forEach((fn) => fn());
        this.connect();
      }, computeReconnectDelay(this.reconnectAttempts++));
      return;
    }
    this.socket.onopen = () => {
      this.connecting = false;
      this.reconnectAttempts = 0;
      this.flushQueue();
      this.openListeners.forEach((fn) => fn());
    };
    this.socket.onmessage = (event) => {
      // The server (ws-server.ts) only ever sends its own JSON.stringify
      // output, but a proxy/tunnel hiccup or a truncated frame is still a
      // real possibility over a live connection -- the backend guards its
      // own inbound parse the same way (invalid_json), this was the one
      // side that didn't. An uncaught throw here wouldn't crash the tab
      // (browsers just log it), but it WOULD skip calling every listener
      // for that message with no chance to recover -- silently dropping
      // whatever state update it carried instead of just this one message.
      let data: ServerEnvelope;
      try {
        data = JSON.parse(event.data) as ServerEnvelope;
      } catch (err) {
        console.warn("Dropped malformed WS message", err);
        return;
      }
      this.listeners.forEach((fn) => fn(data));
    };
    this.socket.onerror = (event) => {
      this.errorListeners.forEach((fn) => fn(event));
    };
    this.socket.onclose = () => {
      this.connecting = false;
      this.closeListeners.forEach((fn) => fn());
      setTimeout(() => {
        this.reconnectListeners.forEach((fn) => fn());
        this.connect();
      }, computeReconnectDelay(this.reconnectAttempts++));
    };
  }

  onMessage(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onOpen(listener: OpenListener) {
    this.openListeners.add(listener);
    return () => this.openListeners.delete(listener);
  }

  onClose(listener: CloseListener) {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  onReconnect(listener: ReconnectListener) {
    this.reconnectListeners.add(listener);
    return () => this.reconnectListeners.delete(listener);
  }

  onError(listener: ErrorListener) {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  send(type: string, payload?: MessagePayload) {
    const requestId = nanoid(8);
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.queue.push({ type, payload, requestId });
      return requestId;
    }
    this.socket.send(JSON.stringify({ type, payload, requestId }));
    return requestId;
  }

  private flushQueue() {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.queue.forEach(({ type, payload, requestId }) => {
      this.socket!.send(JSON.stringify({ type, payload, requestId }));
    });
    this.queue = [];
  }

  // Deliberate, permanent disconnect (e.g. the user clicked "Leave"), as
  // opposed to a network drop. Nulls the socket's handlers BEFORE closing it
  // so no in-flight message can still reach a listener (event-handler IDL
  // attributes are read at dispatch time, so this reliably wins even against
  // a message already in transit) and so onclose's own auto-reconnect never
  // fires -- both of which would otherwise be able to resurrect a session
  // the caller just deliberately cleared.
  close() {
    this.queue = [];
    if (this.socket) {
      this.socket.onopen = null;
      this.socket.onmessage = null;
      this.socket.onerror = null;
      this.socket.onclose = null;
      this.socket.close();
      this.socket = undefined;
    }
    this.connecting = false;
    this.reconnectAttempts = 0;
  }
}
