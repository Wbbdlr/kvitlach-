import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// A richer mock than ws.test.ts's -- this file needs to inspect what got
// sent (to confirm which session token a resume attempt used) and to fire
// onmessage/onclose the way a real socket eventually would.
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;
  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: (() => void) | null = null;
  sent: Array<{ type: string; payload?: unknown; requestId: string }> = [];

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  triggerOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }
}

const GENERIC_KEY = "kvitlach.session";
const roomKey = (roomId: string) => `kvitlach.session.${roomId}`;

async function freshState() {
  vi.resetModules();
  const mod = await import("./state");
  return mod.useGameStore;
}

// jsdom's Location.prototype.assign is a non-configurable inherited property,
// so vi.spyOn(window.location, "assign") throws "Cannot redefine property".
// Swap the whole location object for a plain stand-in instead.
function stubLocationAssign() {
  const original = window.location;
  const assignSpy = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { href: original.href, pathname: original.pathname, search: original.search, origin: original.origin, assign: assignSpy },
  });
  return {
    assignSpy,
    restore: () => Object.defineProperty(window, "location", { configurable: true, value: original }),
  };
}

describe("state.ts session lifecycle", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.pushState({}, "", "/");
    MockWebSocket.instances = [];
    // @ts-expect-error test stub, only the members WSClient touches are implemented
    global.WebSocket = MockWebSocket;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("clears a stale generic session (>24h) instead of silently auto-resuming into it", async () => {
    const stale = { roomId: "OLD1", playerId: "p1", token: "t1", savedAt: Date.now() - 25 * 60 * 60 * 1000 };
    window.localStorage.setItem(GENERIC_KEY, JSON.stringify(stale));

    const useGameStore = await freshState();

    expect(useGameStore.getState().session).toBeUndefined();
    expect(window.localStorage.getItem(GENERIC_KEY)).toBeNull();
  });

  it("keeps a fresh generic session (<24h) available for auto-resume", async () => {
    const fresh = { roomId: "NEW1", playerId: "p2", token: "t2", savedAt: Date.now() - 60 * 60 * 1000 };
    window.localStorage.setItem(GENERIC_KEY, JSON.stringify(fresh));

    const useGameStore = await freshState();

    expect(useGameStore.getState().session).toEqual(fresh);
  });

  it("keeps a per-room session (10 days old) alive for the ?room= URL path, past the 24h generic window", async () => {
    window.history.pushState({}, "", "/?room=OLDROOM");
    const entry = { roomId: "OLDROOM", playerId: "p3", token: "t3", savedAt: Date.now() - 10 * 24 * 60 * 60 * 1000 };
    window.localStorage.setItem(roomKey("OLDROOM"), JSON.stringify(entry));

    const useGameStore = await freshState();
    useGameStore.getState().init();
    const socket = MockWebSocket.instances[0];
    socket.triggerOpen();

    // Proves loadRoomSession did NOT treat a 10-day-old per-room entry as
    // stale -- this is the exact window the review found had been silently
    // shrunk from 21 days to 24 hours.
    expect(socket.sent).toHaveLength(1);
    expect(socket.sent[0]).toMatchObject({ type: "room:resume", payload: { roomId: "OLDROOM", playerId: "p3", token: "t3" } });
  });

  it("treats a per-room session older than 21 days as stale", async () => {
    window.history.pushState({}, "", "/?room=ANCIENT");
    const entry = { roomId: "ANCIENT", playerId: "p4", token: "t4", savedAt: Date.now() - 22 * 24 * 60 * 60 * 1000 };
    window.localStorage.setItem(roomKey("ANCIENT"), JSON.stringify(entry));

    const useGameStore = await freshState();
    useGameStore.getState().init();
    const socket = MockWebSocket.instances[0];
    socket.triggerOpen();

    // Falls through to priority-2 (no generic session either), so nothing
    // should have been auto-sent for the ancient per-room entry.
    expect(socket.sent).toHaveLength(0);
    expect(window.localStorage.getItem(roomKey("ANCIENT"))).toBeNull();
  });

  describe("leaveGame()", () => {
    it("closes the socket and clears storage before navigating away", async () => {
      const useGameStore = await freshState();
      const { assignSpy, restore } = stubLocationAssign();

      useGameStore.setState({
        room: { roomId: "ROOM1" } as any,
        session: { roomId: "ROOM1", playerId: "p1", token: "t1" },
      });
      window.localStorage.setItem(roomKey("ROOM1"), JSON.stringify({ roomId: "ROOM1", playerId: "p1", token: "t1", savedAt: Date.now() }));
      window.localStorage.setItem(GENERIC_KEY, JSON.stringify({ roomId: "ROOM1", playerId: "p1", token: "t1", savedAt: Date.now() }));

      const closeSpy = vi.spyOn(useGameStore.getState().client, "close");

      useGameStore.getState().leaveGame();

      expect(closeSpy).toHaveBeenCalledTimes(1);
      expect(window.localStorage.getItem(roomKey("ROOM1"))).toBeNull();
      expect(window.localStorage.getItem(GENERIC_KEY)).toBeNull();
      expect(assignSpy).toHaveBeenCalledWith("/");
      restore();
    });

    it("cannot be undone by an in-flight resume ack arriving after close()", async () => {
      const useGameStore = await freshState();
      const { restore } = stubLocationAssign();

      useGameStore.getState().init();
      const socket = MockWebSocket.instances[0];
      socket.triggerOpen();

      useGameStore.getState().leaveGame();

      // An ack for the (now-stale) resume attempt lands after Leave was
      // clicked -- close() must have nulled onmessage, so this must not
      // resurrect the session.
      socket.onmessage?.({
        data: JSON.stringify({ type: "ack", payload: { session: { roomId: "ROOM1", playerId: "p1", token: "t1" } } }),
      });

      expect(useGameStore.getState().session).toBeUndefined();
      expect(window.localStorage.getItem(GENERIC_KEY)).toBeNull();
      restore();
    });
  });
});

describe("state.ts room_not_found handling", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.pushState({}, "", "/");
    MockWebSocket.instances = [];
    // @ts-expect-error test stub
    global.WebSocket = MockWebSocket;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a friendly error on a manually-submitted join to a nonexistent room, instead of swallowing it", async () => {
    const useGameStore = await freshState();
    useGameStore.getState().init();
    const socket = MockWebSocket.instances[0];
    socket.triggerOpen();

    useGameStore.getState().joinRoom("NOPE", "Alice");
    const joinRequestId = socket.sent[socket.sent.length - 1].requestId;

    socket.onmessage?.({
      data: JSON.stringify({ type: "error", requestId: joinRequestId, error: { message: "room_not_found" } }),
    });

    expect(useGameStore.getState().formErrors.join).toBe("Room not found. Check the room ID and try again.");
  });

  it("still silently clears a genuine stale auto-resume's room_not_found", async () => {
    const fresh = { roomId: "GONE", playerId: "p1", token: "t1", savedAt: Date.now() };
    window.localStorage.setItem(GENERIC_KEY, JSON.stringify(fresh));

    const useGameStore = await freshState();
    useGameStore.getState().init();
    const socket = MockWebSocket.instances[0];
    socket.triggerOpen();
    const autoResumeRequestId = socket.sent[socket.sent.length - 1].requestId;

    socket.onmessage?.({
      data: JSON.stringify({ type: "error", requestId: autoResumeRequestId, error: { message: "room_not_found" } }),
    });

    expect(useGameStore.getState().formErrors.join).toBeUndefined();
    expect(useGameStore.getState().session).toBeUndefined();
  });
});

describe("deck reshuffle notification", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.pushState({}, "", "/");
    MockWebSocket.instances = [];
    // @ts-expect-error test stub
    global.WebSocket = MockWebSocket;
  });

  const baseRound = {
    roundId: "R1",
    roomId: "ROOM1",
    deck: [],
    turns: [],
    state: "playing",
    roundNumber: 1,
  };

  it("shows a notification the first time deckReshuffledAt appears on a round:state broadcast", async () => {
    const useGameStore = await freshState();
    useGameStore.getState().init();
    const socket = MockWebSocket.instances[0];
    socket.triggerOpen();

    socket.onmessage?.({
      data: JSON.stringify({ type: "round:state", payload: { ...baseRound, deckReshuffledAt: 1000 } }),
    });

    const notifications = useGameStore.getState().notifications;
    expect(notifications.some((n) => n.message.includes("Fresh deck shuffled in"))).toBe(true);
  });

  it("does not repeat the notification on a later broadcast carrying the same deckReshuffledAt", async () => {
    const useGameStore = await freshState();
    useGameStore.getState().init();
    const socket = MockWebSocket.instances[0];
    socket.triggerOpen();

    socket.onmessage?.({
      data: JSON.stringify({ type: "round:state", payload: { ...baseRound, deckReshuffledAt: 1000 } }),
    });
    useGameStore.getState().dismissNotification(useGameStore.getState().notifications[0].id);

    // A later, unrelated round:state broadcast still carries the SAME deckReshuffledAt --
    // must not re-fire just because the round object was rebroadcast.
    socket.onmessage?.({
      data: JSON.stringify({ type: "round:state", payload: { ...baseRound, deckReshuffledAt: 1000, turns: [{}] } }),
    });

    const notifications = useGameStore.getState().notifications;
    expect(notifications.some((n) => n.message.includes("Fresh deck shuffled in"))).toBe(false);
  });

  it("fires again for a genuinely new, later deckReshuffledAt", async () => {
    const useGameStore = await freshState();
    useGameStore.getState().init();
    const socket = MockWebSocket.instances[0];
    socket.triggerOpen();

    socket.onmessage?.({
      data: JSON.stringify({ type: "round:state", payload: { ...baseRound, deckReshuffledAt: 1000 } }),
    });
    useGameStore.getState().dismissNotification(useGameStore.getState().notifications[0].id);

    socket.onmessage?.({
      data: JSON.stringify({ type: "round:state", payload: { ...baseRound, deckReshuffledAt: 2000 } }),
    });

    const notifications = useGameStore.getState().notifications;
    expect(notifications.some((n) => n.message.includes("Fresh deck shuffled in"))).toBe(true);
  });

  it("does not show a notification when a round:state broadcast has no deckReshuffledAt", async () => {
    const useGameStore = await freshState();
    useGameStore.getState().init();
    const socket = MockWebSocket.instances[0];
    socket.triggerOpen();

    socket.onmessage?.({
      data: JSON.stringify({ type: "round:state", payload: baseRound }),
    });

    const notifications = useGameStore.getState().notifications;
    expect(notifications.some((n) => n.message.includes("Fresh deck shuffled in"))).toBe(false);
  });
});
