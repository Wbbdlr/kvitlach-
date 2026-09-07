import { describe, expect, it } from "vitest";
import { GameStore, DEFAULT_TURN_SECONDS, MIN_TURN_SECONDS, MAX_TURN_SECONDS } from "../store.js";

function table(bankroll = 400) {
  const store = new GameStore();
  const { room, player: admin } = store.createRoom({ firstName: "Banker", buyIn: 100, bankerBankroll: bankroll });
  const guest = store.joinRoom(room.roomId, { firstName: "P1" });
  return { store, roomId: room.roomId, adminId: admin.id, guestId: guest.player.id };
}

describe("the banker's turn clock", () => {
  it("defaults to 60 seconds and is not stored until it is changed", () => {
    const { store, roomId } = table();
    expect(DEFAULT_TURN_SECONDS).toBe(60);
    expect(store.getRoom(roomId)!.turnSeconds).toBeUndefined();
  });

  it("drives the clock a turn actually gets", () => {
    const { store, roomId, adminId } = table();
    store.setTurnSeconds(roomId, adminId, 30);
    const round = store.startRound(roomId, adminId);
    expect(round.turnTimerDurationMs).toBe(30_000);
  });

  it("uses 60 seconds when the banker never set one", () => {
    const { store, roomId, adminId } = table();
    const round = store.startRound(roomId, adminId);
    expect(round.turnTimerDurationMs).toBe(60_000);
  });

  // Server authority: this is a game rule, so only the banker moves it.
  it("refuses a player who is not the banker", () => {
    const { store, roomId, guestId } = table();
    expect(() => store.setTurnSeconds(roomId, guestId, 30)).toThrow("forbidden");
    expect(store.getRoom(roomId)!.turnSeconds).toBeUndefined();
  });

  it("refuses values outside the bounds rather than clamping into them", () => {
    const { store, roomId, adminId } = table();
    expect(() => store.setTurnSeconds(roomId, adminId, MIN_TURN_SECONDS - 1)).toThrow("invalid_turn_seconds");
    expect(() => store.setTurnSeconds(roomId, adminId, MAX_TURN_SECONDS + 1)).toThrow("invalid_turn_seconds");
    expect(() => store.setTurnSeconds(roomId, adminId, Number.NaN)).toThrow();
    expect(store.getRoom(roomId)!.turnSeconds).toBeUndefined();
  });

  // The clock a seat is already on is theirs. Shortening the limit out from
  // under somebody mid-decision is the force-stand the refill was added to
  // stop, so a change lands on the NEXT turn.
  it("leaves a running clock alone and applies from the next turn", () => {
    const { store, roomId, adminId } = table();
    const round = store.startRound(roomId, adminId);
    const before = round.turnTimerExpiresAt;
    store.setTurnSeconds(roomId, adminId, 300);
    expect(store.getRound(round.roundId)!.turnTimerExpiresAt).toBe(before);
  });
});
