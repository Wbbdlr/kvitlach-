import { describe, expect, it } from "vitest";
import { GameStore } from "../store.js";
import { RuntimeLimits } from "../limits.js";

// Two halves of one reported problem: "some people still have the app or page
// running for a while so it thinks the game is still active, we should prob
// kick them after a day or whatever."
//
// The room half is that a reconnect used to count as play, so a tab left open
// refreshed a dead table's whole idle window. The seat half is that nothing
// ever emptied a chair somebody had walked away from, so a roster filled up
// with people who were not there and the rotation kept dealing them in.

const hours = (n: number) => n * 60 * 60_000;

function table(playerCount = 2) {
  const limits = new RuntimeLimits();
  const store = new GameStore(undefined, limits);
  const { room, player: banker } = store.createRoom({ firstName: "Banker", buyIn: 100, bankerBankroll: 1000 });
  const players = [];
  for (let i = 0; i < playerCount; i += 1) {
    players.push(store.joinRoom(room.roomId, { firstName: `P${i}` }).player);
  }
  return { store, limits, roomId: room.roomId, banker, players };
}

/** Backdates the room and every seat's last action, as if hours had passed. */
function ageBy(store: GameStore, roomId: string, ms: number) {
  const rec = (
    store as unknown as {
      rooms: Map<string, { lastActivityAt?: number; seatFloorAt?: number; lastSeatActionAt?: Record<string, number> }>;
    }
  ).rooms.get(roomId)!;
  rec.lastActivityAt = (rec.lastActivityAt ?? Date.now()) - ms;
  rec.seatFloorAt = (rec.seatFloorAt ?? Date.now()) - ms;
  for (const id of Object.keys(rec.lastSeatActionAt ?? {})) {
    rec.lastSeatActionAt![id] -= ms;
  }
}

describe("a reconnect is not play", () => {
  it("does not refresh the room's idle clock", () => {
    const { store, roomId, players } = table(1);
    const rec = (store as unknown as { rooms: Map<string, { lastActivityAt?: number }> }).rooms.get(roomId)!;
    const twoDaysAgo = Date.now() - hours(48);
    rec.lastActivityAt = twoDaysAgo;

    // The client reconnects on its own indefinitely, so this happens whenever
    // a phone wakes up -- with nobody playing anything.
    const session = (store as unknown as { sessions: Map<string, { token: string }> }).sessions.get(players[0].id)!;
    store.resumePlayer(roomId, players[0].id, session.token);

    expect(store.listRoomsForAdmin()[0].lastActivityAt).toBe(twoDaysAgo);
  });

  it("still marks the player online, which is the part that did have to happen", () => {
    const { store, roomId, players } = table(1);
    store.setPresence(roomId, players[0].id, "offline");
    const session = (store as unknown as { sessions: Map<string, { token: string }> }).sessions.get(players[0].id)!;

    const { player } = store.resumePlayer(roomId, players[0].id, session.token);
    expect(player.presence).toBe("online");
  });
});

describe("sweeping idle seats", () => {
  it("removes a seat nobody has used in over a day when the next round is dealt", () => {
    const { store, roomId, banker, players } = table(2);
    ageBy(store, roomId, hours(30));

    store.startRound(roomId, banker.id);

    const left = store.getRoom(roomId)!.players.map((p) => p.id);
    expect(left).toContain(banker.id);
    expect(left).not.toContain(players[0].id);
    expect(left).not.toContain(players[1].id);
  });

  it("keeps a seat whose player acted inside the window", () => {
    const { store, roomId, banker, players } = table(2);
    const round = store.startRound(roomId, banker.id);
    store.applyBet(round.roundId, players[0].id, 10);
    ageBy(store, roomId, hours(30));
    // P0's stamp was aged too, so re-stamp it by acting again right now.
    store.applyStand(round.roundId, players[0].id);

    // Clear the live round so another can be dealt. Reaching in rather than
    // playing the hand out: what is under test is which seats survive the
    // NEXT deal, and a full round would just be a slower way to get here.
    const rec = (store as unknown as { rooms: Map<string, { room: { roundId?: string } }> }).rooms.get(roomId)!;
    rec.room.roundId = undefined;

    store.startRound(roomId, banker.id);
    const left = store.getRoom(roomId)!.players.map((p) => p.id);
    expect(left).toContain(players[0].id);
    expect(left).not.toContain(players[1].id);
  });

  it("never removes the banker, however long they have sat there", () => {
    // The table cannot proceed without them, and a banker who has genuinely
    // gone is BANKER_ABANDON_MS's business.
    const { store, roomId, banker } = table(1);
    ageBy(store, roomId, hours(200));
    store.startRound(roomId, banker.id);
    expect(store.getRoom(roomId)!.players.map((p) => p.id)).toContain(banker.id);
  });

  it("squares the chips through the ledger rather than dropping them", () => {
    const { store, roomId, banker, players } = table(1);
    const before = store.getRoom(roomId)!.wallets[players[0].id];
    expect(before).toBe(100);

    ageBy(store, roomId, hours(30));
    store.startRound(roomId, banker.id);

    const ledger = store.getRoom(roomId)!.ledger ?? [];
    const entry = ledger.find((e) => e.playerId === players[0].id);
    expect(entry).toBeDefined();
    // Signed as the change to that player's own stack, like every other kind.
    expect(entry!.amount).toBe(-100);
    // "leave", not "kick": nobody decided this, and it is the one kind undo
    // deliberately does not reverse -- the way back is the seat-claim flow.
    expect(entry!.kind).toBe("leave");
    expect(entry!.note).toContain("Idle");
  });

  it("honours a threshold changed from the admin panel, not a value read at boot", () => {
    const { store, limits, roomId, banker, players } = table(1);
    ageBy(store, roomId, hours(5));

    // Default is 24h, so five hours is nothing yet.
    store.startRound(roomId, banker.id);
    expect(store.getRoom(roomId)!.players.map((p) => p.id)).toContain(players[0].id);

    const rec = (store as unknown as { rooms: Map<string, { room: { roundId?: string } }> }).rooms.get(roomId)!;
    rec.room.roundId = undefined;

    limits.set("idleSeatHours", 4);
    store.startRound(roomId, banker.id);
    expect(store.getRoom(roomId)!.players.map((p) => p.id)).not.toContain(players[0].id);
  });

  it("leaves practice tables alone", () => {
    const limits = new RuntimeLimits();
    const store = new GameStore(undefined, limits);
    const { room, player: human } = store.createPracticeRoom({ firstName: "Solo", botCount: 2 });
    ageBy(store, room.roomId, hours(200));

    const rec = (store as unknown as { rooms: Map<string, { room: { roundId?: string } }> }).rooms.get(room.roomId)!;
    rec.room.roundId = undefined;
    store.startRound(room.roomId, human.id);

    expect(store.getRoom(room.roomId)!.players.map((p) => p.id)).toContain(human.id);
  });
});
