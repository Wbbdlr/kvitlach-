import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
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
  deckRemaining: 0,
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
    // App reads the remembered room id through state.ts's own guarded helper
    // rather than touching localStorage itself. This mock replaces the whole
    // module, so every export App imports has to be listed here or the render
    // throws at the call site.
    loadLastRoomId: () => undefined,
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
      shoeDiscards: [],
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

// vi.hoisted: vi.mock's factory is hoisted above these imports, so the spy
// it closes over has to be created through here rather than a plain outer
// const, or the factory would run before playSfxMock exists.
const { playSfxMock } = vi.hoisted(() => ({ playSfxMock: vi.fn() }));
vi.mock("./audio", () => ({
  AudioManager: class {
    noteInteraction() {}
    setMusicEnabled() {}
    setSfxEnabled() {}
    playSfx(...args: unknown[]) {
      playSfxMock(...args);
    }
  },
}));
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

  // A practice room's banker is a bot -- isAdmin never fires for the human
  // sitting there, and there is no second human for "waiting for the
  // banker" to be true about. The next round used to deal itself on a fixed
  // timer instead, which cut into the time the human had to read what the
  // round they just played did. Now the felt hands them the SAME button a
  // real banker gets, gated on room.practice rather than isAdmin.
  it("lets the (non-admin) human in a practice room deal the next round themselves", () => {
    mockState.room = { ...room, practice: true };
    mockState.round = { ...round, state: "terminate" };
    mockState.playerId = playerAId; // viewing as the non-admin seat
    const { getByText, queryByText } = render(<App />);
    expect(getByText(/Start next round/i)).toBeInTheDocument();
    expect(queryByText(/Waiting for the banker/i)).toBeNull();
  });

  it("still makes a real (non-practice) non-admin wait for the banker -- the practice gate doesn't leak", () => {
    mockState.room = room; // practice undefined
    mockState.round = { ...round, state: "terminate" };
    mockState.playerId = playerAId;
    const { getByText, queryByText } = render(<App />);
    expect(getByText(/Waiting for the banker to start the next round/i)).toBeInTheDocument();
    expect(queryByText(/Start next round/i)).toBeNull();
  });

  // The futch celebration used to float over the felt, where it covered the
  // banker's own plate and cards -- the one hand everybody wants to see when
  // the bank busts. It lives in the dock now precisely because no seat can
  // reach into a flex child of the dock, however many cards a hand wraps to.
  // Reported from both sides of the same silence: a banker having to go looking
  // for the reshuffle button when the shoe ran dry, and a solo player against
  // the computer with no idea why the game had stopped at all. The shoe
  // emptying blocks the whole table and only one person can clear it, which is
  // the same situation as an emptied bank -- so it gets the same treatment, a
  // prompt on the felt rather than a control in a drawer.
  describe("when the shoe runs out", () => {
    it("prompts the banker to shuffle, without making them find the button", () => {
      mockState.playerId = bankerId;
      const { getByRole, getByText } = render(<App />);
      expect(getByText(/shoe is empty/i)).toBeTruthy();
      // No confirm step: there is nothing to discard, and an "are you sure" on
      // the only available action is another tap between a stuck table and a
      // playable one.
      expect(getByRole("button", { name: /shuffle a fresh shoe/i })).toBeTruthy();
    });

    it("prompts the human in a practice room, whose banker is a bot", () => {
      // isAdmin never fires for them, so gating this on isAdmin alone would
      // leave the one person who CAN fix it looking at somebody else's message.
      mockState.room = { ...room, practice: true };
      mockState.playerId = playerAId;
      const { getByRole } = render(<App />);
      expect(getByRole("button", { name: /shuffle a fresh shoe/i })).toBeTruthy();
    });

    it("tells everyone else what is being waited on, rather than nothing", () => {
      mockState.playerId = playerAId; // ordinary player at a real table
      const { getByText, queryByRole } = render(<App />);
      expect(getByText(/waiting for the banker to shuffle/i)).toBeTruthy();
      expect(queryByRole("button", { name: /shuffle a fresh shoe/i })).toBeNull();
    });

    it("says nothing when the shoe still has cards", () => {
      mockState.round = { ...round, deckRemaining: 12 };
      mockState.playerId = bankerId;
      const { queryByText } = render(<App />);
      expect(queryByText(/shoe is empty/i)).toBeNull();
    });

    it("stays out of the way of the bank-depleted prompt, which shares its spot", () => {
      // Both are centred blocking prompts. An empty bank is the more urgent of
      // the two -- it is the one with money on it -- so it wins the position.
      mockState.playerId = bankerId;
      mockState.round = {
        ...round,
        bankLock: { playerId: playerAId, stage: "decision", exposure: 100 },
      } as typeof round;
      const { queryByText, getByText } = render(<App />);
      expect(getByText(/bank depleted/i)).toBeTruthy();
      expect(queryByText(/shoe is empty/i)).toBeNull();
    });
  });

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

  // The real-table "I'm calling Eleveroon!" moment (Seat.tsx's
  // showEleveroonCall) -- a gold star, independent of whether the player's
  // actual bet/hit cards are still hidden from the rest of the table at this
  // point in the hand.
  //
  // The VIEWER's own copy is asserted against the whole container, not their
  // seat: their identity block moved off the felt into the bottom-left HUD
  // (ViewerHud.tsx), so their seat renders only cards now. These two cases are
  // deliberately location-agnostic -- what matters is that the player can see
  // their own call somewhere, which is exactly what regressed when the plate
  // moved and these tests caught. Other players' marks are still asserted on
  // their seats below, where they still live.
  describe("Eleveroon 'calling it out' indicator", () => {
    const callingTurn: Turn = { ...playerTurn, state: "pending", eleveroonCalled: true };

    it("shows a gold star mark to the player themselves while their turn is live", () => {
      mockState.round = { ...round, turns: [callingTurn, adminTurn] };
      const { container } = render(<App />);
      expect(container.querySelector(".k-elev-mark")).not.toBeNull();
    });

    it("does not show it once the turn is no longer pending -- the card's own badge takes over from there", () => {
      mockState.round = { ...round, turns: [{ ...callingTurn, state: "won" }, adminTurn] };
      const { container } = render(<App />);
      expect(container.querySelector(".k-elev-mark")).toBeNull();
    });

    it("never shows for the banker, even if the field were somehow set on their turn", () => {
      mockState.round = { ...round, turns: [playerTurn, { ...adminTurn, eleveroonCalled: true }] };
      const { container } = render(<App />);
      const bankerSeat = container.querySelectorAll(".k-seat")[0];
      expect(bankerSeat.querySelector(".k-elev-mark")).toBeNull();
    });

    it("does not show it when the flag is off", () => {
      mockState.round = round; // playerTurn carries no eleveroonCalled
      const { container } = render(<App />);
      expect(container.querySelector(".k-elev-mark")).toBeNull();
    });
  });

  // Below the overlap threshold there's nothing to fan out; at/above it,
  // tapping the hand should reveal every card, and tapping away (or the
  // hook's own auto-collapse, covered in handFan.test.ts) should put it back.
  describe("tap-to-fan-out a 4+ card hand", () => {
    const longHandTurn: Turn = {
      ...playerTurn,
      cards: [
        { name: "1", attributes: { values: [1] } },
        { name: "2", attributes: { values: [2], type: "rosier" } },
        { name: "3", attributes: { values: [3] } },
        { name: "4", attributes: { values: [4] } },
      ],
    };

    beforeEach(() => {
      // adminTurn keeps its single card here -- a deliberate contrast so the
      // "not interactive below the threshold" case is covered in the same
      // render, not asserted from a separate fixture.
      mockState.round = { ...round, turns: [longHandTurn, adminTurn] };
    });

    it("is not interactive below the 4-card threshold", () => {
      const { container } = render(<App />);
      const bankerHand = container.querySelectorAll(".k-seat")[0].querySelector(".k-hand");
      expect(bankerHand?.querySelectorAll("img, .k-cardback")).toHaveLength(1);
      expect(bankerHand?.getAttribute("role")).toBeNull();
      fireEvent.click(bankerHand!);
      expect(bankerHand?.classList.contains("is-fanned")).toBe(false);
    });

    it("fans out on tap, marking both the hand and its seat", () => {
      const { container } = render(<App />);
      const playerSeat = [...container.querySelectorAll(".k-seat")].find((s) =>
        s.querySelector(".k-hand")?.querySelectorAll("img, .k-cardback").length === 4
      )!;
      const hand = playerSeat.querySelector(".k-hand")!;
      expect(hand.getAttribute("role")).toBe("button");
      expect(hand.getAttribute("aria-expanded")).toBe("false");

      fireEvent.click(hand);

      expect(hand.classList.contains("is-fanned")).toBe(true);
      expect(hand.getAttribute("aria-expanded")).toBe("true");
      expect(playerSeat.classList.contains("hand-fanned")).toBe(true);
    });

    it("collapses again on a second tap", () => {
      const { container } = render(<App />);
      const hand = [...container.querySelectorAll(".k-hand")].find(
        (h) => h.querySelectorAll("img, .k-cardback").length === 4
      )!;
      fireEvent.click(hand);
      expect(hand.classList.contains("is-fanned")).toBe(true);
      fireEvent.click(hand);
      expect(hand.classList.contains("is-fanned")).toBe(false);
    });

    it("collapses on a tap outside the hand", () => {
      const { container } = render(<App />);
      const hand = [...container.querySelectorAll(".k-hand")].find(
        (h) => h.querySelectorAll("img, .k-cardback").length === 4
      )!;
      fireEvent.click(hand);
      expect(hand.classList.contains("is-fanned")).toBe(true);

      fireEvent.mouseDown(document.body);

      expect(hand.classList.contains("is-fanned")).toBe(false);
    });
  });

  // Was layering "win" underneath natural21 as a workaround for the old
  // card-slide sample not reading as its own moment (see git history) --
  // now that natural21 is a real fanfare (audio.ts), it plays alone.
  describe("natural-21 sound", () => {
    // playerTurn's own bet is 0 -- isPushTurn would read a $0 "win" as a
    // push (see the comment above this block's App.tsx counterpart) and
    // neither sound would fire, which is correct for a real blatt hand but
    // not what this is testing. A real wager is the point here.
    const pendingTurn: Turn = {
      ...playerTurn,
      bet: 25,
      cards: [{ name: "9", attributes: { values: [9] } }],
    };
    // 9 + 12(read as 12) = 21 -- bestTotal's own re-reading of a flexible card.
    const natural21Turn: Turn = {
      ...playerTurn,
      bet: 25,
      state: "won",
      cards: [
        { name: "9", attributes: { values: [9] } },
        { name: "12", attributes: { values: [12, 9, 10] } },
      ],
    };

    beforeEach(() => {
      playSfxMock.mockClear();
    });

    it("plays natural21 (not win) when a hand hits exactly 21 mid-turn", () => {
      mockState.round = { ...round, roundId: "R-nat21", turns: [pendingTurn, adminTurn] };
      const { rerender } = render(<App />);
      playSfxMock.mockClear(); // ignore whatever the initial mount itself fires

      mockState.round = { ...mockState.round, turns: [natural21Turn, adminTurn] };
      rerender(<App />);

      expect(playSfxMock).toHaveBeenCalledWith("natural21");
      expect(playSfxMock).not.toHaveBeenCalledWith("win");
    });

    it("plays only win (not natural21) for an ordinary showdown win", () => {
      const standbyTurn: Turn = { ...playerTurn, bet: 25, state: "standby", cards: pendingTurn.cards };
      const showdownWinTurn: Turn = { ...playerTurn, bet: 25, state: "won", cards: pendingTurn.cards };

      mockState.round = { ...round, roundId: "R-showdown", turns: [standbyTurn, adminTurn] };
      const { rerender } = render(<App />);
      playSfxMock.mockClear();

      mockState.round = { ...mockState.round, turns: [showdownWinTurn, adminTurn] };
      rerender(<App />);

      expect(playSfxMock).toHaveBeenCalledWith("win");
      expect(playSfxMock).not.toHaveBeenCalledWith("natural21");
    });
  });

  // calculateEndState (round.ts) overwrites the admin turn's `bet` with the
  // round's net balance once it resolves, so every read of `bet` on a banker
  // turn means something different than it does on a player's. Both sounds
  // below were driven off that field without checking whose turn it was.
  describe("the banker's repurposed bet field must not drive bet sounds", () => {
    beforeEach(() => {
      playSfxMock.mockClear();
    });

    it("does not clink a chip when the banker's resolved net goes up", () => {
      const settledAdminTurn: Turn = { ...adminTurn, state: "standby", bet: 40 };

      mockState.round = { ...round, roundId: "R-banker-net", turns: [playerTurn, adminTurn] };
      const { rerender } = render(<App />);
      playSfxMock.mockClear();

      mockState.round = { ...mockState.round, turns: [playerTurn, settledAdminTurn] };
      rerender(<App />);

      expect(playSfxMock).not.toHaveBeenCalledWith("chip");
    });

    it("still plays natural21 for a banker 21 on a round that nets exactly $0", () => {
      // bet: 0 here is the resolved net ("broke even"), not a missing wager --
      // the bank never wagers. isPushTurn read it as a push and swallowed this.
      const bankerNatural21: Turn = {
        ...adminTurn,
        state: "won",
        bet: 0,
        cards: [
          { name: "9", attributes: { values: [9] } },
          { name: "12", attributes: { values: [12, 9, 10] } },
        ],
      };

      mockState.round = { ...round, roundId: "R-bank21", turns: [playerTurn, adminTurn] };
      const { rerender } = render(<App />);
      playSfxMock.mockClear();

      mockState.round = { ...mockState.round, turns: [playerTurn, bankerNatural21] };
      rerender(<App />);

      expect(playSfxMock).toHaveBeenCalledWith("natural21");
    });
  });
});
