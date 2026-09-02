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

// state.ts registers a `popstate` listener once per module instantiation
// (correct for a real page load -- one listener, lives for the tab), but
// freshState() re-imports the module many times across this file's tests,
// each adding another listener to this file's one shared jsdom `window`.
// Without cleanup, a later test's window.dispatchEvent(new
// PopStateEvent(...)) would also fire every earlier test's now-stale
// listener (each still closing over its own now-abandoned store instance).
// Track and remove each one after its test.
const popstateListeners: EventListenerOrEventListenerObject[] = [];
const realAddEventListener = window.addEventListener.bind(window);
beforeEach(() => {
  vi.spyOn(window, "addEventListener").mockImplementation((type: string, listener: any, options?: any) => {
    if (type === "popstate") popstateListeners.push(listener);
    return realAddEventListener(type, listener, options);
  });
});
afterEach(() => {
  popstateListeners.forEach((l) => window.removeEventListener("popstate", l));
  popstateListeners.length = 0;
});

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

  describe("URL history (back-button support)", () => {
    function sendRoomAck(socket: MockWebSocket, roomId: string, requestId = "r1") {
      socket.onmessage?.({
        data: JSON.stringify({
          type: "ack",
          requestId,
          payload: {
            room: { roomId, players: [], renameRequests: [], buyInRequests: [] },
            session: { roomId, playerId: "p1", token: "t1" },
          },
        }),
      });
    }

    // jsdom's Location.prototype.reload is also non-configurable -- same
    // workaround as stubLocationAssign above, extended to cover both.
    function stubLocationReloadAndAssign() {
      const original = window.location;
      const reloadSpy = vi.fn();
      const assignSpy = vi.fn();
      Object.defineProperty(window, "location", {
        configurable: true,
        value: { href: original.href, pathname: original.pathname, search: original.search, origin: original.origin, assign: assignSpy, reload: reloadSpy },
      });
      return {
        reloadSpy,
        assignSpy,
        restore: () => Object.defineProperty(window, "location", { configurable: true, value: original }),
      };
    }

    it("pushes a new history entry the first time a room is entered", async () => {
      const useGameStore = await freshState();
      useGameStore.getState().init();
      const socket = MockWebSocket.instances[0];
      socket.triggerOpen();

      const pushSpy = vi.spyOn(window.history, "pushState");
      const replaceSpy = vi.spyOn(window.history, "replaceState");

      sendRoomAck(socket, "ROOMX");

      expect(pushSpy).toHaveBeenCalledTimes(1);
      expect(replaceSpy).not.toHaveBeenCalled();
      expect(window.location.pathname).toBe("/table/ROOMX");
    });

    it("does not push a second entry for the same room (e.g. a reconnect's resume ack)", async () => {
      const useGameStore = await freshState();
      useGameStore.getState().init();
      const socket = MockWebSocket.instances[0];
      socket.triggerOpen();
      sendRoomAck(socket, "ROOMY");

      const pushSpy = vi.spyOn(window.history, "pushState");
      const replaceSpy = vi.spyOn(window.history, "replaceState");

      sendRoomAck(socket, "ROOMY", "r2"); // same room re-confirmed, not a new one

      expect(pushSpy).not.toHaveBeenCalled();
      expect(replaceSpy).toHaveBeenCalledTimes(1);
    });

    it("pushes another entry when a genuinely different room replaces the current one", async () => {
      const useGameStore = await freshState();
      useGameStore.getState().init();
      const socket = MockWebSocket.instances[0];
      socket.triggerOpen();
      sendRoomAck(socket, "ROOMA");

      const pushSpy = vi.spyOn(window.history, "pushState");
      sendRoomAck(socket, "ROOMB", "r2");

      expect(pushSpy).toHaveBeenCalledTimes(1);
      expect(window.location.pathname).toBe("/table/ROOMB");
    });

    it("tears the session down and reloads in place when the browser Back button fires while in a room", async () => {
      const useGameStore = await freshState();
      const { reloadSpy, restore } = stubLocationReloadAndAssign();

      useGameStore.setState({
        room: { roomId: "ROOMZ" } as any,
        session: { roomId: "ROOMZ", playerId: "p1", token: "t1" },
      });
      window.localStorage.setItem(roomKey("ROOMZ"), JSON.stringify({ roomId: "ROOMZ", playerId: "p1", token: "t1", savedAt: Date.now() }));
      window.localStorage.setItem(GENERIC_KEY, JSON.stringify({ roomId: "ROOMZ", playerId: "p1", token: "t1", savedAt: Date.now() }));
      const closeSpy = vi.spyOn(useGameStore.getState().client, "close");

      window.dispatchEvent(new PopStateEvent("popstate"));

      expect(closeSpy).toHaveBeenCalledTimes(1);
      expect(window.localStorage.getItem(roomKey("ROOMZ"))).toBeNull();
      expect(window.localStorage.getItem(GENERIC_KEY)).toBeNull();
      expect(reloadSpy).toHaveBeenCalledTimes(1);
      restore();
    });

    it("does nothing on a popstate with no active room, so ordinary browser back-navigation off the site still works", async () => {
      const useGameStore = await freshState();
      const { reloadSpy, restore } = stubLocationReloadAndAssign();
      const closeSpy = vi.spyOn(useGameStore.getState().client, "close");

      window.dispatchEvent(new PopStateEvent("popstate"));

      expect(reloadSpy).not.toHaveBeenCalled();
      expect(closeSpy).not.toHaveBeenCalled();
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

describe("practice mode", () => {
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

  it("routes a practice-room error to formErrors.practice, not .join -- separate lobby cards now", async () => {
    const useGameStore = await freshState();
    useGameStore.getState().init();
    const socket = MockWebSocket.instances[0];
    socket.triggerOpen();

    useGameStore.getState().createPracticeRoom("Alice");
    const practiceRequestId = socket.sent[socket.sent.length - 1].requestId;

    socket.onmessage?.({
      data: JSON.stringify({ type: "error", requestId: practiceRequestId, error: { message: "practice_capacity" } }),
    });

    expect(useGameStore.getState().formErrors.practice).toBe(
      "Practice tables are full right now. Please try again in a few minutes."
    );
    expect(useGameStore.getState().formErrors.join).toBeUndefined();
  });

  // Practice is one of the three gated actions, but the practice-error branch
  // returns early, so it used to swallow access refusals before they could
  // reach the handler that raises the access-code banner. The player got
  // "Something went wrong. Please try again." and NO field to type a code
  // into -- the button was permanently dead with no way forward. Found on a
  // live table, not by any test.
  it("raises the access-code banner when practice needs a code, rather than a dead error", async () => {
    const useGameStore = await freshState();
    useGameStore.getState().init();
    const socket = MockWebSocket.instances[0];
    socket.triggerOpen();

    useGameStore.getState().createPracticeRoom("Alice");
    const practiceRequestId = socket.sent[socket.sent.length - 1].requestId;

    socket.onmessage?.({
      data: JSON.stringify({ type: "error", requestId: practiceRequestId, error: { message: "invite_required" } }),
    });

    expect(useGameStore.getState().accessCodeRequired).toBe(true);
    expect(useGameStore.getState().formErrors.practice).not.toBe("Something went wrong. Please try again.");
  });

  // A wrong code has to keep the field on screen so it can be corrected.
  it("keeps the access-code banner up when the code entered is wrong", async () => {
    const useGameStore = await freshState();
    useGameStore.getState().init();
    const socket = MockWebSocket.instances[0];
    socket.triggerOpen();

    useGameStore.getState().createPracticeRoom("Alice");
    const requestId = socket.sent[socket.sent.length - 1].requestId;

    socket.onmessage?.({
      data: JSON.stringify({ type: "error", requestId, error: { message: "invalid_invite" } }),
    });

    expect(useGameStore.getState().accessCodeRequired).toBe(true);
  });

  it("sends bot count, buy-in, bank bankroll and deck count together", async () => {
    const useGameStore = await freshState();
    useGameStore.getState().init();
    const socket = MockWebSocket.instances[0];
    socket.triggerOpen();

    useGameStore.getState().createPracticeRoom("Alice", { botCount: 6, buyIn: 200, bankBuyIn: 800, deckCount: 4 });

    const sent = socket.sent[socket.sent.length - 1];
    expect(sent.type).toBe("room:create-practice");
    expect(sent.payload).toEqual({ firstName: "Alice", botCount: 6, buyIn: 200, bankBuyIn: 800, deckCount: 4 });
  });

  it("does not send an empty options object's undefined keys when none are given", async () => {
    const useGameStore = await freshState();
    useGameStore.getState().init();
    const socket = MockWebSocket.instances[0];
    socket.triggerOpen();

    useGameStore.getState().createPracticeRoom("Alice");

    const sent = socket.sent[socket.sent.length - 1];
    expect(sent.payload).toEqual({ firstName: "Alice" });
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
    deckRemaining: 0,
    turns: [],
    state: "playing",
    roundNumber: 1,
  };

  // The banker used to get two near-identical toasts for one mid-round
  // reshuffle: the round:state broadcast (which the whole table sees) plus
  // the ack for their own request. Between rounds there is no broadcast, so
  // the ack toast is the only feedback there and must survive.
  it("does not double-toast the banker when the reshuffle was also broadcast", async () => {
    const useGameStore = await freshState();
    useGameStore.getState().init();
    const socket = MockWebSocket.instances[0];
    socket.triggerOpen();
    useGameStore.setState({
      room: { roomId: "ROOM1", practice: true, wallets: {}, players: [{ id: "p1", firstName: "A", lastName: "", type: "player", presence: "online" }] } as any,
      playerId: "p1",
    });

    useGameStore.getState().reshuffleDeck();
    const req = socket.sent.find((m) => m.type === "room:reshuffle-deck")!;

    // Broadcast lands first (ws-server broadcasts before it acks)...
    socket.onmessage?.({ data: JSON.stringify({ type: "round:state", payload: { ...baseRound, deckReshuffledAt: 4242 } }) });
    // ...then the ack, flagged as already-broadcast.
    socket.onmessage?.({ data: JSON.stringify({ type: "ack", requestId: req.requestId, payload: { broadcastRound: true } }) });

    const texts = useGameStore.getState().notifications.map((n: any) => n.message);
    expect(texts.filter((t: string) => /shuffled in/i.test(t))).toHaveLength(1);
  });

  it("still toasts the banker for a between-rounds reshuffle, which is never broadcast", async () => {
    const useGameStore = await freshState();
    useGameStore.getState().init();
    const socket = MockWebSocket.instances[0];
    socket.triggerOpen();
    useGameStore.setState({
      room: { roomId: "ROOM1", practice: true, wallets: {}, players: [{ id: "p1", firstName: "A", lastName: "", type: "player", presence: "online" }] } as any,
      playerId: "p1",
    });

    useGameStore.getState().reshuffleDeck();
    const req = socket.sent.find((m) => m.type === "room:reshuffle-deck")!;
    socket.onmessage?.({ data: JSON.stringify({ type: "ack", requestId: req.requestId, payload: { broadcastRound: false } }) });

    const texts = useGameStore.getState().notifications.map((n: any) => n.message);
    expect(texts.some((t: string) => t === "Fresh shoe shuffled in.")).toBe(true);
  });

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

  it("auto-dismisses a notification after 15-20 seconds without a manual Dismiss", async () => {
    vi.useFakeTimers();
    try {
      const useGameStore = await freshState();
      useGameStore.getState().init();
      const socket = MockWebSocket.instances[0];
      socket.triggerOpen();

      socket.onmessage?.({
        data: JSON.stringify({ type: "round:state", payload: { ...baseRound, deckReshuffledAt: 1000 } }),
      });
      expect(useGameStore.getState().notifications.some((n) => n.message.includes("Fresh deck shuffled in"))).toBe(true);

      vi.advanceTimersByTime(14999);
      expect(useGameStore.getState().notifications.some((n) => n.message.includes("Fresh deck shuffled in"))).toBe(true);

      vi.advanceTimersByTime(5001); // past 20s total
      expect(useGameStore.getState().notifications.some((n) => n.message.includes("Fresh deck shuffled in"))).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

// 2026-08-27: a practice table was unrecoverable once its shoe ran out. The
// backend has always allowed the one human in a practice room to reshuffle
// (store.ts's reshuffleDeck, covered by practice-mode.test.ts) because that
// room's banker is a BOT with no session -- but this client guard was a bare
// admin check, so the felt's practice-only Reshuffle button never got its
// message off the browser.
describe("reshuffleDeck -- a practice room's human is its deck authority", () => {
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

  async function seatHuman(practice: boolean) {
    const useGameStore = await freshState();
    useGameStore.getState().init();
    const socket = MockWebSocket.instances[0];
    socket.triggerOpen();
    socket.onmessage?.({
      data: JSON.stringify({
        type: "ack",
        requestId: "r1",
        payload: {
          room: {
            roomId: "PRAC1",
            practice,
            // type "player", not "admin" -- in a practice room the admin seat
            // is held by a bot, which is the whole reason this case exists.
            players: [{ id: "human", firstName: "H", lastName: "", type: "player", presence: "online" }],
            renameRequests: [],
            buyInRequests: [],
          },
          session: { roomId: "PRAC1", playerId: "human", token: "t1" },
        },
      }),
    });
    return { useGameStore, socket };
  }

  it("sends room:reshuffle-deck for the human player seated at a practice table", async () => {
    const { useGameStore, socket } = await seatHuman(true);

    useGameStore.getState().reshuffleDeck();

    expect(socket.sent.some((m) => m.type === "room:reshuffle-deck")).toBe(true);
  });

  it("still refuses an ordinary player at a real table", async () => {
    const { useGameStore, socket } = await seatHuman(false);

    useGameStore.getState().reshuffleDeck();

    expect(socket.sent.some((m) => m.type === "room:reshuffle-deck")).toBe(false);
    expect(useGameStore.getState().message).toBe("Only the banker can reshuffle the deck.");
  });
});

// 2026-08-11: "the discard pile should last until the deck is reshuffled" --
// advanceShoeDiscards (state.ts) is what makes that true; DiscardPile/
// DiscardPileModal themselves just render whatever list they're handed (see
// their own test files).
describe("shoe-scoped discard tally", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.pushState({}, "", "/");
    MockWebSocket.instances = [];
    // @ts-expect-error test stub
    global.WebSocket = MockWebSocket;
  });

  const player = { id: "p1", firstName: "Dana", lastName: "", type: "player" as const, presence: "online" as const };
  const card = (n: number) => ({ name: String(n), attributes: { values: [n] } });
  const roundWith = (roundId: string, turns: unknown[], extra: Record<string, unknown> = {}) => ({
    roundId,
    roomId: "ROOM1",
    deckRemaining: 0,
    turns,
    state: "playing",
    roundNumber: 1,
    ...extra,
  });

  it("does not fold anything in on the very first round:state a client ever sees", async () => {
    const useGameStore = await freshState();
    useGameStore.getState().init();
    const socket = MockWebSocket.instances[0];
    socket.triggerOpen();

    socket.onmessage?.({
      data: JSON.stringify({ type: "round:state", payload: roundWith("R1", [{ player, state: "won", cards: [card(7)] }]) }),
    });
    expect(useGameStore.getState().shoeDiscards).toEqual([]);
  });

  it("stays empty across live re-broadcasts of the SAME round", async () => {
    const useGameStore = await freshState();
    useGameStore.getState().init();
    const socket = MockWebSocket.instances[0];
    socket.triggerOpen();

    socket.onmessage?.({
      data: JSON.stringify({ type: "round:state", payload: roundWith("R1", [{ player, state: "won", cards: [card(7)] }]) }),
    });
    // Another player's hand resolving is still the same round, R1 -- nothing
    // gets folded in until R1 itself is REPLACED by a later round.
    socket.onmessage?.({
      data: JSON.stringify({
        type: "round:state",
        payload: roundWith("R1", [
          { player, state: "won", cards: [card(7)] },
          { player, state: "lost", cards: [card(9)] },
        ]),
      }),
    });
    expect(useGameStore.getState().shoeDiscards).toEqual([]);
  });

  it("folds a round's resolved cards into the tally once a new round replaces it", async () => {
    const useGameStore = await freshState();
    useGameStore.getState().init();
    const socket = MockWebSocket.instances[0];
    socket.triggerOpen();

    socket.onmessage?.({
      data: JSON.stringify({
        type: "round:state",
        payload: roundWith("R1", [{ player, state: "won", cards: [card(7), card(9)] }]),
      }),
    });
    socket.onmessage?.({ data: JSON.stringify({ type: "round:state", payload: roundWith("R2", []) }) });

    const tally = useGameStore.getState().shoeDiscards;
    expect(tally.map((e) => e.card.name).sort()).toEqual(["7", "9"]);
  });

  it("keeps accumulating across three or more rounds on the same shoe", async () => {
    const useGameStore = await freshState();
    useGameStore.getState().init();
    const socket = MockWebSocket.instances[0];
    socket.triggerOpen();

    socket.onmessage?.({
      data: JSON.stringify({ type: "round:state", payload: roundWith("R1", [{ player, state: "won", cards: [card(7)] }]) }),
    });
    socket.onmessage?.({
      data: JSON.stringify({
        type: "round:state",
        payload: roundWith("R2", [{ player, state: "lost", cards: [card(4), card(10)] }]),
      }),
    });
    socket.onmessage?.({ data: JSON.stringify({ type: "round:state", payload: roundWith("R3", []) }) });

    expect(useGameStore.getState().shoeDiscards).toHaveLength(3);
  });

  it("wipes the tally the moment deckReshuffledAt changes, discarding even the outgoing round's own resolved cards", async () => {
    const useGameStore = await freshState();
    useGameStore.getState().init();
    const socket = MockWebSocket.instances[0];
    socket.triggerOpen();

    socket.onmessage?.({
      data: JSON.stringify({ type: "round:state", payload: roundWith("R1", [{ player, state: "won", cards: [card(7)] }]) }),
    });
    socket.onmessage?.({
      data: JSON.stringify({
        type: "round:state",
        payload: roundWith("R2", [{ player, state: "won", cards: [card(3)] }]),
      }),
    });
    expect(useGameStore.getState().shoeDiscards).toHaveLength(1); // R1's card, folded in when R2 arrived

    // R3 is the first round of a freshly reshuffled shoe -- R2's own already-
    // resolved card must not ride along into the new tally.
    socket.onmessage?.({
      data: JSON.stringify({ type: "round:state", payload: roundWith("R3", [], { deckReshuffledAt: 1000 }) }),
    });
    expect(useGameStore.getState().shoeDiscards).toEqual([]);
  });

  it("clears on room:closed, so a later room doesn't inherit a stale tally", async () => {
    const useGameStore = await freshState();
    useGameStore.getState().init();
    const socket = MockWebSocket.instances[0];
    socket.triggerOpen();

    socket.onmessage?.({
      data: JSON.stringify({ type: "round:state", payload: roundWith("R1", [{ player, state: "won", cards: [card(7)] }]) }),
    });
    socket.onmessage?.({ data: JSON.stringify({ type: "round:state", payload: roundWith("R2", []) }) });
    expect(useGameStore.getState().shoeDiscards).toHaveLength(1);

    socket.onmessage?.({ data: JSON.stringify({ type: "room:closed" }) });
    expect(useGameStore.getState().shoeDiscards).toEqual([]);
  });
});

// A real table hears an Eleveroon save called out loud, whoever it happens
// to -- outcomeNotification above is deliberately scoped to the viewer's OWN
// turn (see its comment), so this is a separate, un-scoped notification.
describe("public Eleveroon notification (whole table, not just the player it happened to)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.pushState({}, "", "/");
    MockWebSocket.instances = [];
    // @ts-expect-error test stub
    global.WebSocket = MockWebSocket;
  });

  const player = { id: "p1", firstName: "Dana", lastName: "", type: "player" as const, presence: "online" as const };
  const admin = { id: "admin1", firstName: "Bank", lastName: "", type: "admin" as const, presence: "online" as const };
  const card = (n: number, extra: Record<string, unknown> = {}) => ({
    name: String(n),
    attributes: { values: [n], ...extra },
  });
  const roundWith = (cards: ReturnType<typeof card>[]) => ({
    roundId: "R1",
    roomId: "ROOM1",
    deckRemaining: 0,
    turns: [
      { player, state: "pending", cards, bet: 5 },
      { player: admin, state: "pending", cards: [card(5)], bet: 0 },
    ],
    state: "playing",
    roundNumber: 1,
  });

  it("announces it to every client the instant a card is newly saved -- not just the player it happened to", async () => {
    const useGameStore = await freshState();
    useGameStore.getState().init();
    const socket = MockWebSocket.instances[0];
    socket.triggerOpen();

    socket.onmessage?.({ data: JSON.stringify({ type: "round:state", payload: roundWith([card(5), card(6)]) }) });
    socket.onmessage?.({
      data: JSON.stringify({
        type: "round:state",
        payload: roundWith([card(5), card(6), card(11, { eleveroonIgnored: true })]),
      }),
    });

    const notifications = useGameStore.getState().notifications;
    expect(notifications.some((n) => n.message.includes("Eleveroon!") && n.message.includes("Dana"))).toBe(true);

    // What the call-out actually means, not just that one fired. The wording
    // shipped as "saved a busting eleven", which reads as the eleven being
    // rescued -- the opposite of the rule. What Eleveroon saves is the PLAYER,
    // from a futch. Nothing else here can catch a message that means the wrong
    // thing while containing all the right words.
    const called = notifications.find((n) => n.message.includes("Eleveroon!"))!;
    expect(called.message).toContain("avoided");
    expect(called.message).not.toContain("saved");
  });

  it("does not fire on the very first round:state a client sees, even carrying an already-ignored card (a mid-round reconnect)", async () => {
    const useGameStore = await freshState();
    useGameStore.getState().init();
    const socket = MockWebSocket.instances[0];
    socket.triggerOpen();

    socket.onmessage?.({
      data: JSON.stringify({
        type: "round:state",
        payload: roundWith([card(5), card(6), card(11, { eleveroonIgnored: true })]),
      }),
    });

    expect(useGameStore.getState().notifications.some((n) => n.message.includes("Eleveroon!"))).toBe(false);
  });

  it("does not repeat on a later, unrelated re-broadcast of the same already-resolved hand", async () => {
    const useGameStore = await freshState();
    useGameStore.getState().init();
    const socket = MockWebSocket.instances[0];
    socket.triggerOpen();

    const cards = [card(5), card(6), card(11, { eleveroonIgnored: true })];
    socket.onmessage?.({ data: JSON.stringify({ type: "round:state", payload: roundWith([card(5), card(6)]) }) });
    socket.onmessage?.({ data: JSON.stringify({ type: "round:state", payload: roundWith(cards) }) });
    const fired = useGameStore.getState().notifications.find((n) => n.message.includes("Eleveroon!"));
    useGameStore.getState().dismissNotification(fired!.id);

    socket.onmessage?.({ data: JSON.stringify({ type: "round:state", payload: roundWith(cards) }) }); // rebroadcast, nothing new

    expect(useGameStore.getState().notifications.some((n) => n.message.includes("Eleveroon!"))).toBe(false);
  });
});

// 2026-08-10 bug hunt: a BANK! redeal overwrites the banker's turn with the
// fresh hand in the same server update that resolves the frame that just
// finished, so no round:state on its own ever carries the discarded frame's
// cards/score. `lastBankFrame` rides alongside that redeal specifically so
// the whole table can be told what happened -- see TASKS.md.
describe("public BANK! frame notification (a redealt frame's discarded outcome)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.pushState({}, "", "/");
    MockWebSocket.instances = [];
    // @ts-expect-error test stub
    global.WebSocket = MockWebSocket;
  });

  const admin = { id: "admin1", firstName: "Bank", lastName: "", type: "admin" as const, presence: "online" as const };
  const card = (n: number) => ({ name: String(n), attributes: { values: [n] } });
  const roundWith = (lastBankFrame?: Record<string, unknown>) => ({
    roundId: "R1",
    roomId: "ROOM1",
    deckRemaining: 0,
    turns: [{ player: admin, state: "pending", cards: [card(2)], bet: 0 }],
    state: "playing",
    roundNumber: 1,
    ...(lastBankFrame ? { lastBankFrame } : {}),
  });

  it("announces a redealt frame's outcome, including the beat/lost record, to the whole table", async () => {
    const useGameStore = await freshState();
    useGameStore.getState().init();
    const socket = MockWebSocket.instances[0];
    socket.triggerOpen();

    socket.onmessage?.({ data: JSON.stringify({ type: "round:state", payload: roundWith() }) });
    socket.onmessage?.({
      data: JSON.stringify({
        type: "round:state",
        payload: roundWith({
          bankerId: admin.id,
          cards: [card(9), card(9)],
          state: "standby",
          busted: false,
          beat: 2,
          lostTo: 0,
          settledAt: 111,
        }),
      }),
    });

    const notification = useGameStore.getState().notifications.find((n) => n.message.includes("Bank showed"));
    expect(notification).toBeDefined();
    expect(notification!.message).toContain("Bank showed 18");
    expect(notification!.message).toContain("beat 2");
    expect(notification!.tone).toBe("info");
  });

  it("uses the Futched/21 headline and error/success tone for a bust or a natural 21", async () => {
    const useGameStore = await freshState();
    useGameStore.getState().init();
    const socket = MockWebSocket.instances[0];
    socket.triggerOpen();

    socket.onmessage?.({ data: JSON.stringify({ type: "round:state", payload: roundWith() }) });
    socket.onmessage?.({
      data: JSON.stringify({
        type: "round:state",
        payload: roundWith({
          bankerId: admin.id,
          cards: [card(10), card(9), card(5)],
          state: "lost",
          busted: true,
          beat: 0,
          lostTo: 1,
          settledAt: 222,
        }),
      }),
    });

    const busted = useGameStore.getState().notifications.find((n) => n.message.includes("Futched"));
    expect(busted).toBeDefined();
    expect(busted!.message).toContain("lost to 1");
    expect(busted!.tone).toBe("error");
  });

  it("does not fire on the very first round:state a client sees, even carrying an already-settled frame (a mid-round reconnect)", async () => {
    const useGameStore = await freshState();
    useGameStore.getState().init();
    const socket = MockWebSocket.instances[0];
    socket.triggerOpen();

    socket.onmessage?.({
      data: JSON.stringify({
        type: "round:state",
        payload: roundWith({ bankerId: admin.id, cards: [card(9), card(9)], state: "standby", beat: 2, lostTo: 0, settledAt: 111 }),
      }),
    });

    expect(useGameStore.getState().notifications.some((n) => n.message.includes("Bank showed"))).toBe(false);
  });

  it("does not repeat on a later re-broadcast of the same frame (settledAt unchanged)", async () => {
    const useGameStore = await freshState();
    useGameStore.getState().init();
    const socket = MockWebSocket.instances[0];
    socket.triggerOpen();

    const frame = { bankerId: admin.id, cards: [card(9), card(9)], state: "standby", beat: 2, lostTo: 0, settledAt: 111 };
    socket.onmessage?.({ data: JSON.stringify({ type: "round:state", payload: roundWith() }) });
    socket.onmessage?.({ data: JSON.stringify({ type: "round:state", payload: roundWith(frame) }) });
    const fired = useGameStore.getState().notifications.find((n) => n.message.includes("Bank showed"));
    useGameStore.getState().dismissNotification(fired!.id);

    socket.onmessage?.({ data: JSON.stringify({ type: "round:state", payload: roundWith(frame) }) }); // same settledAt

    expect(useGameStore.getState().notifications.some((n) => n.message.includes("Bank showed"))).toBe(false);
  });
});

describe("admin watch links", () => {
  // Same setup as the session-lifecycle block above. Not inherited: that
  // beforeEach lives inside its own describe, and without a copy here the
  // socket stub was whatever the previous block happened to leave behind --
  // these tests then asserted against a stale store and failed confusingly.
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

  it("sends room:watch for a ?watch= link instead of resuming or joining", async () => {
    window.history.pushState({}, "", "/table/WATCHME?watch=grant123");

    const useGameStore = await freshState();
    useGameStore.getState().init();
    const socket = MockWebSocket.instances[0];
    socket.triggerOpen();

    // Exactly one message, and not room:resume. Before this existed, onOpen
    // found no session for the /table/ URL, decided it was a stale bookmark
    // and rewrote the address to /?room=WATCHME -- dropping the grant and
    // putting the operator on the lobby's join form.
    expect(socket.sent).toHaveLength(1);
    expect(socket.sent[0]).toMatchObject({
      type: "room:watch",
      payload: { roomId: "WATCHME", token: "grant123" },
    });
    expect(window.location.pathname).toBe("/table/WATCHME");
  });

  it("marks the viewer as watching without storing a session", async () => {
    window.history.pushState({}, "", "/table/WATCHME?watch=grant123");

    const useGameStore = await freshState();
    useGameStore.getState().init();
    const socket = MockWebSocket.instances[0];
    socket.triggerOpen();
    const requestId = socket.sent[0].requestId;

    socket.onmessage?.({
      data: JSON.stringify({
        type: "ack",
        requestId,
        payload: { watching: true, room: { roomId: "WATCHME", players: [], wallets: {} } },
      }),
    });

    const state = useGameStore.getState();
    expect(state.watching).toBe(true);
    expect(state.room?.roomId).toBe("WATCHME");
    // No seat, no identity, nothing persisted: a watcher must not be able to
    // come back later as a player on this browser.
    expect(state.playerId).toBeUndefined();
    expect(state.session).toBeUndefined();
    expect(window.localStorage.getItem(roomKey("WATCHME"))).toBeNull();
  });
});

// The banker acting last is the moment the whole table waits on -- every
// unresolved wager settles against them at once. Until this existed, the only
// signal was a caption inside the dock that covered the futch and nothing else,
// so a bank that simply WON said nothing at all. Reported by a tester as no
// alert coming up when the banker won or futched.
describe("bank outcome notification", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.pushState({}, "", "/");
    MockWebSocket.instances = [];
    // @ts-expect-error test stub
    global.WebSocket = MockWebSocket;
  });

  const card = (values: number[]) => ({ name: values.join("/"), attributes: { values } });

  const round = (banker: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    roundId: "R1",
    roomId: "ROOM1",
    deckRemaining: 10,
    state: "playing",
    roundNumber: 1,
    turns: [
      {
        player: { id: "banker", firstName: "Gabbai", lastName: "", type: "admin", presence: "online" },
        cards: [],
        state: "pending",
        ...banker,
      },
    ],
    ...extra,
  });

  async function connected() {
    const useGameStore = await freshState();
    useGameStore.getState().init();
    const socket = MockWebSocket.instances[0];
    socket.triggerOpen();
    return { useGameStore, socket };
  }

  const send = (socket: any, payload: unknown) =>
    socket.onmessage?.({ data: JSON.stringify({ type: "round:state", payload }) });

  const texts = (useGameStore: any) => useGameStore.getState().notifications.map((n: any) => n.message);

  it("announces a bank futch to the table", async () => {
    const { useGameStore, socket } = await connected();
    useGameStore.setState({ playerId: "p1" });
    // A prevRound to diff against: without one, a client that just connected
    // would replay a finished round as if it had only now happened.
    send(socket, round({}));
    send(socket, round({ cards: [card([10]), card([9]), card([9])], state: "lost", busted: true }));
    expect(texts(useGameStore).some((t: string) => /bank futched/i.test(t))).toBe(true);
  });

  it("announces a bank that simply won, which used to say nothing at all", async () => {
    const { useGameStore, socket } = await connected();
    useGameStore.setState({ playerId: "p1" });
    send(socket, round({}));
    send(socket, round({ cards: [card([10]), card([10])], state: "won" }));
    expect(texts(useGameStore).some((t: string) => /bank stood on 20/i.test(t))).toBe(true);
  });

  it("calls a banker who merely ended down on money LOST, not futched", async () => {
    // A banker's turn also resolves to "lost" when they finish the round down
    // on chips, which is why `busted` is a separate field -- calling that a
    // futch would be wrong on the hand players care most about.
    const { useGameStore, socket } = await connected();
    useGameStore.setState({ playerId: "p1" });
    send(socket, round({}));
    send(socket, round({ cards: [card([10]), card([9])], state: "lost", busted: false }));
    const all = texts(useGameStore).join(" | ");
    expect(all).toMatch(/finished down on the round/i);
    expect(all).not.toMatch(/futched/i);
  });

  it("does not tell the banker twice about their own hand", async () => {
    // Their client already had "You won this hand!" from outcomeNotification.
    // Two toasts saying one thing to one person is the exact duplication the
    // bank-frame path was fixed for once already.
    const { useGameStore, socket } = await connected();
    useGameStore.setState({ playerId: "banker" });
    send(socket, round({}));
    send(socket, round({ cards: [card([10]), card([10])], state: "won" }));
    const all = texts(useGameStore);
    expect(all.some((t: string) => /^you stood on 20 and took the round/i.test(t))).toBe(true);
    expect(all.some((t: string) => /^the bank stood/i.test(t))).toBe(false);
  });

  it("tells the banker what THEY did, not what a wagering player did", async () => {
    // The banker never puts a bet down, so isPushTurn was true for them at the
    // end of every round -- the person the whole table had just settled
    // against was told "Push -- your wager is returned", win, lose or futch.
    const { useGameStore, socket } = await connected();
    useGameStore.setState({ playerId: "banker" });
    send(socket, round({}));
    send(socket, round({ cards: [card([10]), card([9]), card([9])], state: "lost", busted: true }));
    const all = texts(useGameStore).join(" | ");
    expect(all).toMatch(/you futched with 28/i);
    expect(all).not.toMatch(/wager is returned/i);
  });

  it("says it once, not on every later broadcast of the same resolved round", async () => {
    const { useGameStore, socket } = await connected();
    useGameStore.setState({ playerId: "p1" });
    send(socket, round({}));
    const resolved = round({ cards: [card([10]), card([10])], state: "won" });
    send(socket, resolved);
    send(socket, resolved);
    expect(texts(useGameStore).filter((t: string) => /bank stood on 20/i.test(t))).toHaveLength(1);
  });

  it("stays quiet for a client with no previous round to diff against", async () => {
    // Joining, or reconnecting, mid-round. Firing here would replay whatever
    // happened to be sitting on the round as if it had just happened.
    const { useGameStore, socket } = await connected();
    useGameStore.setState({ playerId: "p1" });
    send(socket, round({ cards: [card([10]), card([10])], state: "won" }));
    expect(texts(useGameStore).some((t: string) => /bank stood/i.test(t))).toBe(false);
  });
});

// Everything the store already did on a room:state told a PLAYER what became
// of the request they made. Nothing told the banker one had arrived: it landed
// in room.buyInRequests / renameRequests and sat there until they happened to
// open Manage -- which on a phone is itself inside the collapsed chrome menu.
// From the player's side that is indistinguishable from being ignored.
describe("the banker is told when a request arrives", () => {
  // Each describe in this file clears the shared instance list -- without it
  // MockWebSocket.instances[0] is a socket left over from an earlier describe,
  // wired to a store this test never touches, and every push lands nowhere.
  beforeEach(() => {
    MockWebSocket.instances = [];
    // @ts-expect-error test stub, only the members WSClient touches are implemented
    global.WebSocket = MockWebSocket;
  });

  const banker = { id: "bank", firstName: "Banker", lastName: "", type: "admin", presence: "online" };
  const sara = { id: "p2", firstName: "Sara", lastName: "K", type: "player", presence: "online" };

  const room = (over: Record<string, unknown> = {}) =>
    ({
      roomId: "ROOM1",
      players: [banker, sara],
      wallets: { bank: 500, p2: 100 },
      renameRequests: [],
      buyInRequests: [],
      ...over,
    }) as any;

  async function asBanker() {
    const useGameStore = await freshState();
    useGameStore.getState().init();
    const socket = MockWebSocket.instances[0];
    socket.triggerOpen();
    useGameStore.setState({ room: room(), playerId: banker.id });
    return { useGameStore, socket };
  }

  const push = (socket: MockWebSocket, payload: unknown) =>
    socket.onmessage?.({ data: JSON.stringify({ type: "room:state", payload }) });

  it("names the player and the amount, rather than counting", async () => {
    const { useGameStore, socket } = await asBanker();
    push(socket, room({ buyInRequests: [{ playerId: "p2", amount: 250, requestedAt: 1 }] }));
    const texts = useGameStore.getState().notifications.map((n) => n.message);
    expect(texts).toContain("Sara K is asking for $250 in chips.");
  });

  it("says who wants to be called what", async () => {
    const { useGameStore, socket } = await asBanker();
    push(socket, room({ renameRequests: [{ playerId: "p2", firstName: "Sarah", lastName: "K", requestedAt: 1 }] }));
    const texts = useGameStore.getState().notifications.map((n) => n.message);
    expect(texts).toContain("Sara K wants to be called Sarah K.");
  });

  it("does not re-toast a request that is merely still pending", async () => {
    const { useGameStore, socket } = await asBanker();
    const withRequest = room({ buyInRequests: [{ playerId: "p2", amount: 250, requestedAt: 1 }] });
    push(socket, withRequest);
    // Any other change to the room -- a wallet, a seat, presence -- re-sends
    // the whole room. The pending request rides along on every one of them.
    push(socket, { ...withRequest, wallets: { bank: 500, p2: 90 } });
    const texts = useGameStore.getState().notifications.map((n) => n.message);
    expect(texts.filter((t) => /asking for \$250/.test(t))).toHaveLength(1);
  });

  // The store REPLACES a player's row rather than keeping both, so a second
  // ask after a decline carries the same playerId. Only requestedAt separates
  // them -- and a banker who has just declined someone is exactly who needs to
  // know they asked again.
  it("treats a re-request after a decline as a new arrival", async () => {
    const { useGameStore, socket } = await asBanker();
    push(socket, room({ buyInRequests: [{ playerId: "p2", amount: 250, requestedAt: 1 }] }));
    push(socket, room({ buyInRequests: [] })); // declined
    push(socket, room({ buyInRequests: [{ playerId: "p2", amount: 100, requestedAt: 2 }] }));
    const texts = useGameStore.getState().notifications.map((n) => n.message);
    expect(texts.filter((t) => /asking for/.test(t))).toHaveLength(2);
  });

  // The last link in the chain the menus depend on: QuickRequestDialog calls
  // onRequestBuyIn/onRequestRename, App hands those to the store, and these
  // are what the store actually puts on the wire. ws-protocol.test.ts (backend)
  // picks it up from the other side.
  it("puts a chip request on the wire with the room and a whole-chip amount", async () => {
    const { useGameStore, socket } = await asBanker();
    useGameStore.setState({ playerId: "p2" });
    useGameStore.getState().requestBuyIn(250.4, "Lost last round");
    expect(socket.sent.at(-1)).toMatchObject({
      type: "player:buyin-request",
      payload: { roomId: "ROOM1", amount: 250, note: "Lost last round" },
    });
  });

  it("refuses to send a nonsense amount, and says why", async () => {
    const { useGameStore, socket } = await asBanker();
    useGameStore.setState({ playerId: "p2" });
    const before = socket.sent.length;
    useGameStore.getState().requestBuyIn(0);
    useGameStore.getState().requestBuyIn(Number.NaN);
    expect(socket.sent).toHaveLength(before);
    expect(useGameStore.getState().message).toMatch(/valid amount/i);
  });

  it("puts a rename on the wire trimmed, and refuses an empty first name", async () => {
    const { useGameStore, socket } = await asBanker();
    useGameStore.setState({ playerId: "p2" });
    useGameStore.getState().requestRename("  Shaya  ", "W");
    expect(socket.sent.at(-1)).toMatchObject({
      type: "player:rename-request",
      payload: { roomId: "ROOM1", firstName: "Shaya", lastName: "W" },
    });
    const before = socket.sent.length;
    useGameStore.getState().requestRename("   ");
    expect(socket.sent).toHaveLength(before);
  });

  it("says nothing to an ordinary player about somebody else's request", async () => {
    const useGameStore = await freshState();
    useGameStore.getState().init();
    const socket = MockWebSocket.instances[0];
    socket.triggerOpen();
    useGameStore.setState({ room: room(), playerId: "p3" });
    push(socket, room({ buyInRequests: [{ playerId: "p2", amount: 250, requestedAt: 1 }] }));
    expect(useGameStore.getState().notifications.map((n) => n.message)).toEqual([]);
  });
});
