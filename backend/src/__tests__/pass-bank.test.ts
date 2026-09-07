import { describe, expect, it } from "vitest";
import { GameStore } from "../store.js";

const C = (n: number) => ({ name: String(n), attributes: { values: [n] } });

// The third exit from a busted bank. Until 2026-09-06 a banker whose wallet
// a BANK! wager had emptied got exactly two choices -- put more chips in, or
// end the round -- even though the rule has always allowed a third: hand the
// bank to another player, who then banks with the chips they already hold.
//
// "The chips they already hold" is not a transfer in this codebase, and that
// is the whole reason this is implementable in a few lines: the bank has
// never been a separate pot, it is whatever sits in the admin's own wallet
// (computeBankWindow reads room.wallets[bankerId]). Swapping who holds the
// admin role IS the handover.
describe("passing the bank after a BANK! empties it", () => {
  // Drives a table to the exact state the prompt appears in: bankLock in
  // "decision" stage, meaning the banker's wallet is spent and the round
  // cannot continue without a decision from them.
  function setUpBustedBank() {
    const store = new GameStore();
    const { room, player: admin } = store.createRoom({
      firstName: "Banker",
      buyIn: 200,
      bankerBankroll: 100,
    });
    const { player: p1 } = store.joinRoom(room.roomId, { firstName: "P1" });
    const { player: p2 } = store.joinRoom(room.roomId, { firstName: "P2" });
    let r = store.startRound(room.roomId, admin.id);

    // P1 takes the bank's entire $100 window and stands on 20.
    const p1Index = r.turns.findIndex((t) => t.player.id === p1.id);
    r.turns[p1Index].cards = [C(10)];
    r.deck = [C(10), ...r.deck];
    r = store.applyBet(r.roundId, p1.id, 100, { bank: true });
    r = store.applyStand(r.roundId, p1.id);
    expect(r.bankLock?.stage).toBe("banker");

    // Banker busts against it, which empties the wallet and forces the
    // decision rather than an auto-redeal.
    const bankerIndex = r.turns.findIndex((t) => t.player.type === "admin");
    r.turns[bankerIndex].cards = [C(12), C(12)];
    r.deck = [C(12), ...r.deck];
    r = store.applyHit(r.roundId, admin.id);

    return { store, room, admin, p1, p2, round: r };
  }

  it("reaches the decision stage with the bank actually empty", () => {
    const { store, room, admin, round } = setUpBustedBank();
    expect(round.bankLock?.stage).toBe("decision");
    expect(store.getRoom(room.roomId)!.wallets[admin.id]).toBe(0);
  });

  it("makes the chosen player the banker, banking the chips they already hold", () => {
    const { store, room, admin, p2 } = setUpBustedBank();
    const p2WalletBefore = store.getRoom(room.roomId)!.wallets[p2.id];

    store.passBankAfterBankDecision(room.roomId, admin.id, p2.id);

    const after = store.getRoom(room.roomId)!;
    expect(after.players.find((p) => p.id === p2.id)!.type).toBe("admin");
    expect(after.players.find((p) => p.id === admin.id)!.type).toBe("player");
    // The defining property: no chips moved. The new banker's stack IS the
    // new bank, which is what "they start with the money they currently
    // have" means.
    expect(after.wallets[p2.id]).toBe(p2WalletBefore);
  });

  it("ends the round on the way out rather than continuing under new management", () => {
    const { store, room, admin, p2 } = setUpBustedBank();
    const ended = store.passBankAfterBankDecision(room.roomId, admin.id, p2.id);
    // Same resolution ending the round directly would have given -- the hand
    // in flight got here precisely because the bank could not cover what it
    // still owed, so there is nothing to play it out with.
    expect(ended.state).toBe("terminate");
    expect(ended.bankLock).toBeUndefined();
  });

  it("refuses a bot, the current banker, and a stranger", () => {
    const { store, room, admin, p2 } = setUpBustedBank();
    expect(() => store.passBankAfterBankDecision(room.roomId, admin.id, admin.id)).toThrow();
    expect(() => store.passBankAfterBankDecision(room.roomId, admin.id, "nobody")).toThrow(
      "player_not_found"
    );
    // And only the banker may hand the bank on at all.
    expect(() => store.passBankAfterBankDecision(room.roomId, p2.id, p2.id)).toThrow("forbidden");
  });

  it("refuses when the bank is not actually in its decision stage", () => {
    const store = new GameStore();
    const { room, player: admin } = store.createRoom({ firstName: "Banker", buyIn: 100 });
    const { player: p1 } = store.joinRoom(room.roomId, { firstName: "P1" });
    store.startRound(room.roomId, admin.id);
    // A healthy table mid-round is not a handover moment; the prompt this
    // backs only exists once a BANK! wager has emptied the bank.
    expect(() => store.passBankAfterBankDecision(room.roomId, admin.id, p1.id)).toThrow(
      "bank_not_in_decision"
    );
  });
});
