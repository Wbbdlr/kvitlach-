import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useTableData } from "../useTableData";
import { Player, RoomState, RoundState, Turn } from "../../types";

const banker: Player = { id: "banker", firstName: "Bank", lastName: "", type: "admin", presence: "online" };
const p1: Player = { id: "p1", firstName: "P1", lastName: "", type: "player", presence: "online" };
const p2: Player = { id: "p2", firstName: "P2", lastName: "", type: "player", presence: "online" };

function makeRoom(overrides: Partial<RoomState> = {}): RoomState {
  return {
    roomId: "ROOM1",
    buyIn: 100,
    bankerBuyIn: 500,
    wallets: { [banker.id]: 100, [p1.id]: 100, [p2.id]: 100 },
    players: [banker, p1, p2],
    balances: [],
    completedRounds: 0,
    renameRequests: [],
    buyInRequests: [],
    waitingPlayerIds: [],
    renameBlockedIds: [],
    buyInBlockedIds: [],
    ...overrides,
  };
}

function makeTurn(player: Player, overrides: Partial<Turn> = {}): Turn {
  return { player, state: "pending", cards: [], bet: 0, ...overrides };
}

describe("useTableData", () => {
  it("excludes settled turns from bankInfo's outstanding total (the live-settlement fix)", () => {
    const p1Turn = makeTurn(p1, { state: "won", bet: 10, settled: true }); // already paid out live
    const p2Turn = makeTurn(p2, { state: "pending", bet: 0 });
    const bankerTurn = makeTurn(banker);
    const round: RoundState = {
      roundId: "R1",
      roomId: "ROOM1",
      deck: [],
      turns: [p1Turn, p2Turn, bankerTurn],
      state: "playing",
      roundNumber: 1,
    };
    const room = makeRoom({ wallets: { [banker.id]: 90, [p1.id]: 110, [p2.id]: 100 } });

    const { result } = renderHook(() =>
      useTableData({ room, round, playerId: p2.id, reactions: [], nowTs: Date.now(), roundHistory: [] })
    );

    // p1's settled win must NOT count as outstanding against p2's window.
    expect(result.current.bankInfo?.outstanding).toBe(0);
    expect(result.current.bankInfo?.available).toBe(90);
  });

  it("counts an unsettled won/pending turn as outstanding", () => {
    const p1Turn = makeTurn(p1, { state: "won", bet: 10 }); // not yet settled (standby-resolved case)
    const p2Turn = makeTurn(p2, { state: "pending", bet: 0 });
    const bankerTurn = makeTurn(banker);
    const round: RoundState = {
      roundId: "R2",
      roomId: "ROOM1",
      deck: [],
      turns: [p1Turn, p2Turn, bankerTurn],
      state: "playing",
      roundNumber: 1,
    };
    const room = makeRoom({ wallets: { [banker.id]: 100, [p1.id]: 100, [p2.id]: 100 } });

    const { result } = renderHook(() =>
      useTableData({ room, round, playerId: p2.id, reactions: [], nowTs: Date.now(), roundHistory: [] })
    );

    expect(result.current.bankInfo?.outstanding).toBe(10);
    expect(result.current.bankInfo?.available).toBe(90);
  });

  it("picks the most recent reaction per player", () => {
    const room = makeRoom();
    const { result } = renderHook(() =>
      useTableData({
        room,
        round: undefined,
        playerId: p1.id,
        reactions: [
          { playerId: p1.id, emoji: "👍", reactedAt: 100 },
          { playerId: p1.id, emoji: "🔥", reactedAt: 200 },
          { playerId: p2.id, emoji: "😂", reactedAt: 150 },
        ],
        nowTs: Date.now(),
        roundHistory: [],
      })
    );

    expect(result.current.latestReactionByPlayer[p1.id]?.emoji).toBe("🔥");
    expect(result.current.latestReactionByPlayer[p2.id]?.emoji).toBe("😂");
  });

  it("only computes pendingTurns for non-admin turns still pending", () => {
    const p1Turn = makeTurn(p1, { state: "pending" });
    const p2Turn = makeTurn(p2, { state: "standby" });
    const bankerTurn = makeTurn(banker, { state: "pending" });
    const round: RoundState = {
      roundId: "R3",
      roomId: "ROOM1",
      deck: [],
      turns: [p1Turn, p2Turn, bankerTurn],
      state: "playing",
      roundNumber: 1,
    };
    const room = makeRoom();

    const { result } = renderHook(() =>
      useTableData({ room, round, playerId: p1.id, reactions: [], nowTs: Date.now(), roundHistory: [] })
    );

    // pendingTurns includes anyone (incl. the banker) whose turn.state is "pending"
    expect(result.current.pendingTurns.map((t) => t.player.id)).toEqual([p1.id, banker.id]);
  });
});
