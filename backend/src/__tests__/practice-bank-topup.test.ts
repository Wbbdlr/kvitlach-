import { describe, expect, it } from "vitest";
import { GameStore } from "../store.js";

// A practice table's banker is a bot, so the ordinary remedy for an emptied
// bank -- Manage -> BANK -> add chips, which is admin-only -- has nobody to
// press it. One BANK! wager that drains the bank ended the table outright:
// every wager after it is refused with bank_empty and the felt offers no way
// through. Reported from a practice table after a bot BANK!ed into 21: "the
// whole round was broken as a result [...] we need to query the player if
// they want to replenish the computer bank."

function practiceTable() {
  const store = new GameStore();
  const room = store.createPracticeRoom({ firstName: "Tester", buyIn: 100, botCount: 2 });
  const roomId = room.room.roomId;
  const human = room.player;
  const banker = room.room.players.find((p) => p.type === "admin")!;
  return { store, roomId, human, banker };
}

describe("refilling a practice table's bot bank", () => {
  it("refuses while the bank still has chips", () => {
    const { store, roomId, human } = practiceTable();
    expect(() => store.practiceTopUpBank(roomId, human.id, 400)).toThrow("bank_not_empty");
  });

  // The amount is the player's to choose. It shipped for one release as a
  // fixed 4x the buy-in and was corrected straight away: "Practice bank they
  // should just be able to select refill amount."
  it("refills by whatever amount the player asked for", () => {
    const { store, roomId, human, banker } = practiceTable();
    store.getRoom(roomId)!.wallets[banker.id] = 0;

    const result = store.practiceTopUpBank(roomId, human.id, 250);

    expect(result.amount).toBe(250);
    expect(store.getRoom(roomId)!.wallets[banker.id]).toBe(250);
    // The felt's bank readout and the next round's window both read this.
    expect(store.getRoom(roomId)!.bankerBuyIn).toBe(250);
  });

  it("takes whole chips only, the same as every other money path", () => {
    const { store, roomId, human, banker } = practiceTable();
    store.getRoom(roomId)!.wallets[banker.id] = 0;
    expect(store.practiceTopUpBank(roomId, human.id, 99.9).amount).toBe(99);
  });

  it("refuses an amount that is not a real number of chips", () => {
    const { store, roomId, human, banker } = practiceTable();
    store.getRoom(roomId)!.wallets[banker.id] = 0;
    for (const bad of [0, -50, Number.NaN]) {
      expect(() => store.practiceTopUpBank(roomId, human.id, bad)).toThrow("invalid_payload");
    }
  });

  it("lets a wager through again afterwards, which is the whole point", () => {
    const { store, roomId, human, banker } = practiceTable();
    store.getRoom(roomId)!.wallets[banker.id] = 0;

    // The human starts rounds at a practice table -- the bot banker never
    // deals its own room (store.ts's startRound refuses an isBot actor).
    const dead = store.startRound(roomId, human.id);
    expect(() => store.applyBet(dead.roundId, store.getRound(dead.roundId)!.turns[0].player.id, 5)).toThrow();

    store.practiceTopUpBank(roomId, human.id, 400);
    const round = store.getRound(dead.roundId)!;
    const seat = round.turns.find((t) => t.player.type !== "admin")!;
    // Whoever is up first -- the point is that the bank can cover a wager at
    // all, not which seat places it.
    const activeId = round.turns.find((t) => t.state === "pending" && t.player.type !== "admin")?.player.id ?? seat.player.id;
    expect(() => store.applyBet(round.roundId, activeId, 5)).not.toThrow();
  });

  it("is practice-only", () => {
    const store = new GameStore();
    const { room, player: admin } = store.createRoom({ firstName: "Zeide", buyIn: 100, bankerBankroll: 50 });
    const { player: p1 } = store.joinRoom(room.roomId, { firstName: "Moshe" });
    store.getRoom(room.roomId)!.wallets[admin.id] = 0;
    expect(() => store.practiceTopUpBank(room.roomId, p1.id, 400)).toThrow("forbidden");
  });

  it("refuses someone who is not at the table", () => {
    const { store, roomId, banker } = practiceTable();
    store.getRoom(roomId)!.wallets[banker.id] = 0;
    expect(() => store.practiceTopUpBank(roomId, "not-a-player", 400)).toThrow("player_not_found");
  });
});
