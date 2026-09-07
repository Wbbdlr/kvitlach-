import { describe, expect, it } from "vitest";
import { GameStore } from "../store.js";

// Every movement of chips that did NOT come from playing a hand.
//
// Found by playing, 2026-09-06. Sara was on $90. The banker opened Manage,
// adjusted her +$50, and applied it:
//
//   Sara's wallet   $90 -> $140
//   The bank        $610 -> $610   (unchanged -- correctly; see below)
//   "Tonight so far"  Sara -$10    (unchanged -- NOT correctly)
//
// ManageDrawer's own comment promises the standings are trustworthy because
// "every chip won came from somewhere, so these add up to zero across the
// table ... a settlement table that does not balance is worse than none."
// After one correction that promise is broken, silently, by exactly the
// correction amount -- and the export reads the same source, so the number the
// banker settles up from at the end of the night is simply wrong.
//
// The bank not being debited is deliberate and stays. An adjustment is the
// same kind of event as a buy-in: somebody hands the banker cash and chips
// come onto the table. approveBuyIn has always worked that way. What was
// missing is that these movements were recorded NOWHERE the banker could see
// -- `audit()` writes one line to the server's stdout and nothing else, which
// is invisible during a game, unreadable afterwards, and gone on restart.
//
// So the room now carries a ledger of them. It exists to answer two questions
// that could not be answered before:
//   1. settlement -- what does each player actually owe or get, given that
//      chips entered outside of play?
//   2. diagnosis -- what did the banker do, to whom, when, and how much?
//      (Not a general undo; see the review's costing of that.)
describe("the banker's ledger", () => {
  function table() {
    const store = new GameStore();
    const { room, player: admin } = store.createRoom({
      firstName: "Zeide",
      buyIn: 100,
      bankerBankroll: 600,
    });
    const { player: sara } = store.joinRoom(room.roomId, { firstName: "Sara", lastName: "K" });
    return { store, roomId: room.roomId, admin, sara };
  }

  it("records a wallet adjustment with everything needed to diagnose it later", () => {
    const { store, roomId, admin, sara } = table();

    store.adjustPlayerWallet(roomId, admin.id, sara.id, 50, "miscounted round 3");

    const ledger = store.getRoom(roomId)!.ledger ?? [];
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      kind: "adjust",
      playerId: sara.id,
      playerName: "Sara K",
      actorId: admin.id,
      actorName: "Zeide",
      amount: 50,
      note: "miscounted round 3",
    });
    // A movement with no time on it cannot be lined up against the round it
    // was meant to correct, which is most of what makes one diagnosable.
    expect(typeof ledger[0].at).toBe("number");
  });

  it("keeps the sign, so a correction downward is not indistinguishable from one upward", () => {
    const { store, roomId, admin, sara } = table();
    store.adjustPlayerWallet(roomId, admin.id, sara.id, -20);
    expect(store.getRoom(roomId)!.ledger![0]).toMatchObject({ kind: "adjust", amount: -20 });
  });

  it("records an approved buy-in, which moves chips the same way and was equally invisible", () => {
    const { store, roomId, admin, sara } = table();
    store.requestBuyIn(roomId, sara.id, 250, "another hundred please");
    store.approveBuyIn(roomId, admin.id, sara.id);

    const entry = store.getRoom(roomId)!.ledger!.at(-1)!;
    expect(entry).toMatchObject({ kind: "buy-in", playerId: sara.id, amount: 250 });
  });

  it("records the banker topping up their own bank", () => {
    const { store, roomId, admin } = table();
    store.topUpBanker(roomId, admin.id, 300, "fresh chips");
    const entry = store.getRoom(roomId)!.ledger!.at(-1)!;
    expect(entry).toMatchObject({ kind: "bank-topup", playerId: admin.id, amount: 300 });
  });

  // A kick is not a chip movement, but it destroys a stack, and "where did
  // Moshe and his $100 go" is exactly the question a banker cannot currently
  // answer an hour later.
  it("records a kick, including the stack that went with it", () => {
    const { store, roomId, admin, sara } = table();
    store.kickPlayer(roomId, admin.id, sara.id);

    const entry = store.getRoom(roomId)!.ledger!.at(-1)!;
    expect(entry).toMatchObject({
      kind: "kick",
      playerId: sara.id,
      playerName: "Sara K",
      actorId: admin.id,
      amount: -100,
    });
  });

  it("records a player leaving for good, and the stack they took with them", () => {
    const { store, roomId, sara } = table();
    store.leaveRoom(roomId, sara.id);

    const entry = store.getRoom(roomId)!.ledger!.at(-1)!;
    expect(entry).toMatchObject({ kind: "leave", playerId: sara.id, amount: -100 });
  });

  it("keeps entries in the order they happened", () => {
    const { store, roomId, admin, sara } = table();
    store.adjustPlayerWallet(roomId, admin.id, sara.id, 10);
    store.adjustPlayerWallet(roomId, admin.id, sara.id, -5);
    store.topUpBanker(roomId, admin.id, 50);

    expect(store.getRoom(roomId)!.ledger!.map((e) => e.kind)).toEqual(["adjust", "adjust", "bank-topup"]);
  });

  // Rooms run for hours and this is broadcast in every room:state. Unbounded
  // history in a payload every player receives on every change is how a long
  // night gets slower the longer it runs.
  it("is bounded, keeping the most recent entries", () => {
    const { store, roomId, admin, sara } = table();
    for (let i = 0; i < 260; i += 1) store.adjustPlayerWallet(roomId, admin.id, sara.id, 1);

    const ledger = store.getRoom(roomId)!.ledger!;
    expect(ledger.length).toBeLessThanOrEqual(200);
    expect(ledger.at(-1)!.amount).toBe(1);
  });

  it("survives a room loaded from a database that predates the field", () => {
    const { store, roomId, admin, sara } = table();
    // Rooms already in Postgres come back without `ledger`, exactly as they
    // come back without `roundHistory` (see RoomState's own comment).
    delete (store.getRoom(roomId) as { ledger?: unknown }).ledger;

    expect(() => store.adjustPlayerWallet(roomId, admin.id, sara.id, 5)).not.toThrow();
    expect(store.getRoom(roomId)!.ledger).toHaveLength(1);
  });
});
