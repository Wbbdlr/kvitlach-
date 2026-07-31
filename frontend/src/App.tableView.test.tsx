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

// Mutable so individual tests can toggle whether a round is active, or who is
// viewing, without re-declaring the whole vi.mock factory (which Vitest hoists
// per-file).
const mockState: { room?: RoomState; round?: RoundState; playerId: string } = {
  room,
  round,
  playerId: playerAId,
};

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
      get playerId() {
        return mockState.playerId;
      },
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
      createPracticeRoom: noop,
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
      practiceTopUp: noop,
      topUpBanker: noop,
      endRoundDueToBank: noop,
      kickPlayer: noop,
      adjustPlayerBankroll: noop,
      setFeltWatermark: noop,
      reshuffleDeck: noop,
      setFormError: noop,
      sendReaction: noop,
      closeRoom: noop,
      leaveGame: noop,
    }),
  };
});

vi.mock("./audio", () => ({ AudioManager: class { noteInteraction() {} setMusicEnabled() {} setSfxEnabled() {} playSfx() {} } }));
vi.mock("./ws", () => ({ WSClient: class {} }));

// The felt table is the only in-room view -- there is no second (classic
// seat-list) rendering to fall back to, and no flag or URL parameter that can
// opt out of it any more.
describe("the felt table is the only in-room view", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockState.room = room;
    mockState.round = round;
    mockState.playerId = playerAId;
  });

  it("renders the felt table during a live round", () => {
    const { container } = render(<App />);
    expect(container.querySelector(".felt-table")).not.toBeNull();
  });

  it("ignores the retired kvitlach.tableUI opt-out that used to force the classic view", () => {
    window.localStorage.setItem("kvitlach.tableUI", "0");
    const { container } = render(<App />);
    expect(container.querySelector(".felt-table")).not.toBeNull();
  });

  it("stays on the felt table pre-round, showing the roster and a deal prompt instead of a classic lobby screen", () => {
    mockState.round = undefined; // in a room, nothing dealt yet
    const { container, getAllByText, getByText } = render(<App />);
    expect(container.querySelector(".felt-table")).not.toBeNull();
    // "Table ready" appears both on the felt panel and in the dock.
    expect(getAllByText(/Table ready/i).length).toBeGreaterThan(0);
    // Seats come from round.turns, so pre-round the roster stands in for them.
    expect(getByText(/Alice/)).toBeInTheDocument();
    // The viewer is a non-admin here, so they get the waiting message rather
    // than the banker's own deal button.
    expect(getByText(/Waiting for the banker to deal/i)).toBeInTheDocument();
  });

  it("offers the banker a first deal pre-round, and doesn't call a later round the first", () => {
    // A reload BETWEEN rounds comes back with no round object, so pre-round
    // isn't the same as nothing-played-yet.
    mockState.round = undefined;
    mockState.playerId = bankerId;

    const first = render(<App />);
    expect(first.getByText(/Deal the first round/i)).toBeInTheDocument();
    first.unmount();

    mockState.room = { ...room, completedRounds: 4 };
    const later = render(<App />);
    expect(later.queryByText(/Deal the first round/i)).toBeNull();
    expect(later.getByText(/Deal the next round/i)).toBeInTheDocument();
  });

  it("shows the pre-join lobby only when there is no room at all", () => {
    mockState.room = undefined;
    mockState.round = undefined;
    const { container, getByText } = render(<App />);
    expect(container.querySelector(".felt-table")).toBeNull();
    expect(getByText(/Welcome to Kvitlach/i)).toBeInTheDocument();
  });

  it("stays on the felt table with a results banner once a round terminates", () => {
    // The backend never clears room.roundId's corresponding `round` object to
    // undefined after a round ends -- it just flips round.state to "terminate"
    // (a new round object only replaces it once the banker starts the next one).
    mockState.round = { ...round, state: "terminate" };
    const { container, getByText } = render(<App />);
    expect(container.querySelector(".felt-table")).not.toBeNull();
    expect(getByText(/Round complete/i)).toBeInTheDocument();
    expect(getByText(/Waiting for the banker to start the next round/i)).toBeInTheDocument();
  });

  // The futch celebration used to float over the felt, where it covered the
  // banker's own plate and cards -- the one hand everybody wants to see when
  // the bank busts. It lives in the dock now precisely because no seat can
  // reach into a flex child of the dock, however many cards a hand wraps to.
  describe("when the bank futches", () => {
    const bustedBankerTurn: Turn = {
      ...adminTurn,
      state: "lost",
      cards: [
        { name: "10", attributes: { values: [10] } },
        { name: "9", attributes: { values: [9] } },
        { name: "5", attributes: { values: [5] } },
      ],
    };

    beforeEach(() => {
      mockState.round = { ...round, state: "terminate", turns: [playerTurn, bustedBankerTurn] };
    });

    it("announces it in the dock instead of over the felt", () => {
      const { container, getByText } = render(<App />);
      expect(getByText(/THE BANK FUTCHED!/i)).toBeInTheDocument();
      // Inside the dock, not floating on the stage.
      expect(container.querySelector(".k-dock .k-futch-flash")).not.toBeNull();
      expect(container.querySelector(".felt-table .k-futch-flash")).toBeNull();
    });

    it("replaces the Round complete label rather than adding a row to the dock", () => {
      const { container, queryByText } = render(<App />);
      expect(queryByText(/Round complete/i)).toBeNull();
      // Still exactly one status element plus the banker's own prompt.
      expect(container.querySelectorAll(".k-dock .k-futch-flash")).toHaveLength(1);
      expect(container.querySelectorAll(".k-dock .k-banktotal")).toHaveLength(0);
    });

    it("leaves the banker's busted hand on the felt for everyone to read", () => {
      const { container } = render(<App />);
      // 3 cards, all rendered -- nothing is hidden to make room for the banner.
      const seats = container.querySelectorAll(".k-seat");
      const bankerHand = seats[0].querySelector(".k-hand");
      expect(bankerHand?.querySelectorAll("img, .k-cardback")).toHaveLength(3);
      expect(seats[0].querySelector(".k-tag")?.textContent).toMatch(/FUTCHED/i);
    });
  });
});
