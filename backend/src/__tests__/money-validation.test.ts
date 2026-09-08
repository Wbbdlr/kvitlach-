import { describe, expect, it } from "vitest";
import { GameStore } from "../store.js";

// Chips are whole and bounded. The real-room paths enforced neither, while
// the practice path (createPracticeRoom) had floored and clamped all along --
// the same asymmetry that keeps showing up here, where the newer code is
// careful and the path it was modelled on never got the same treatment.
describe("money validation", () => {
  it("refuses a table whose buy-in would hand every joiner a negative stack", () => {
    // buyIn was never validated -- only bankerBankroll was -- and joinRoom
    // assigns room.buyIn as each arriving player's wallet. With a valid
    // bankroll alongside it, a negative buyIn sailed through and every player
    // who joined started below zero.
    const store = new GameStore();
    expect(() =>
      store.createRoom({ firstName: "Banker", buyIn: -50, bankerBankroll: 500 }),
    ).toThrow("invalid_buyin");
  });

  it("refuses a zero buy-in the same way", () => {
    const store = new GameStore();
    expect(() => store.createRoom({ firstName: "Banker", buyIn: 0, bankerBankroll: 500 })).toThrow(
      "invalid_buyin",
    );
  });

  it("floors a fractional buy-in rather than seeding wallets with a float", () => {
    // Wallets are plain JS numbers, so a fractional stake compounds IEEE-754
    // error every round until someone's chips read 99.99999999999999.
    const store = new GameStore();
    const { room } = store.createRoom({ firstName: "Banker", buyIn: 100.7, bankerBankroll: 500 });
    expect(store.getRoom(room.roomId)!.buyIn).toBe(100);

    const { player } = store.joinRoom(room.roomId, { firstName: "P1" });
    expect(store.getRoom(room.roomId)!.wallets[player.id]).toBe(100);
    expect(Number.isInteger(store.getRoom(room.roomId)!.wallets[player.id])).toBe(true);
  });

  it("clamps an absurd buy-in instead of letting it reach Infinity on the first addition", () => {
    // Number.isFinite(1e308) is true, but 1e308 + 1e308 is Infinity, and every
    // comparison downstream then silently stops meaning anything.
    const store = new GameStore();
    const { room } = store.createRoom({ firstName: "Banker", buyIn: 1e308, bankerBankroll: 1e308 });
    const stored = store.getRoom(room.roomId)!;
    expect(stored.buyIn).toBe(1_000_000_000);
    expect(Number.isFinite(stored.buyIn * 2)).toBe(true);
  });

  it("still accepts an ordinary table unchanged", () => {
    const store = new GameStore();
    const { room, player } = store.createRoom({ firstName: "Banker", buyIn: 100, bankerBankroll: 500 });
    const stored = store.getRoom(room.roomId)!;
    expect(stored.buyIn).toBe(100);
    expect(stored.wallets[player.id]).toBe(500);
  });

  it("defaults the buy-in when none is given, as before", () => {
    const store = new GameStore();
    const { room } = store.createRoom({ firstName: "Banker" });
    expect(store.getRoom(room.roomId)!.buyIn).toBe(100);
  });

  it("refuses a fractional wager", () => {
    const store = new GameStore();
    const { room, player: admin } = store.createRoom({ firstName: "Banker", buyIn: 100, bankerBankroll: 500 });
    const { player: p1 } = store.joinRoom(room.roomId, { firstName: "P1" });
    const round = store.startRound(room.roomId, admin.id);

    expect(() => store.applyBet(round.roundId, p1.id, 10.5)).toThrow("invalid_bet");
    // And a whole one on the same turn still works, so this rejects the
    // fraction rather than the bet.
    expect(() => store.applyBet(round.roundId, p1.id, 10)).not.toThrow();
  });

  it("refuses a wager that is not a number at all", () => {
    const store = new GameStore();
    const { room, player: admin } = store.createRoom({ firstName: "Banker", buyIn: 100, bankerBankroll: 500 });
    const { player: p1 } = store.joinRoom(room.roomId, { firstName: "P1" });
    const round = store.startRound(room.roomId, admin.id);

    for (const bad of [NaN, Infinity, -Infinity, 0, -5]) {
      expect(() => store.applyBet(round.roundId, p1.id, bad)).toThrow("invalid_bet");
    }
  });

  it("refuses a bet from the banker -- the banker never wagers", () => {
    // Nothing in playBotTurn's own isBanker branch ever calls applyBet on
    // the admin's turn (see that method's comment), but that is bot logic
    // choosing not to, not this method refusing the call. Before this guard
    // a client message with `bet` set during the banker's turn went straight
    // through -- and calculateEndState later overwrites `bet` with the
    // round's signed net, so a stray wager left no trace once the round
    // resolved. Called at round start, before it is even the banker's turn,
    // because the guard has to fire regardless of turn order -- an admin
    // wager sent out of turn is just as unopposed otherwise.
    const store = new GameStore();
    const { room, player: admin } = store.createRoom({ firstName: "Banker", buyIn: 100, bankerBankroll: 500 });
    store.joinRoom(room.roomId, { firstName: "P1" });
    const round = store.startRound(room.roomId, admin.id);

    expect(() => store.applyBet(round.roundId, admin.id, 10)).toThrow("forbidden");
  });
});

describe("adjustPlayerWallet -- the one money path that used to skip normalizeMoney", () => {
  // Every other money path in store.ts routes through normalizeMoney (whole
  // chips, bounded by MAX_MONEY, undefined on anything else). This one only
  // ever checked Number.isFinite, so a banker's own bank-adjust could put a
  // wallet into a fractional state -- the exact bug class normalizeMoney
  // exists to close everywhere else. Found in the same security pass as the
  // room:get/round:get and concealed-cards fixes; self-inflicted by an
  // already-trusted role rather than a privilege escalation, but the same
  // class of bug nonetheless.
  it("floors a fractional adjustment instead of leaving the wallet a float forever", () => {
    const store = new GameStore();
    const { room, player: admin } = store.createRoom({ firstName: "Banker", buyIn: 100, bankerBankroll: 500 });
    const { player } = store.joinRoom(room.roomId, { firstName: "P1" });

    const result = store.adjustPlayerWallet(room.roomId, admin.id, player.id, 10.7);
    expect(result.amount).toBe(10);
    expect(store.getRoom(room.roomId)!.wallets[player.id]).toBe(110);
    expect(Number.isInteger(store.getRoom(room.roomId)!.wallets[player.id])).toBe(true);
  });

  it("floors a fractional DEDUCTION the same way, preserving the sign", () => {
    const store = new GameStore();
    const { room, player: admin } = store.createRoom({ firstName: "Banker", buyIn: 100, bankerBankroll: 500 });
    const { player } = store.joinRoom(room.roomId, { firstName: "P1" });

    const result = store.adjustPlayerWallet(room.roomId, admin.id, player.id, -10.7);
    expect(result.amount).toBe(-10);
    expect(store.getRoom(room.roomId)!.wallets[player.id]).toBe(90);
  });

  it("clamps an absurd adjustment instead of letting it reach Infinity on the first addition", () => {
    const store = new GameStore();
    const { room, player: admin } = store.createRoom({ firstName: "Banker", buyIn: 100, bankerBankroll: 500 });
    const { player } = store.joinRoom(room.roomId, { firstName: "P1" });

    const result = store.adjustPlayerWallet(room.roomId, admin.id, player.id, 1e308);
    expect(Number.isFinite(result.total)).toBe(true);
    expect(result.total).toBeLessThan(2_000_000_000);
  });

  it("still refuses NaN and zero the same way it always did", () => {
    const store = new GameStore();
    const { room, player: admin } = store.createRoom({ firstName: "Banker", buyIn: 100, bankerBankroll: 500 });
    const { player } = store.joinRoom(room.roomId, { firstName: "P1" });

    expect(() => store.adjustPlayerWallet(room.roomId, admin.id, player.id, NaN)).toThrow(
      "invalid_bank_amount",
    );
    expect(() => store.adjustPlayerWallet(room.roomId, admin.id, player.id, 0)).toThrow(
      "invalid_bank_amount",
    );
  });
});

// A rejected action must leave the table exactly as it found it. The one that
// did not was applyBet's BANK! branch: it drew the card and ran
// settleImmediateTurn -- which moves roomRec.room.wallets IN PLACE -- before
// asking whether the bank amount was even legal. persistRound never ran on the
// throw, so the card and the wager rolled back while the payout stayed.
describe("a rejected BANK! bet", () => {
  it("moves no money, however the drawn card lands", () => {
    const store = new GameStore();
    const { room, player: admin } = store.createRoom({ firstName: "Banker", buyIn: 100, bankerBankroll: 500 });
    const { player } = store.joinRoom(room.roomId, { firstName: "P1" });

    // Looped rather than run once: the bug only paid out when the drawn card
    // RESOLVED the hand (a 21 or a rosier pair paid the player, a bust paid
    // the banker), which is a minority of draws. One deal proves nothing.
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const round = store.startRound(room.roomId, admin.id);
      const before = { ...store.getRoom(room.roomId)!.wallets };

      // `bank: true` with anything other than the full bank window is exactly
      // what invalid_bank_amount is for -- and what a client can send.
      expect(() => store.applyBet(round.roundId, player.id, 3, { bank: true })).toThrow(
        "invalid_bank_amount",
      );

      const after = store.getRoom(room.roomId)!.wallets;
      expect(after[player.id]).toBe(before[player.id]);
      expect(after[admin.id]).toBe(before[admin.id]);

      // Fresh deal for the next attempt; the wallets are already asserted
      // unchanged, so nothing needs resetting but the round itself.
      store.getRoom(room.roomId)!.roundId = undefined;
    }
  });
});

// The buy-in request is the only money path in GameStore whose amount comes
// from an UNTRUSTED party -- every other one is the banker's own -- and it was
// the last one still guarded by a bare Number.isFinite. It matters more here
// than anywhere else for exactly that reason.
describe("a player's own buy-in request", () => {
  const seat = () => {
    const store = new GameStore();
    const { room, player: admin } = store.createRoom({ firstName: "Banker", buyIn: 100, bankerBankroll: 500 });
    const { player } = store.joinRoom(room.roomId, { firstName: "P1" });
    return { store, room, admin, player };
  };

  it("cannot ask for more chips than MAX_MONEY, however it is spelled", () => {
    // 1e308 is finite, so the old check passed it and approveBuyIn added it
    // straight into a wallet. The wallet stayed finite too -- which is what
    // made it quiet -- and the next multiplication anywhere downstream turned
    // the room's money into Infinity.
    const { store, room, admin, player } = seat();
    store.requestBuyIn(room.roomId, player.id, 1e308);
    store.approveBuyIn(room.roomId, admin.id, player.id);
    const wallet = store.getRoom(room.roomId)!.wallets[player.id];
    // MAX_MONEY bounds one TRANSACTION, not a resulting balance -- the wallet
    // is the capped buy-in plus whatever was already in it. That distinction
    // is the guarantee: no single amount can be astronomical, so the total
    // stays a number arithmetic still works on.
    expect(wallet).toBeLessThanOrEqual(1_000_000_000 + 100);
    expect(Number.isFinite(wallet * 1000)).toBe(true);
  });

  it("floors a fractional request rather than seeding a wallet with a float", () => {
    const { store, room, admin, player } = seat();
    const req = store.requestBuyIn(room.roomId, player.id, 10.7);
    expect(req.amount).toBe(10);
    store.approveBuyIn(room.roomId, admin.id, player.id);
    expect(store.getRoom(room.roomId)!.wallets[player.id]).toBe(110);
  });

  it("still refuses zero, negatives and NaN the way it always did", () => {
    const { store, room, player } = seat();
    for (const bad of [0, -25, NaN]) {
      expect(() => store.requestBuyIn(room.roomId, player.id, bad)).toThrow("invalid_payload");
    }
  });

  it("re-checks at approval, so a restored request cannot pay out unbounded", () => {
    // buyInRequests round-trip through Postgres as JSON: the amount reaching
    // approveBuyIn is not necessarily the one requestBuyIn validated.
    const { store, room, admin, player } = seat();
    store.requestBuyIn(room.roomId, player.id, 50);
    const live = store.getRoom(room.roomId)!;
    live.buyInRequests = live.buyInRequests.map((r) => ({ ...r, amount: 1e308 }));
    store.approveBuyIn(room.roomId, admin.id, player.id);
    expect(store.getRoom(room.roomId)!.wallets[player.id]).toBeLessThanOrEqual(1_000_000_000 + 100);
  });
});

// The banker's own top-up was the last path that could walk around MAX_MONEY.
describe("topUpBanker", () => {
  it("caps the bank rather than letting it reach a value nothing can divide", () => {
    const store = new GameStore();
    const { room, player: admin } = store.createRoom({ firstName: "Banker", buyIn: 100, bankerBankroll: 500 });
    store.topUpBanker(room.roomId, admin.id, 1e308);
    const bank = store.getRoom(room.roomId)!.wallets[admin.id];
    expect(bank).toBeLessThanOrEqual(1_000_000_000 + 500);
    expect(Number.isFinite(bank * 1000)).toBe(true);
  });

  it("still takes chips back out, which is why it normalizes the magnitude", () => {
    const store = new GameStore();
    const { room, player: admin } = store.createRoom({ firstName: "Banker", buyIn: 100, bankerBankroll: 500 });
    store.topUpBanker(room.roomId, admin.id, -200);
    expect(store.getRoom(room.roomId)!.wallets[admin.id]).toBe(300);
  });

  it("floors a fractional top-up", () => {
    const store = new GameStore();
    const { room, player: admin } = store.createRoom({ firstName: "Banker", buyIn: 100, bankerBankroll: 500 });
    store.topUpBanker(room.roomId, admin.id, 40.9);
    expect(store.getRoom(room.roomId)!.wallets[admin.id]).toBe(540);
  });
});
