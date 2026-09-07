import { describe, expect, it, vi, beforeEach } from "vitest";

// Rejoining a table you were already at. The store's job here is narrow but
// unforgiving: a refused join has to become a QUESTION rather than a red box,
// a lodged claim must not seat anybody, and the banker's yes has to adopt the
// session it carries exactly as an ordinary join would.
//
// The bug behind all of it, reproduced live: Rivka had $75, tapped Leave,
// rejoined with the same name, and got a SECOND seat with a fresh $100 while
// the $75 sat somewhere nobody could reach.

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

beforeEach(() => {
  MockWebSocket.instances = [];
  (globalThis as any).WebSocket = MockWebSocket as any;
  window.localStorage.clear();
});

async function joinRefusedAsClaimable() {
  vi.resetModules();
  const { useGameStore } = await import("./state");
  useGameStore.getState().init();
  const socket = MockWebSocket.instances[0];
  socket.triggerOpen();

  useGameStore.getState().joinRoom("TBL1", "Rivka", "S", "latkes");
  const join = socket.sent.find((m) => m.type === "room:join");
  expect(join).toBeTruthy();
  socket.onmessage?.({
    data: JSON.stringify({ type: "error", requestId: join!.requestId, error: { message: "seat_claimable" } }),
  });
  return { useGameStore, socket };
}

describe("a join refused because the seat already exists", () => {
  it("becomes a prompt, not a form error", async () => {
    const { useGameStore } = await joinRefusedAsClaimable();
    const state = useGameStore.getState();
    expect(state.seatPrompt).toMatchObject({ roomId: "TBL1", firstName: "Rivka", lastName: "S" });
    // The red box under the Join form would be a dead end: there is nothing
    // the player can type differently to fix this.
    expect(state.formErrors.join).toBeUndefined();
  });

  // The whole reason the attempt is remembered: the player already typed a
  // name and a password and must not be asked for either again.
  it("claims the seat without making the player retype anything", async () => {
    const { useGameStore, socket } = await joinRefusedAsClaimable();
    useGameStore.getState().claimSeat();
    const claim = socket.sent.find((m) => m.type === "room:claim-seat");
    expect(claim!.payload).toMatchObject({ roomId: "TBL1", firstName: "Rivka", lastName: "S", password: "latkes" });
    expect(useGameStore.getState().seatPrompt).toBeUndefined();
  });

  // The other branch. Three cousins called Rivka is the normal case at this
  // table, so "I am a different person" has to be one tap and has to work.
  it("re-sends the join with allowDuplicateName when it is somebody else", async () => {
    const { useGameStore, socket } = await joinRefusedAsClaimable();
    useGameStore.getState().joinAsSomeoneElse();
    const joins = socket.sent.filter((m) => m.type === "room:join");
    expect(joins).toHaveLength(2);
    expect(joins[1].payload.allowDuplicateName).toBe(true);
    expect(joins[1].payload).toMatchObject({ firstName: "Rivka", lastName: "S", password: "latkes" });
  });
});

describe("a lodged claim", () => {
  it("seats nobody until the banker answers", async () => {
    const { useGameStore, socket } = await joinRefusedAsClaimable();
    useGameStore.getState().claimSeat();
    const claim = socket.sent.find((m) => m.type === "room:claim-seat");
    socket.onmessage?.({
      data: JSON.stringify({
        type: "ack",
        requestId: claim!.requestId,
        payload: { claim: { id: "c1" }, wallet: 75, roomId: "TBL1" },
      }),
    });
    const state = useGameStore.getState();
    expect(state.seatClaimPending).toEqual({ roomId: "TBL1", wallet: 75 });
    // This is the assertion that matters: no room, no session, no seat.
    expect(state.room).toBeUndefined();
    expect(state.playerId).toBeUndefined();
  });

  it("adopts the session the banker's approval carries", async () => {
    const { useGameStore, socket } = await joinRefusedAsClaimable();
    socket.onmessage?.({
      data: JSON.stringify({
        type: "seat:claim-approved",
        roomId: "TBL1",
        payload: {
          room: { roomId: "TBL1", players: [], wallets: {}, buyIn: 100, bankerBuyIn: 400, balances: [], completedRounds: 0, renameRequests: [], buyInRequests: [], waitingPlayerIds: [], renameBlockedIds: [], buyInBlockedIds: [] },
          player: { id: "old-seat", firstName: "Rivka", lastName: "S", type: "player", presence: "online" },
          session: { roomId: "TBL1", playerId: "old-seat", token: "tok" },
        },
      }),
    });
    const state = useGameStore.getState();
    // The ORIGINAL player id, which is what carries the original wallet.
    expect(state.playerId).toBe("old-seat");
    expect(state.room?.roomId).toBe("TBL1");
    expect(state.seatClaimPending).toBeUndefined();
    expect(JSON.parse(window.localStorage.getItem("kvitlach.session")!).playerId).toBe("old-seat");
  });

  it("explains a rejection instead of leaving the player waiting", async () => {
    const { useGameStore, socket } = await joinRefusedAsClaimable();
    useGameStore.getState().claimSeat();
    socket.onmessage?.({ data: JSON.stringify({ type: "seat:claim-rejected", roomId: "TBL1", payload: {} }) });
    const state = useGameStore.getState();
    expect(state.seatClaimPending).toBeUndefined();
    expect(state.formErrors.join).toMatch(/did not recognise/i);
    expect(state.room).toBeUndefined();
  });
});
