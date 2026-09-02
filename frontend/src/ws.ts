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

// How long the page can be hidden before we stop trusting the socket it went
// away with, even if that socket still claims to be OPEN.
//
// Phones do not politely close a WebSocket when you switch apps. Android
// freezes the tab and the connection dies from the server's ping timeout
// minutes later; iOS tears it down and the tab may not learn about it until it
// is foregrounded again. Either way the tab comes back holding a socket in one
// of two states, and both looked identical to a player: genuinely closed, with
// a reconnect timer that was FROZEN alongside the rest of the page and now
// wants up to 15s more before it tries; or half-open -- readyState OPEN over a
// connection the server hung up on long ago, which connect()'s own
// already-open guard then treats as nothing to do, forever.
//
// 45s is chosen against the two things it trades off: shorter starts costing
// desktop users a reconnect for an ordinary alt-tab, and longer leaves the
// half-open case sitting there. A reconnect is one round trip and room:resume
// restores the hand, so the cost of being wrong in this direction is a blink.
const STALE_AFTER_HIDDEN_MS = 45_000;

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
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private hiddenAt?: number;
  private lifecycleBound = false;
  private unbindLifecycle?: () => void;
  // Set by close(), cleared by the next explicit connect(). Without it the
  // lifecycle listeners below would undo a deliberate Leave: close() leaves no
  // socket and no timer, which is indistinguishable from a drop, so the first
  // tab switch afterwards would helpfully reopen the session the player had
  // just walked away from. This is the same guarantee close()'s own comment
  // claims, extended to cover a caller it did not previously have.
  private closedDeliberately = false;

  constructor(private url: string) {}

  // Reconnect NOW rather than whenever the backoff happens to come due.
  //
  // Everything in here already worked for the case it was written for -- a
  // network blip while someone is looking at the table. It did not work for
  // the case players actually hit, which is leaving the app and coming back:
  // reported as backgrounding the browser breaking the game outright. The
  // reconnect machinery is not broken so much as asleep, and the backoff it
  // wakes up holding is a measure of how many times it has failed, which after
  // a two-minute phone call says nothing useful about whether the network is
  // there NOW.
  //
  // So the attempt counter is reset, not merely the timer cancelled: coming
  // back to the app is new information about the world, and the next attempt
  // deserves to be immediate rather than inheriting a 15s ceiling earned while
  // the radio was off.
  wake() {
    if (this.closedDeliberately) return;
    const state = this.socket?.readyState;
    // CONNECTING is left alone, not just OPEN. A socket mid-handshake has not
    // had its chance yet, and discarding it to start another recreates exactly
    // the race connect()'s own guard exists to prevent: two sockets competing
    // to resume one session token, where the loser's invalid_session wipes out
    // the winner's just-restored state. Seen as a player who reloaded mid-round
    // coming back with no seat at all -- a browser that fires visibilitychange
    // right after load would land here while the first socket was still
    // opening. If it never completes, the browser errors it and onclose
    // schedules a reconnect, which is the path that should handle it.
    if (state === WebSocket.OPEN || state === WebSocket.CONNECTING) return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.reconnectAttempts = 0;
    // A socket in CLOSING, or one whose close event never got dispatched while
    // the tab was frozen, would block connect()'s guard without ever
    // completing. Drop it and let onOpen's room:resume rebuild the state.
    // (CONNECTING never reaches here -- see the guard above.)
    if (this.socket) this.discardSocket();
    this.reconnectListeners.forEach((fn) => fn());
    this.connect();
  }

  // Detaches a socket without going through close(): close() is the deliberate
  // "the player pressed Leave" path and empties the send queue, which is
  // exactly wrong here -- a queued action from before the drop should still go
  // out on the socket that replaces this one.
  private discardSocket() {
    if (!this.socket) return;
    this.socket.onopen = null;
    this.socket.onmessage = null;
    this.socket.onerror = null;
    this.socket.onclose = null;
    try {
      this.socket.close();
    } catch {
      /* already dead; nothing to do and nothing to report */
    }
    this.socket = undefined;
    this.connecting = false;
  }

  // Bound on connect(), released on close(). In production this client is a
  // module-level singleton that lives as long as the page, so the release path
  // is mostly symmetry -- but a class that reaches out and attaches handlers
  // to a shared document should be able to let go of them again, and without
  // that these listeners outlive every client that ever existed.
  private bindLifecycle() {
    if (this.lifecycleBound || typeof document === "undefined") return;
    this.lifecycleBound = true;

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        this.hiddenAt = Date.now();
        return;
      }
      const away = this.hiddenAt ? Date.now() - this.hiddenAt : 0;
      this.hiddenAt = undefined;
      // A socket that claims OPEN after a long absence has to be treated as
      // suspect rather than trusted -- see STALE_AFTER_HIDDEN_MS. There is no
      // way to ask a half-open WebSocket whether it is real without inventing
      // a protocol-level ping the server does not speak, and the cost of
      // being wrong here is one round trip.
      if (away >= STALE_AFTER_HIDDEN_MS) this.discardSocket();
      this.wake();
    };
    // The radio coming back is the same news as the app coming back, and on a
    // phone the two usually arrive seconds apart in either order.
    const onOnline = () => this.wake();
    // bfcache restore. An open WebSocket makes a page ineligible for bfcache
    // in both Safari and Chrome, so this only ever fires for a page that was
    // frozen with its socket ALREADY closed -- which is precisely the case
    // that comes back with no live connection and no pending timer.
    const onPageShow = (event: Event) => {
      if ((event as PageTransitionEvent).persisted) this.wake();
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    window.addEventListener("pageshow", onPageShow);
    this.unbindLifecycle = () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("pageshow", onPageShow);
      this.unbindLifecycle = undefined;
      this.lifecycleBound = false;
    };
  }

  connect(onReconnect?: ReconnectListener) {
    if (onReconnect) this.reconnectListeners.add(onReconnect);
    this.closedDeliberately = false;
    // Guard against duplicate concurrent sockets (e.g. React StrictMode's dev-only
    // double-invoked effects calling connect() twice in quick succession) — a second
    // live socket would race the first to resume the same session token, and the
    // loser's invalid_session error would wipe out the winner's just-restored state.
    if (this.connecting || this.socket?.readyState === WebSocket.OPEN) return;
    this.bindLifecycle();
    this.connecting = true;
    try {
      this.socket = new WebSocket(this.url);
    } catch (err) {
      this.connecting = false;
      this.closeListeners.forEach((fn) => fn());
      this.scheduleReconnect();
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
      this.scheduleReconnect();
    };
  }

  // Was duplicated inline at both call sites, and neither kept the handle --
  // so close() could not cancel a reconnect that was already counting down.
  // That made an explicit close undoable by a timer: drop the connection,
  // hit Leave during the backoff, and the timer would still fire, flip the UI
  // to "connecting" and reopen a socket the player had just walked away from.
  // state.ts's teardownRoomSession leans on close() to stop exactly that kind
  // of late resume, so the gap defeated the guarantee that comment claims.
  private scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.reconnectListeners.forEach((fn) => fn());
      this.connect();
    }, computeReconnectDelay(this.reconnectAttempts++));
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
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
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
    this.closedDeliberately = true;
    this.hiddenAt = undefined;
    this.unbindLifecycle?.();
  }
}
