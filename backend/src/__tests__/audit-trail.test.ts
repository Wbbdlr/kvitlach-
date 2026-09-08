import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AUDIT_ACTIONS, AuditLog } from "../audit.js";
import { GameStore } from "../store.js";
import { RuntimeLimits } from "../limits.js";

// "Who deleted that table" had no answer before this: every one of these
// actions called audit(), which wrote a line to stdout and died with the
// container -- and a restart is usually what you did about the problem you
// wanted to ask about.
//
// Money is why it matters. The ledger already says what happened to a wallet;
// it does not say who decided it, and on this platform a banker moves other
// people's chips at their own discretion.

const STORE_SRC = readFileSync(resolve(__dirname, "../store.ts"), "utf8");

function table() {
  const limits = new RuntimeLimits();
  const store = new GameStore(undefined, limits);
  const { room, player: banker } = store.createRoom({ firstName: "Banker", buyIn: 100, bankerBankroll: 1000 });
  const { player } = store.joinRoom(room.roomId, { firstName: "Player" });
  return { store, limits, roomId: room.roomId, banker, player };
}

describe("recording an action", () => {
  it("keeps who did what to whom, with the amount", async () => {
    const { store, roomId, banker, player } = table();
    store.adjustPlayerWallet(roomId, banker.id, player.id, 25, "late buy-in");

    const { entries } = await store.auditLog.list();
    const entry = entries.find((e) => e.action === "wallet-adjust");
    expect(entry, "a wallet adjustment left no trace").toBeTruthy();
    expect(entry!.roomId).toBe(roomId);
    expect(entry!.actorId).toBe(banker.id);
    expect(entry!.details.target).toBe(player.id);
    expect(entry!.details.amount).toBe(25);
  });

  it("records the actions nobody chose, attributed to the server", async () => {
    // An idle-seat sweep removes a player without any person deciding it. If it
    // were attributed to whoever happened to be dealing, the trail would be
    // actively misleading rather than merely incomplete.
    const limits = new RuntimeLimits();
    const log = new AuditLog(limits);
    log.record("idle-seat-swept", "ROOM", "server", { target: "p1", stack: 40 });
    expect(log.recent()[0].actorId).toBe("server");
  });

  it("survives a database that is down, because a game action must not fail on it", async () => {
    // The caller is a kick or a wallet adjustment mid-flight. Losing the durable
    // copy of an entry is a cost; costing the player their chips is not.
    const limits = new RuntimeLimits();
    const broken = {
      appendAudit: () => Promise.reject(new Error("connection refused")),
      pruneAudit: () => Promise.reject(new Error("connection refused")),
      listAudit: () => Promise.reject(new Error("connection refused")),
    } as never;
    const log = new AuditLog(limits, broken);
    expect(() => log.record("kick", "ROOM", "admin", {})).not.toThrow();

    // And the panel still answers, from this process's own memory.
    const { entries, source } = await log.list();
    expect(source).toBe("memory");
    expect(entries).toHaveLength(1);
  });

  it("filters by table, action and actor", async () => {
    const log = new AuditLog(new RuntimeLimits());
    log.record("kick", "AAAA", "banker1", {});
    log.record("kick", "BBBB", "banker2", {});
    log.record("bank-topup", "AAAA", "banker1", {});

    expect((await log.list({ roomId: "AAAA" })).entries).toHaveLength(2);
    expect((await log.list({ action: "kick" })).entries).toHaveLength(2);
    expect((await log.list({ roomId: "AAAA", action: "kick" })).entries).toHaveLength(1);
    expect((await log.list({ actorId: "banker2" })).entries).toHaveLength(1);
  });

  it("returns most recent first", async () => {
    const log = new AuditLog(new RuntimeLimits());
    log.record("kick", "AAAA", "a", {});
    log.record("leave", "AAAA", "b", {});
    expect((await log.list()).entries[0].action).toBe("leave");
  });
});

describe("retention", () => {
  it("has a window decided in code, inside bounds a form cannot widen", () => {
    const limits = new RuntimeLimits();
    expect(limits.auditRetentionDays).toBe(90);
    limits.set("auditRetentionDays", 100_000);
    // These rows carry player identifiers and amounts. An unbounded window is a
    // pile of personal data kept for a purpose that expired months ago.
    expect(limits.auditRetentionDays).toBeLessThanOrEqual(365);
  });

  it("is stated on the Privacy page, which is code-only so it cannot drift", () => {
    // The Privacy page makes factual claims about what the code does, so it
    // changes in the same commit the code does. If this fails, one of the two
    // moved without the other.
    const privacy = readFileSync(resolve(__dirname, "../../../frontend/src/Privacy.tsx"), "utf8");
    expect(privacy).toMatch(/kept for 90 days/);
    expect(new RuntimeLimits().auditRetentionDays).toBe(90);
  });

  it("does not delete a table's history when the table is deleted", async () => {
    // "Who deleted that table" is worth nothing if deleting the table takes the
    // answer with it.
    const { store, roomId } = table();
    store.forceDeleteRoom(roomId);
    const { entries } = await store.auditLog.list({ roomId });
    expect(entries.some((e) => e.action === "admin-force-delete")).toBe(true);
  });
});

describe("the action list the panel filters by", () => {
  it("covers every action store.ts actually records", () => {
    // A filter dropdown that silently goes stale is worse than none: an
    // operator filtering for an action that is missing from the list concludes
    // it never happened.
    const used = new Set(
      [...STORE_SRC.matchAll(/this\.audit\(\s*"([a-z0-9-]+)"/g)].map((m) => m[1])
    );
    const listed = new Set<string>(AUDIT_ACTIONS);
    const missing = [...used].filter((a) => !listed.has(a)).sort();
    expect(missing, "store.ts records these but the panel cannot filter for them").toEqual([]);
  });

  it("lists nothing store.ts never records", () => {
    const used = new Set(
      [...STORE_SRC.matchAll(/this\.audit\(\s*"([a-z0-9-]+)"/g)].map((m) => m[1])
    );
    const stale = AUDIT_ACTIONS.filter((a) => !used.has(a));
    expect(stale, "these are offered as filters but nothing produces them").toEqual([]);
  });
});
