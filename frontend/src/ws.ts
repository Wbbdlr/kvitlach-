import { nanoid } from "nanoid/non-secure";
import { ServerEnvelope } from "./types";

export type MessagePayload = Record<string, unknown> | undefined;
export type Listener = (msg: ServerEnvelope) => void;
export type OpenListener = () => void;
export type CloseListener = () => void;
export type ReconnectListener = () => void;
export type ErrorListener = (err: Event) => void;

export class WSClient {
  private socket?: WebSocket;
  private listeners = new Set<Listener>();
  private openListeners = new Set<OpenListener>();
  private closeListeners = new Set<CloseListener>();
  private reconnectListeners = new Set<ReconnectListener>();
  private errorListeners = new Set<ErrorListener>();
  private queue: Array<{ type: string; payload?: MessagePayload; requestId: string }> = [];

  constructor(private url: string) {}

  connect(onReconnect?: ReconnectListener) {
    if (onReconnect) this.reconnectListeners.add(onReconnect);
    try {
      this.socket = new WebSocket(this.url);
    } catch (err) {
      this.closeListeners.forEach((fn) => fn());
      setTimeout(() => {
        this.reconnectListeners.forEach((fn) => fn());
        this.connect();
      }, 1500);
      return;
    }
    this.socket.onopen = () => {
      this.flushQueue();
      this.openListeners.forEach((fn) => fn());
    };
    this.socket.onmessage = (event) => {
      const data = JSON.parse(event.data) as ServerEnvelope;
      this.listeners.forEach((fn) => fn(data));
    };
    this.socket.onerror = (event) => {
      this.errorListeners.forEach((fn) => fn(event));
    };
    this.socket.onclose = () => {
      this.closeListeners.forEach((fn) => fn());
      setTimeout(() => {
        this.reconnectListeners.forEach((fn) => fn());
        this.connect();
      }, 1500);
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
}
