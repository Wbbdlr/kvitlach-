import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
