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
