import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { GameStore } from "../store.js";
import { RuntimeLimits } from "../limits.js";

// Force-delete used to be immediate and total: an operator clearing a stuck
// table took its ledger with it, and that ledger is the only account of who
// paid whom that night. The Game ID freeing up is the point of deleting; losing
// the record was collateral nobody chose.

/** A fake Database with just the calls the archive path touches. */
function fakeDb() {
  const archived: Record<string, unknown>[] = [];
  return {
    archived,
    db: {
      archiveRoom: vi.fn(async (params: Record<string, unknown>) => {
        archived.push(params);
      }),
      pruneArchivedRooms: vi.fn(async () => 0),
      listArchivedRooms: vi.fn(async () => []),
      getArchivedRoom: vi.fn(async () => undefined),
      deleteRoom: vi.fn(async () => {}),
      saveRoom: vi.fn(async () => {}),
      saveRound: vi.fn(async () => {}),
      deleteRound: vi.fn(async () => {}),
      appendAudit: vi.fn(async () => {}),
      pruneAudit: vi.fn(async () => 0),
      listAudit: vi.fn(async () => []),
      logConnection: vi.fn(async () => 1),
    } as never,
  };
}

function table(db?: never) {
  const limits = new RuntimeLimits();
  const store = new GameStore(db, limits);
  // createRoom names the table itself (a random heimishe one), so the test
  // reads the name back off the room rather than asserting a literal.
  const { room, player: banker } = store.createRoom({ firstName: "Banker", buyIn: 100, bankerBankroll: 1000 });
  const { player } = store.joinRoom(room.roomId, { firstName: "Player" });
  return { store, limits, roomId: room.roomId, roomName: room.name, banker, player };
}

describe("deleting a table", () => {
  it("keeps the ledger, which is the only record of who paid whom", async () => {
    const { archived, db } = fakeDb();
    const { store, roomId, roomName, banker, player } = table(db);
    store.adjustPlayerWallet(roomId, banker.id, player.id, 25, "late buy-in");

    expect(store.forceDeleteRoom(roomId)).toBe(true);
    await vi.waitFor(() => expect(archived).toHaveLength(1));

    const entry = archived[0] as { roomId: string; name?: string; bankerName?: string; state: { ledger: unknown[] } };
    expect(entry.roomId).toBe(roomId);
    expect(entry.name).toBe(roomName);
    expect(entry.bankerName).toBe("Banker");
    expect(entry.state.ledger.length).toBeGreaterThan(0);
  });

  it("does not archive the room's password hash", async () => {
    // One-way, so not a leak -- but the table it protected is gone and its
    // Game ID has been handed back, so keeping the credential for another
    // ninety days protects nothing and is one more place it can be found.
    const { archived, db } = fakeDb();
    const limits = new RuntimeLimits();
    const store = new GameStore(db, limits);
    const { room } = store.createRoom({ firstName: "B", buyIn: 10, bankerBankroll: 100, password: "hunter2" });
    // Without this the test would pass just as happily against a room that
    // never had a password, which would prove nothing.
    expect(store.listRoomsForAdmin().find((r) => r.roomId === room.roomId)?.hasPassword).toBe(true);

    store.forceDeleteRoom(room.roomId);
    await vi.waitFor(() => expect(archived).toHaveLength(1));

    const state = (archived[0] as { state: Record<string, unknown> }).state;
    expect(state.passwordHash).toBeUndefined();
    expect(JSON.stringify(state)).not.toContain("scrypt");
    // What archiving is actually for is still there.
    expect(state.players).toBeDefined();
    expect(state.roomId).toBe(room.roomId);
  });

  it("still frees the Game ID, which is what deleting is for", () => {
    const { db } = fakeDb();
    const { store, roomId } = table(db);
    store.forceDeleteRoom(roomId);
    expect(store.getRoom(roomId)).toBeUndefined();
    expect(store.listRoomsForAdmin().some((r) => r.roomId === roomId)).toBe(false);
  });

  it("archives before it deletes the row, not after", async () => {
    const { db } = fakeDb();
    const { store, roomId } = table(db);
    store.forceDeleteRoom(roomId);
    await vi.waitFor(() => expect((db as never as { archiveRoom: { mock: { calls: unknown[] } } }).archiveRoom.mock.calls).toHaveLength(1));
    expect((db as never as { deleteRoom: { mock: { calls: unknown[] } } }).deleteRoom.mock.calls).toHaveLength(1);
  });

  it("does not archive a practice table", async () => {
    // Practice rooms are never persisted at all -- no other humans, no wallets
    // anybody is accountable for. Archiving one would mean starting to store
    // something this app has deliberately never stored.
    const { archived, db } = fakeDb();
    const store = new GameStore(db, new RuntimeLimits());
    const { room } = store.createPracticeRoom({ firstName: "Solo", botCount: 2 });
    store.forceDeleteRoom(room.roomId);
    await new Promise((r) => setTimeout(r, 10));
    expect(archived).toHaveLength(0);
  });

  it("deletes normally on a server with no database", () => {
    // Nothing to archive to, and that must not stop the delete: an operator
    // clearing a stuck table is doing it because the table is a problem.
    const { store, roomId } = table();
    expect(store.forceDeleteRoom(roomId)).toBe(true);
    expect(store.getRoom(roomId)).toBeUndefined();
  });

  it("records in the audit trail whether the record was actually kept", async () => {
    // "I deleted it, is it recoverable" has a different answer depending on
    // whether a database was configured, and the trail should say which.
    const { store, roomId } = table();
    store.forceDeleteRoom(roomId);
    const { entries } = await store.auditLog.list({ roomId });
    expect(entries[0].action).toBe("admin-force-delete");
    expect(entries[0].details.archived).toBe(false);
  });
});

describe("retention", () => {
  it("has its own window, bounded in code", () => {
    const limits = new RuntimeLimits();
    expect(limits.archiveRetentionDays).toBe(90);
    limits.set("archiveRetentionDays", 100_000);
    expect(limits.archiveRetentionDays).toBeLessThanOrEqual(365);
  });

  it("is stated on the Privacy page, which is code-only so it cannot drift", () => {
    const privacy = readFileSync(resolve(__dirname, "../../../frontend/src/Privacy.tsx"), "utf8");
    expect(privacy).toMatch(/When an operator deletes a real table/);
    expect(privacy).toMatch(/kept for 90 days/);
  });

  it("prunes at most hourly rather than on every delete", async () => {
    const { db } = fakeDb();
    const store = new GameStore(db, new RuntimeLimits());
    for (let i = 0; i < 3; i += 1) {
      const { room } = store.createRoom({ firstName: "B", buyIn: 10, bankerBankroll: 100 });
      store.forceDeleteRoom(room.roomId);
    }
    await new Promise((r) => setTimeout(r, 10));
    expect((db as never as { pruneArchivedRooms: { mock: { calls: unknown[] } } }).pruneArchivedRooms.mock.calls).toHaveLength(1);
  });
});
