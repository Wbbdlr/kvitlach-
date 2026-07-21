import { describe, expect, it, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import App from "./App";
import { Player, RoomState, RoundState, Turn } from "./types";

const bankerId = "admin-1";
const playerAId = "player-a";

const adminPlayer: Player = { id: bankerId, firstName: "Bank", lastName: "", type: "admin", presence: "online" };
const playerA: Player = { id: playerAId, firstName: "Alice", lastName: "", type: "player", presence: "online" };

const adminTurn: Turn = { player: adminPlayer, state: "pending", cards: [{ name: "5", attributes: { values: [5] } }], bet: 0 };
const playerTurn: Turn = { player: playerA, state: "pending", cards: [{ name: "7", attributes: { values: [7] } }], bet: 0 };

const room: RoomState = {
  roomId: "ROOM1",
  buyIn: 100,
  bankerBuyIn: 500,
  wallets: { [bankerId]: 500, [playerAId]: 100 },
  players: [adminPlayer, playerA],
  balances: [],
  completedRounds: 0,
  renameRequests: [],
  buyInRequests: [],
  waitingPlayerIds: [],
  renameBlockedIds: [],
  buyInBlockedIds: [],
};

const round: RoundState = {
  roundId: "R1",
  roomId: "ROOM1",
  deck: [],
  turns: [playerTurn, adminTurn],
  state: "playing",
  roundNumber: 1,
};

// Mutable so individual tests can toggle whether a round is active without
// re-declaring the whole vi.mock factory (which Vitest hoists per-file).
const mockState: { room?: RoomState; round?: RoundState } = { room, round };

vi.mock("./state", () => {
  const noop = () => {};
  return {
    useGameStore: () => ({
      get room() {
        return mockState.room;
      },
      get round() {
        return mockState.round;
      },
      balances: [],
      playerId: playerAId,
      message: undefined,
      status: "connected",
      wsUrl: "ws://localhost:3001",
      roundHistory: [],
      notifications: [],
      bankerSummaryAt: undefined,
      connections: [],
      reactions: [],
      formErrors: {},
      dismissNotification: noop,
      dismissBankerSummary: noop,
      init: noop,
      createRoom: noop,
      joinRoom: noop,
      startRound: noop,
      bet: noop,
      hit: noop,
      stand: noop,
      skip: noop,
      requestRename: noop,
      approveRename: noop,
      rejectRename: noop,
      requestBuyIn: noop,
      approveBuyIn: noop,
      rejectBuyIn: noop,
      topUpBanker: noop,
      endRoundDueToBank: noop,
      kickPlayer: noop,
      adjustPlayerBankroll: noop,
      setFeltWatermark: noop,
      setFormError: noop,
      sendReaction: noop,
      closeRoom: noop,
    }),
  };
});

vi.mock("./audio", () => ({ AudioManager: class { noteInteraction() {} setMusicEnabled() {} setSfxEnabled() {} playSfx() {} } }));
vi.mock("./ws", () => ({ WSClient: class {} }));

describe("table UI feature flag", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockState.room = room;
    mockState.round = round;
  });

  it("renders the existing seat-list UI when the flag is off (default)", () => {
    const { container } = render(<App />);
    expect(container.querySelector(".felt-table")).toBeNull();
  });

  it("renders the new felt-table UI once the flag is turned on and a round is active", () => {
    window.localStorage.setItem("kvitlach.tableUI", "1");
    const { container } = render(<App />);
    expect(container.querySelector(".felt-table")).not.toBeNull();
  });

  it("still shows the old room-management screen (Start round, roster, etc.) pre-round even with the flag on", () => {
    window.localStorage.setItem("kvitlach.tableUI", "1");
    mockState.round = undefined; // in a room, waiting for the banker to start
    const { container, getByText } = render(<App />);
    expect(container.querySelector(".felt-table")).toBeNull();
    expect(getByText(/Waiting for Banker to start the round/i)).toBeInTheDocument();
  });
});
