import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import App from "./App";

// Minimal stubs for store and WS to mount App without a live backend.
vi.mock("./state", () => {
  const noop = () => {};
  return {
    // App reads the remembered room id through state.ts's own guarded helper
    // rather than touching localStorage itself. This mock replaces the whole
    // module, so every export App imports has to be listed here or the render
    // throws at the call site.
    loadLastRoomId: () => undefined,
    useGameStore: () => ({
      room: undefined,
      round: undefined,
      balances: [],
      playerId: undefined,
      message: undefined,
      status: "disconnected",
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
      setFormError: noop,
    }),
  };
});

// Silence audio in tests
vi.mock("./audio", () => ({ AudioManager: class { noteInteraction() {} setMusicEnabled() {} setSfxEnabled() {} playSfx() {} } }));

// Prevent layout-heavy components from needing actual images
vi.mock("./ws", () => ({ WSClient: class {} }));

// Basic smoke tests

describe("App", () => {
  it("renders welcome in lobby state", () => {
    render(<App />);
    expect(screen.getByText(/Welcome to Kvitlach/i)).toBeInTheDocument();
    expect(screen.getByText(/Join Game/i)).toBeInTheDocument();
  });
});

// Source-level, in the same spirit as errorCopy.test.ts: this is a wiring bug
// that no type and no component test can see. RoomInfoDrawer's own test proves
// it calls onExportHistory(playerId), and it passed the whole time App was
// handing it `() => exportRoundHistoryTxt()` -- a wrapper that type-checks
// (`() => void` IS assignable to `(id?: string) => void`) and silently drops
// the argument. Result: "My results" produced the whole-table sheet, byte for
// byte, for every player, in every release that had the feature.
describe("export wiring", () => {
  const source = readFileSync(join(__dirname, "App.tsx"), "utf8");

  it("passes the export handler by reference, not through an arg-dropping wrapper", () => {
    const handoff = source.match(/onExportHistory=\{([^}]*)\}/);
    expect(handoff, "App no longer passes onExportHistory at all").not.toBeNull();
    expect(handoff![1].trim()).toBe("exportRoundHistoryTxt");
  });

  it("still takes a focus player, so there is something to drop", () => {
    expect(source).toMatch(/const exportRoundHistoryTxt = \(focusPlayerId\?: string\)/);
  });
});
