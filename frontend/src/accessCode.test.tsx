import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import App from "./App";
import { errorCopy } from "./errorCopy";

// The lobby's access-code field is the only part of the invite-only flow that
// has no server-side test behind it (access.test.ts covers the rule,
// access-wire.test.ts covers the wiring over a real socket). It is also the
// part with the easiest failure mode: the platform gets locked down, the
// server correctly refuses, and the player is left staring at a form with no
// way to enter the code they were given.
const mockState: {
  accessCodeRequired: boolean;
  accessCode: string;
  formErrors: Record<string, string | undefined>;
} = { accessCodeRequired: false, accessCode: "", formErrors: {} };

const setAccessCode = vi.fn((code: string) => {
  mockState.accessCode = code;
});

vi.mock("./state", () => {
  const noop = () => {};
  return {
    loadLastRoomId: () => undefined,
    useGameStore: () => ({
      room: undefined,
      round: undefined,
      balances: [],
      playerId: undefined,
      message: undefined,
      status: "connected",
      wsUrl: "ws://localhost:3001",
      roundHistory: [],
      shoeDiscards: [],
      notifications: [],
      bankerSummaryAt: undefined,
      connections: [],
      reactions: [],
      get formErrors() {
        return mockState.formErrors;
      },
      get accessCodeRequired() {
        return mockState.accessCodeRequired;
      },
      get accessCode() {
        return mockState.accessCode;
      },
      setAccessCode,
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
      cancelRename: noop,
      blockRename: noop,
      requestBuyIn: noop,
      approveBuyIn: noop,
      rejectBuyIn: noop,
      cancelBuyIn: noop,
      blockBuyIn: noop,
      kickPlayer: noop,
      closeRoom: noop,
      adjustBank: noop,
      topUpBanker: noop,
      topUpPractice: noop,
      setWatermark: noop,
      reshuffleDeck: noop,
      sendReaction: noop,
      bankerEndRound: noop,
      voidAbandonedRound: noop,
      switchAdmin: noop,
      leaveRoom: noop,
      resume: noop,
    }),
  };
});

beforeEach(() => {
  mockState.accessCodeRequired = false;
  mockState.accessCode = "";
  mockState.formErrors = {};
  setAccessCode.mockClear();
});

describe("lobby access code", () => {
  // Not shown by default, on purpose: the access mode is never published to
  // an unauthenticated client, so an always-visible field would be asking
  // every ordinary visitor about a lock that is not there.
  it("is absent until the server asks for one", () => {
    render(<App />);
    expect(screen.queryByLabelText(/access code/i)).not.toBeInTheDocument();
  });

  it("appears once the server has refused for want of a code", () => {
    mockState.accessCodeRequired = true;
    render(<App />);
    expect(screen.getByLabelText(/access code/i)).toBeInTheDocument();
    expect(screen.getByText(/invite-only/i)).toBeInTheDocument();
  });

  it("hands what is typed to the store, which persists it", () => {
    mockState.accessCodeRequired = true;
    render(<App />);
    fireEvent.change(screen.getByLabelText(/access code/i), { target: { value: "Latke" } });
    expect(setAccessCode).toHaveBeenCalledWith("Latke");
  });
});

describe("access error copy", () => {
  // errorCopy falls back to the bare snake_case code, so a missing entry is
  // silent -- the player just sees "invite required".
  it("has real sentences for all three access refusals", () => {
    for (const code of ["locked_down", "invite_required", "invalid_invite"]) {
      const copy = errorCopy(code);
      expect(copy).not.toBe(code.replace(/_/g, " "));
      expect(copy.length).toBeGreaterThan(20);
    }
  });

  // Lockdown never touches a table already in progress, and someone whose
  // friend has just been turned away needs to know that without asking.
  it("says existing games are unaffected where that is the reassurance needed", () => {
    expect(errorCopy("locked_down")).toMatch(/in progress are unaffected/i);
  });
});
