import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { Database } from "../db.js";
import { GameStore } from "../store.js";
import type { RoomState } from "../types.js";

// db.ts sat at 0% coverage while being the layer the mid-round money bug lived
// next to: rooms and rounds are persisted by two different mechanisms on two
// different triggers, and a restart is the only thing that ever forces them to
// agree. Mocking a Postgres would have tested the mock -- JSONB round-tripping,
// ON CONFLICT upserts and DISTINCT ON are exactly the parts a fake gets right
// for free and a real database does not. So this talks to a real one.
//
// TEST_DATABASE_URL is deliberately its own variable rather than reusing
// DATABASE_URL: these tests write and delete rows, and someone running the
// suite on a machine configured to point at a live game server should not have
// that happen silently. Nothing here drops or truncates a table -- every row is
// namespaced by a per-run id and cleaned up afterwards -- but the separate
// variable means you have to opt in on purpose.
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const IS_CI = process.env.CI === "true" || process.env.CI === "1";

// A suite that quietly skips in CI is worse than no suite: it reports green
// while testing nothing, which is precisely the false confidence this file
// exists to remove. Locally, skipping is the right call (most people don't
// have a Postgres up); in CI the workflow provides one, so a missing URL there
// means the service container broke and must fail loudly.
if (IS_CI && !TEST_DATABASE_URL) {
  describe("database integration", () => {
    it("CI must provide TEST_DATABASE_URL -- the Postgres service is missing", () => {
      expect.fail(
        "TEST_DATABASE_URL is unset in CI. .github/workflows/ci.yml is supposed to " +
          "run a Postgres service container and pass its URL. These tests skipping " +
          "silently would report green while covering nothing."
      );
    });
  });
}

const runIf = TEST_DATABASE_URL ? describe : describe.skip;

// Namespaces every row this run creates, so a repeat run (or two runs at once)
// can never see each other's data and cleanup can be exact.
const RUN = randomUUID().slice(0, 8);
const roomId = (name: string) => `T-${RUN}-${name}`.toUpperCase();

let db: Database;
// A second, test-owned connection purely for the assertions that need to look
// at raw rows (checking that a delete really cascaded, for instance). Database
// keeps its own pool private, which is correct -- widening that just so a test
// can peek would be letting the test dictate production shape.
let raw: Pool;
const createdRooms: string[] = [];

function makeRoomState(id: string, overrides: Partial<RoomState> = {}): RoomState {
  return {
    roomId: id,
    name: "Test Table",
    buyIn: 100,
    bankerBuyIn: 500,
    wallets: {},
    players: [],
    balances: [],
    completedRounds: 0,
    renameRequests: [],
    buyInRequests: [],
    waitingPlayerIds: [],
    renameBlockedIds: [],
    buyInBlockedIds: [],
    ...overrides,
  } as RoomState;
}

async function track(id: string): Promise<string> {
  createdRooms.push(id);
  return id;
}

// The store's DB writes are deliberately fire-and-forget (`void this.db...`),
// so a test that read straight after an action would race the write. Polling
// for the expected state is honest about that instead of sleeping and hoping.
// `describe` carries what the poll was actually seeing, because a bare
// "timed out" tells you nothing you can act on from a CI annotation -- the
// whole question is whether the row was absent, or present with the wrong
// contents, and those have completely different causes.
async function waitFor<T>(
  fn: () => Promise<T | undefined>,
  describe: () => Promise<unknown>,
  timeoutMs = 15_000
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const got = await fn();
    if (got !== undefined) return got;
    await new Promise((r) => setTimeout(r, 50));
  }
  const seen = await describe().catch((e) => `<describe threw: ${e}>`);
  throw new Error(`waitFor timed out; last observed: ${JSON.stringify(seen)}`);
}

runIf("database integration (real Postgres)", () => {
  beforeAll(async () => {
    db = new Database(TEST_DATABASE_URL);
    await db.init();
    raw = new Pool({ connectionString: TEST_DATABASE_URL });
  }, 60_000);

  afterAll(async () => {
    for (const id of createdRooms) {
      await db.deleteRoom(id).catch(() => undefined);
      await raw.query(`DELETE FROM connections WHERE room_id = $1`, [id]).catch(() => undefined);
    }
    await raw.end();
    await db.dispose();
  }, 60_000);

  it("init() is idempotent -- it runs on every boot, not just the first", async () => {
    // Every CREATE is IF NOT EXISTS, but that is easy to break by adding one
    // statement that isn't, and the failure would only ever show on the second
    // deploy rather than the one that introduced it.
    await expect(db.init()).resolves.toBeUndefined();
    await expect(db.init()).resolves.toBeUndefined();
  });

  it("round-trips a room's full state through JSONB without losing shape", async () => {
    const id = await track(roomId("shape"));
    const state = makeRoomState(id, {
      // No -0 here: JSON has no signed zero, so it round-trips to 0 and
      // toEqual distinguishes the two. That was a bad test case, not a bug --
      // a wallet can never legitimately hold -0 anyway.
      wallets: { alice: 125, bob: 0, carol: 40 },
      players: [{ id: "alice", firstName: "Alice", lastName: "", type: "player", presence: "online" }],
      balances: [{ amount: 25, payer: "bob", payee: "alice" }],
      completedRounds: 7,
      waitingPlayerIds: ["carol"],
    } as Partial<RoomState>);

    await db.saveRoom(id, state);
    const rows = await db.loadActiveRooms();
    const found = rows.find((r) => r.roomId === id);

    expect(found).toBeDefined();
    // Deep equality, not spot checks: the failure mode worth catching is a
    // number arriving as a string or a nested array flattening, which any
    // single-field assertion would sail straight past.
    expect(found!.roomState).toEqual(state);
    expect(typeof found!.roomState.wallets.alice).toBe("number");
  });

  it("saveRoom upserts rather than duplicating, and the newest state wins", async () => {
    const id = await track(roomId("upsert"));
    await db.saveRoom(id, makeRoomState(id, { completedRounds: 1 }));
    await db.saveRoom(id, makeRoomState(id, { completedRounds: 2 }));

    const rows = (await db.loadActiveRooms()).filter((r) => r.roomId === id);
    expect(rows).toHaveLength(1);
    expect(rows[0].roomState.completedRounds).toBe(2);
  });

  it("nests each room's rounds under it, and keeps other rooms' rounds out", async () => {
    const a = await track(roomId("nesta"));
    const b = await track(roomId("nestb"));
    await db.saveRoom(a, makeRoomState(a));
    await db.saveRoom(b, makeRoomState(b));
    await db.saveRound(`${a}-R1`, a, { roundId: `${a}-R1`, marker: "a1" });
    await db.saveRound(`${a}-R2`, a, { roundId: `${a}-R2`, marker: "a2" });
    await db.saveRound(`${b}-R1`, b, { roundId: `${b}-R1`, marker: "b1" });

    const rows = await db.loadActiveRooms();
    const roomA = rows.find((r) => r.roomId === a)!;
    const roomB = rows.find((r) => r.roomId === b)!;

    expect(roomA.rounds.map((r) => r.roundId).sort()).toEqual([`${a}-R1`, `${a}-R2`]);
    expect(roomB.rounds.map((r) => r.roundId)).toEqual([`${b}-R1`]);
  });

  it("deleting a room takes its rounds with it -- there is no FK doing that", async () => {
    // rooms and rounds have no foreign key between them, so the cascade is
    // hand-written in deleteRoom. Orphaned rounds would otherwise accumulate
    // forever and be reloaded against a room that no longer exists.
    const id = await track(roomId("cascade"));
    await db.saveRoom(id, makeRoomState(id));
    await db.saveRound(`${id}-R1`, id, { roundId: `${id}-R1` });

    await db.deleteRoom(id);

    const rows = await db.loadActiveRooms();
    expect(rows.find((r) => r.roomId === id)).toBeUndefined();
    const orphans = await raw.query(`SELECT round_id FROM rounds WHERE room_id = $1`, [id]);
    expect(orphans.rows).toHaveLength(0);
  });

  it("returns one summary per player, from their most recent connection", async () => {
    // getRoomConnectionSummaries leans on DISTINCT ON + ORDER BY, which is the
    // kind of query a mock would never actually execute.
    const id = await track(roomId("conns"));
    await db.logConnection({ roomId: id, playerId: "p1", ip: "1.1.1.1", userAgent: "old" });
    const second = await db.logConnection({ roomId: id, playerId: "p1", ip: "2.2.2.2", userAgent: "new" });
    await db.logConnection({ roomId: id, playerId: "p2", ip: "3.3.3.3" });

    await db.markSeen(second!);
    await db.logDisconnection(second!);

    const summaries = await db.getRoomConnectionSummaries(id);
    expect(summaries).toHaveLength(2);
    const p1 = summaries.find((s) => s.playerId === "p1")!;
    expect(p1.userAgent).toBe("new");
    expect(p1.ip).toBe("2.2.2.2");
    expect(typeof p1.connectedAt).toBe("number");
    expect(typeof p1.lastSeenAt).toBe("number");
  });
});

runIf("restart recovery (real Postgres) -- the room and the round must agree", () => {
  let store: GameStore;
  let liveDb: Database;

  beforeAll(async () => {
    liveDb = new Database(TEST_DATABASE_URL);
    await liveDb.init();
  }, 60_000);

  afterAll(async () => {
    await liveDb.dispose();
  }, 60_000);

  it("a mid-round settlement survives a restart with the money still paid", async () => {
    // This is the exact shape of the bug fixed on 2026-08-27: settleImmediateTurn
    // pays a hand out mid-round, persistRound writes the ROUND, but the room --
    // where wallets live -- is only written by bumpRoomTimer. A restart in that
    // window restored a round whose turns were already marked settled against a
    // room that never received the money, and calculateBalances skips settled
    // turns, so it was never paid at all. Nothing but a real reload proves it.
    store = new GameStore(liveDb);
    const { room, player: admin } = store.createRoom({
      firstName: "Banker",
      buyIn: 100,
      bankerBankroll: 500,
      roomId: `T-${RUN}-RESTART`,
    });
    createdRooms.push(room.roomId);
    const { player: p1 } = store.joinRoom(room.roomId, { firstName: "P1" });
    store.joinRoom(room.roomId, { firstName: "P2" }); // keeps the round live past the bust
    const round = store.startRound(room.roomId, admin.id);

    const p1Turn = round.turns.find((t) => t.player.id === p1.id)!;
    p1Turn.cards = [
      { name: "12", attributes: { values: [12, 9, 10] } },
      { name: "12", attributes: { values: [12, 9, 10] } },
    ];
    p1Turn.bet = 10;
    round.deck = [{ name: "10", attributes: { values: [10] } }, ...round.deck];

    const updated = store.applyHit(round.roundId, p1.id);
    expect(updated.state).not.toBe("terminate"); // still mid-round
    const walletAfterSettle = store.getRoom(room.roomId)!.wallets[p1.id];
    const bankAfterSettle = store.getRoom(room.roomId)!.wallets[admin.id];
    expect(walletAfterSettle).toBe(90);
    expect(bankAfterSettle).toBe(510);

    // The write is fire-and-forget, so wait for it to actually land rather
    // than assuming it did.
    await waitFor(
      async () => {
        const rows = await liveDb.loadActiveRooms();
        const row = rows.find((r) => r.roomId === room.roomId);
        return row && row.roomState.wallets[p1.id] === 90 ? row : undefined;
      },
      async () => {
        const rows = await liveDb.loadActiveRooms();
        return {
          lookingFor: room.roomId,
          roomIdsInDb: rows.map((r) => r.roomId),
          walletsForThisRoom: rows.find((r) => r.roomId === room.roomId)?.roomState.wallets,
        };
      }
    );

    // The restart: a brand-new store that knows nothing but what Postgres holds.
    const restored = new GameStore(liveDb);
    await restored.loadFromDB();

    const restoredRoom = restored.getRoom(room.roomId);
    expect(restoredRoom).toBeDefined();
    expect(restoredRoom!.wallets[p1.id]).toBe(90);
    expect(restoredRoom!.wallets[admin.id]).toBe(510);

    // And the round came back agreeing with it -- the turn still marked
    // settled, so the money is neither lost nor about to be paid twice.
    const restoredRound = restored.getRound(round.roundId);
    expect(restoredRound).toBeDefined();
    const restoredTurn = restoredRound!.turns.find((t) => t.player.id === p1.id)!;
    expect(restoredTurn.settled).toBe(true);
    expect(restoredTurn.state).toBe("lost");
  }, 60_000);
});
