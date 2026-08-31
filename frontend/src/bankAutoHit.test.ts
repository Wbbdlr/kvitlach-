import { describe, expect, it, vi, beforeEach } from "vitest";

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static CONNECTING = 0; static OPEN = 1; static CLOSED = 3;
  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  onclose: (() => void) | null = null;
  sent: Array<{ type: string; payload?: any; requestId: string }> = [];
  constructor(public url: string) { MockWebSocket.instances.push(this); }
  send(d: string) { this.sent.push(JSON.parse(d)); }
  close() { this.readyState = MockWebSocket.CLOSED; this.onclose?.(); }
  triggerOpen() { this.readyState = MockWebSocket.OPEN; this.onopen?.(); }
}

const turn = (state: string, bet: number) => ({
  player: { id: "p1", firstName: "A", lastName: "", type: "player", presence: "online" },
  state, cards: [], bet,
});
const round = (t: any) => ({ roundId: "r1", roomId: "ROOM", state: "active", turns: [t], deckRemaining: 19 });

beforeEach(() => {
  MockWebSocket.instances = [];
  (globalThis as any).WebSocket = MockWebSocket as any;
  window.localStorage.clear();
});

async function bankScenario(ackTurnState: string) {
  vi.resetModules();
  const { useGameStore } = await import("./state");
  useGameStore.getState().init();
  const socket = MockWebSocket.instances[0];
  socket.triggerOpen();
  useGameStore.setState({ playerId: "p1", round: round(turn("pending", 0)) as any });

  useGameStore.getState().bet(100, { bank: true, eleveroon: true });
  const req = socket.sent.find((m) => m.type === "turn:bet")!;

  // ws-server.ts broadcasts round:state BEFORE the ack -- replay that order.
  socket.onmessage?.({ data: JSON.stringify({ type: "round:state", payload: round(turn(ackTurnState, 100)) }) });
  socket.onmessage?.({ data: JSON.stringify({ type: "ack", requestId: req.requestId, payload: { round: round(turn(ackTurnState, 100)) } }) });

  return { socket, hits: socket.sent.filter((m) => m.type === "turn:hit") };
}

describe("BANK! auto-hit is driven off the bet's ack", () => {
  it("deals the follow-up card once the BANK! bet is acked", async () => {
    const { hits } = await bankScenario("pending");
    expect(hits).toHaveLength(1);
    expect(hits[0].payload.eleveroon).toBe(true); // carried from the wager
  });

  it("does NOT hit when the BANK! bet already resolved the hand", async () => {
    const { hits } = await bankScenario("lost");
    expect(hits).toHaveLength(0);
  });

  it("does not attach the auto-hit to a later ordinary bet", async () => {
    vi.resetModules();
    const { useGameStore } = await import("./state");
    useGameStore.getState().init();
    const socket = MockWebSocket.instances[0];
    socket.triggerOpen();
    useGameStore.setState({ playerId: "p1", round: round(turn("pending", 0)) as any });

    useGameStore.getState().bet(5, {});               // plain bet
    const req = socket.sent.find((m) => m.type === "turn:bet")!;
    socket.onmessage?.({ data: JSON.stringify({ type: "ack", requestId: req.requestId, payload: { round: round(turn("pending", 5)) } }) });
    expect(socket.sent.filter((m) => m.type === "turn:hit")).toHaveLength(0);
  });
});

// pendingAction is what stops a double-tap firing the same move twice, but
// nothing except a matching ack/error ever lifted it -- so a reply that never
// arrives on an otherwise-healthy socket locked the player out of bet, hit,
// stand AND skip for the rest of the round, silently.
describe("pendingAction timeout escape hatch", () => {
  it("lifts the lock, and says so, when no reply ever arrives", async () => {
    vi.useFakeTimers();
    try {
      vi.resetModules();
      const { useGameStore } = await import("./state");
      useGameStore.getState().init();
      const socket = MockWebSocket.instances[0];
      socket.triggerOpen();
      useGameStore.setState({ playerId: "p1", round: round(turn("pending", 0)) as any });

      useGameStore.getState().bet(5, {});
      expect(useGameStore.getState().pendingAction?.type).toBe("bet");

      // Still locked well after a normal round trip would have completed.
      vi.advanceTimersByTime(9_000);
      expect(useGameStore.getState().pendingAction).toBeDefined();
      const blocked = socket.sent.length;
      useGameStore.getState().hit({});
      expect(socket.sent.length).toBe(blocked); // the guard is doing its job

      vi.advanceTimersByTime(2_000);
      expect(useGameStore.getState().pendingAction).toBeUndefined();
      expect(useGameStore.getState().message).toContain("try again");

      // ...and the player can actually act again.
      useGameStore.getState().hit({});
      expect(socket.sent.filter((m) => m.type === "turn:hit")).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a stale timer never clears a NEWER action that is still in flight", async () => {
    vi.useFakeTimers();
    try {
      vi.resetModules();
      const { useGameStore } = await import("./state");
      useGameStore.getState().init();
      const socket = MockWebSocket.instances[0];
      socket.triggerOpen();
      useGameStore.setState({ playerId: "p1", round: round(turn("pending", 0)) as any });

      useGameStore.getState().bet(5, {});
      const first = socket.sent.find((m) => m.type === "turn:bet")!;

      // First action is acked at 9s -- one second before its own timer fires.
      vi.advanceTimersByTime(9_000);
      socket.onmessage?.({ data: JSON.stringify({ type: "ack", requestId: first.requestId, payload: { round: round(turn("pending", 5)) } }) });
      expect(useGameStore.getState().pendingAction).toBeUndefined();

      // A second action starts immediately after.
      useGameStore.getState().hit({});
      const second = useGameStore.getState().pendingAction!;
      expect(second.type).toBe("hit");

      // The FIRST request's timer now comes due. It must not touch this one.
      vi.advanceTimersByTime(1_500);
      expect(useGameStore.getState().pendingAction?.requestId).toBe(second.requestId);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not fire the BANK! auto-hit for a wager that timed out", async () => {
    vi.useFakeTimers();
    try {
      vi.resetModules();
      const { useGameStore } = await import("./state");
      useGameStore.getState().init();
      const socket = MockWebSocket.instances[0];
      socket.triggerOpen();
      useGameStore.setState({ playerId: "p1", round: round(turn("pending", 0)) as any });

      useGameStore.getState().bet(100, { bank: true });
      const req = socket.sent.find((m) => m.type === "turn:bet")!;
      vi.advanceTimersByTime(11_000);
      expect(useGameStore.getState().pendingAction).toBeUndefined();

      // A very late ack must not now deal a card for a wager the player was
      // already told did not land.
      socket.onmessage?.({ data: JSON.stringify({ type: "ack", requestId: req.requestId, payload: { round: round(turn("pending", 100)) } }) });
      expect(socket.sent.filter((m) => m.type === "turn:hit")).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
