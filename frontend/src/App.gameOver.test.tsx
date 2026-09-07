import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import App from "./App";
import { GameOverSummary } from "./state";

// The regression this file exists for: the export used to read room.roomId,
// room.name and room.players, and room:closed clears all three. Exporting
// from the game-over screen therefore produced a correctly-shaped sheet for a
// table with no name, saved under a filename nobody could place months later.
// Everything here is asserted with `room` undefined, on purpose.

const rounds = [
  {
    roundId: "R1",
    roundNumber: 1,
    completedAt: 10,
    balances: [],
    turns: [
      { player: { id: "bank", firstName: "Zeide", type: "admin" }, state: "lost", bet: -30 },
      { player: { id: "p2", firstName: "Sara", lastName: "K", type: "player" }, state: "won", bet: 30 },
    ],
  },
] as any;

const gameOver: GameOverSummary = {
  roomId: "ROOM1",
  roomName: "Zeide's table",
  playerId: "p2",
  wasBanker: false,
  closedAt: 1000,
  rounds,
  ledger: [],
};

const mockState: { gameOver?: GameOverSummary } = { gameOver };

vi.mock("./state", () => {
  const noop = () => {};
  return {
    loadLastRoomId: () => undefined,
    loadAgeAcknowledged: () => false,
    persistAgeAcknowledged: noop,
    useGameStore: () => ({
      room: undefined,
      round: undefined,
      balances: [],
      playerId: undefined,
      message: undefined,
      status: "connected",
      wsUrl: "ws://localhost:3001",
      // Deliberately empty: after a close this is NOT where the export reads
      // its rounds from any more. If the summary is ignored, the export bails
      // on "no rounds" and the assertions below fail loudly.
      roundHistory: [],
      shoeDiscards: [],
      notifications: [],
      bankerSummaryAt: undefined,
      connections: [],
      reactions: [],
      formErrors: {},
      get gameOver() {
        return mockState.gameOver;
      },
      dismissGameOver: noop,
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
      practiceTopUpBank: noop,
      topUpBanker: noop,
      endRoundDueToBank: noop,
      passBankToPlayer: noop,
      voidAbandonedRound: noop,
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

const { downloadFileMock, buildHistoryHtmlMock, historyFilenameMock } = vi.hoisted(() => ({
  downloadFileMock: vi.fn(),
  buildHistoryHtmlMock: vi.fn(() => "<html></html>"),
  historyFilenameMock: vi.fn(() => "kvitlach.html"),
}));
vi.mock("./exportHistory", () => ({
  downloadFile: downloadFileMock,
  buildHistoryHtml: buildHistoryHtmlMock,
  historyFilename: historyFilenameMock,
}));

vi.mock("./audio", () => ({
  AudioManager: class {
    playTurnAlert() {}
    noteInteraction() {}
    setMusicEnabled() {}
    setSfxEnabled() {}
    playSfx() {}
  },
}));
vi.mock("./ws", () => ({ WSClient: class {} }));

describe("exporting after the table is gone", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockState.gameOver = gameOver;
    downloadFileMock.mockClear();
    buildHistoryHtmlMock.mockClear();
    historyFilenameMock.mockClear();
  });

  it("shows the summary over the lobby once the room is gone", () => {
    render(<App />);
    expect(screen.getByRole("dialog", { name: "Game over" })).toBeTruthy();
  });

  it("builds the whole-night sheet from the summary, not the cleared room", () => {
    render(<App />);
    fireEvent.click(screen.getByText("Save the whole night"));
    expect(downloadFileMock).toHaveBeenCalled();
    expect(buildHistoryHtmlMock).toHaveBeenCalledWith(
      expect.objectContaining({ rounds, roomId: "ROOM1", roomName: "Zeide's table", focusPlayerId: undefined })
    );
  });

  it("names the file after the room, so it is findable later", () => {
    render(<App />);
    fireEvent.click(screen.getByText("Save the whole night"));
    expect(historyFilenameMock).toHaveBeenCalledWith("ROOM1", false, expect.anything(), {
      roomName: "Zeide's table",
      playerName: "",
    });
  });

  // The player's own name has to come off the rounds now: the roster it used
  // to be read from went with the room.
  it("recovers the player's own name for their personal sheet", () => {
    render(<App />);
    fireEvent.click(screen.getByText("Save my results"));
    expect(historyFilenameMock).toHaveBeenCalledWith("ROOM1", true, expect.anything(), {
      roomName: "Zeide's table",
      playerName: "Sara K",
    });
    expect(buildHistoryHtmlMock).toHaveBeenCalledWith(expect.objectContaining({ focusPlayerId: "p2" }));
  });

  it("stays out of the way when there is no summary", () => {
    mockState.gameOver = undefined;
    render(<App />);
    expect(screen.queryByRole("dialog", { name: "Game over" })).toBeNull();
  });
});
