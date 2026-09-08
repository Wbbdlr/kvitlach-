import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { GameStore } from "../store.js";
import {
  DEFAULT_LIMITS,
  LIMIT_KEYS,
  LIMIT_META,
  RuntimeLimits,
  limitBounds,
  limitsFromEnv,
  limitsInGroup,
  normalizeLimit,
} from "../limits.js";

// The named failure this whole group of settings exists to avoid: a panel that
// reports a new limit and enforces the old one. It happens one way -- a
// consumer captures the number at module load instead of reading it when the
// check runs -- and it is invisible until load arrives, because a throttle that
// is never approached looks identical whether it is 30 or 3000.
//
// So these tests do not assert that a value can be stored. They assert that
// changing it changes what the code does, and that no consumer has quietly
// gone back to a constant.

const SRC_DIR = resolve(__dirname, "..");
const readSrc = (name: string) => readFileSync(resolve(SRC_DIR, name), "utf8");

describe("the record itself", () => {
  it("has a label, bounds and an env var for every key", () => {
    // The metadata table is what the panel renders from. A key with no entry
    // would be a setting an operator can never see or change.
    for (const key of LIMIT_KEYS) {
      const meta = LIMIT_META[key];
      expect(meta, `${key} has no metadata`).toBeTruthy();
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.env).toMatch(/^[A-Z][A-Z0-9_]*$/);
      const [min, max] = meta.bounds;
      expect(min).toBeLessThan(max);
    }
  });

  it("ships a default inside its own bounds", () => {
    // A default outside its bounds would be silently clamped on the first save
    // and never afterwards match what the form says "default" is.
    for (const key of LIMIT_KEYS) {
      const [min, max] = limitBounds(key);
      expect(DEFAULT_LIMITS[key], key).toBeGreaterThanOrEqual(min);
      expect(DEFAULT_LIMITS[key], key).toBeLessThanOrEqual(max);
    }
  });

  it("puts every key in exactly one group, and every group has keys", () => {
    const grouped = ["capacity", "protection", "timing"].flatMap((g) => limitsInGroup(g as never));
    expect(grouped.sort()).toEqual([...LIMIT_KEYS].sort());
    for (const group of ["capacity", "protection", "timing"] as const) {
      expect(limitsInGroup(group).length, group).toBeGreaterThan(0);
    }
  });

  it("clamps rather than trusting, including a hand-edited settings row", () => {
    const limits = new RuntimeLimits();
    // NaN is the dangerous one: it compares false against everything, so a cap
    // of NaN does not tighten a limit, it removes it.
    limits.hydrate({ maxRooms: NaN as never, maxMessagesPerWindow: 999_999 });
    expect(limits.maxRooms).toBe(DEFAULT_LIMITS.maxRooms);
    expect(limits.maxMessagesPerWindow).toBe(limitBounds("maxMessagesPerWindow")[1]);
  });

  it("reads every key from its own environment variable", () => {
    const env: Record<string, string> = {};
    for (const key of LIMIT_KEYS) env[LIMIT_META[key].env] = String(limitBounds(key)[0]);
    const parsed = limitsFromEnv(env as never);
    for (const key of LIMIT_KEYS) expect(parsed[key], key).toBe(limitBounds(key)[0]);
  });

  it("ignores a blank field instead of reading it as zero", () => {
    // Number("") is 0, a perfectly good integer, so a blank box would otherwise
    // clamp a cap to its floor rather than being left alone.
    expect(normalizeLimit("maxRooms", "")).toBeUndefined();
    expect(normalizeLimit("maxRooms", "   ")).toBeUndefined();
    expect(normalizeLimit("maxRooms", 12.5)).toBeUndefined();
  });
});

describe("a protection cannot be turned off from the form", () => {
  // Every one of these can be set to a value that disables it. The bounds are
  // the only thing standing between an operator and an unprotected server, and
  // they are in code precisely so the panel cannot widen them.
  it("keeps a real ceiling on every count", () => {
    const limits = new RuntimeLimits();
    for (const key of limitsInGroup("protection")) {
      limits.set(key, Number.MAX_SAFE_INTEGER);
      expect(limits.get(key), `${key} has no effective ceiling`).toBe(limitBounds(key)[1]);
    }
  });

  it("keeps the message rate from being widened by shrinking the window", () => {
    // The subtle direction: rate is count/window, so a one-second window is a
    // looser limit than a ten-second one at the same count.
    const limits = new RuntimeLimits();
    limits.set("messageWindowSeconds", 0);
    expect(limits.messageWindowMs).toBeGreaterThan(0);
    limits.set("roomCreateWindowSeconds", 0);
    expect(limits.roomCreateWindowMs).toBeGreaterThanOrEqual(10_000);
  });

  it("will not let the socket cap drop somewhere a real household cannot connect", () => {
    const limits = new RuntimeLimits();
    limits.set("maxConnectionsPerIp", 0);
    expect(limits.maxConnectionsPerIp).toBeGreaterThan(1);
  });
});

describe("the consumers read it live", () => {
  // The heart of it. Each of these changes a setting on an already-constructed
  // object and asserts the behaviour moved with it -- which is only true if the
  // consumer reads the instance rather than a number taken off it once.
  it("changes the bot think delay", () => {
    const limits = new RuntimeLimits();
    const store = new GameStore(undefined, limits);
    const delay = () => (store as unknown as { botThinkDelay(): number }).botThinkDelay();

    limits.set("botThinkMinMs", 0);
    limits.set("botThinkMaxMs", 0);
    expect(delay()).toBe(0);

    limits.set("botThinkMinMs", 5000);
    limits.set("botThinkMaxMs", 5000);
    expect(delay()).toBe(5000);
  });

  it("changes the session lifetime for sessions issued after the change", () => {
    const limits = new RuntimeLimits();
    const store = new GameStore(undefined, limits);
    limits.set("sessionTtlDays", 1);
    const { room, player } = store.createRoom({ firstName: "Banker", buyIn: 100, bankerBankroll: 1000 });
    const sessions = (store as unknown as { sessions: Map<string, { expiresAt: number }> }).sessions;
    const issued = sessions.get(player.id)!.expiresAt;
    // A day, not the default week. Generous window on the comparison: what is
    // under test is which setting was read, not the clock.
    expect(issued - Date.now()).toBeLessThan(2 * 24 * 60 * 60_000);
    expect(room.roomId).toBeTruthy();
  });

  it("changes the turn clock for a room that has not set its own", () => {
    const limits = new RuntimeLimits();
    const store = new GameStore(undefined, limits);
    const { room } = store.createRoom({ firstName: "Banker", buyIn: 100, bankerBankroll: 1000 });
    const turnMs = () => (store as unknown as { turnTimeoutMs(id: string): number }).turnTimeoutMs(room.roomId);

    expect(turnMs()).toBe(DEFAULT_LIMITS.defaultTurnSeconds * 1000);
    limits.set("defaultTurnSeconds", 30);
    expect(turnMs()).toBe(30_000);
  });

  it("changes the room expiry window", () => {
    const limits = new RuntimeLimits();
    const store = new GameStore(undefined, limits);
    limits.set("roomIdleHours", 1);
    expect(limits.roomIdleMs).toBe(60 * 60_000);
    limits.set("practiceIdleMinutes", 5);
    expect(limits.practiceIdleMs).toBe(5 * 60_000);
    // Proves the store consults the getters rather than its own constants.
    expect(readSrc("store.ts")).not.toMatch(/const INACTIVITY_TIMEOUT_MS/);
  });

  it("never lets the slowest bot think be faster than the fastest", () => {
    const limits = new RuntimeLimits();
    limits.set("botThinkMinMs", 4000);
    limits.set("botThinkMaxMs", 100);
    // Resolved on read, so the stored pair stays exactly what was typed and a
    // later edit to the minimum cannot strand the maximum at a stale number.
    expect(limits.botThinkMaxMs).toBe(4000);
    expect(limits.get("botThinkMaxMs")).toBe(100);
  });
});

describe("nothing captured a limit at module load", () => {
  // The regression this whole file guards. A future edit that reintroduces one
  // of these as a module constant would pass every behavioural test above on
  // the day it was written -- because the default and the constant agree --
  // and only diverge once somebody changed the setting.
  const FORBIDDEN = [
    "MAX_CONNS_PER_IP",
    "MAX_MSGS_PER_WINDOW",
    "MSG_WINDOW_MS",
    "MAX_ROOM_CREATES_PER_WINDOW",
    "ROOM_CREATE_WINDOW_MS",
    "MAX_ADMIN_ATTEMPTS",
    "ADMIN_ATTEMPT_WINDOW_MS",
    "INACTIVITY_TIMEOUT_MS",
    "PRACTICE_INACTIVITY_TIMEOUT_MS",
    "BOT_THINK_DELAY_MIN_MS",
    "BOT_THINK_DELAY_MAX_MS",
    "BOT_BANK_DECISION_DELAY_MS",
    "SESSION_TTL_MS",
    "BANKER_ABANDON_MS",
    "OFFLINE_GRACE_MS",
  ];

  // admin-auth.ts has its own SESSION_TTL_MS -- twelve hours, the ADMIN panel's
  // login lifetime, which is a different thing from a player's session and was
  // deliberately left in code. It is not an operator's dial: shortening it only
  // annoys the one person who signs in, and lengthening it widens exactly the
  // window in which a stolen panel session is dangerous.
  const EXEMPT = new Set(["admin-auth.ts:SESSION_TTL_MS"]);

  it("declares none of the old constants anywhere in backend/src", () => {
    const files = readdirSync(SRC_DIR).filter((f) => f.endsWith(".ts"));
    const offenders: string[] = [];
    for (const file of files) {
      const src = readSrc(file);
      for (const name of FORBIDDEN) {
        if (EXEMPT.has(`${file}:${name}`)) continue;
        if (new RegExp(`\\bconst ${name}\\b`).test(src)) offenders.push(`${file}: ${name}`);
      }
    }
    expect(offenders, "these are settings now -- read them off RuntimeLimits at the point of use").toEqual([]);
  });

  it("keeps ws maxPayload at or above the highest size the panel will accept", () => {
    // maxPayload is read once, when the server socket is built, so it cannot be
    // the live setting. It is the hard ceiling instead -- and if it ever fell
    // below the form's ceiling, the panel would accept a message size `ws`
    // silently refuses with a 1009 nobody would connect to this setting.
    const src = readSrc("ws-server.ts");
    const match = src.match(/const MAX_MESSAGE_BYTES_CEILING = (\d+) \* 1024/);
    expect(match, "the ws maxPayload ceiling moved or was renamed").toBeTruthy();
    expect(Number(match![1])).toBeGreaterThanOrEqual(limitBounds("maxMessageKb")[1]);
  });
});
