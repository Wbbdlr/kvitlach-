// Numbers that can be changed while the server is running.
//
// These began as `const`s in store.ts, which meant throttling a struggling box
// required an edit, a rebuild and a restart -- the same wrong-operation problem
// that produced access.ts. Same shape as AccessControl for that reason: a class
// so tests get isolated instances, an onChange callback so persistence stays
// out of the logic, and hydrate() for boot.
//
// Three groups now, one record: capacity, the protections, and gameplay timing.
// One record rather than three because they share every mechanism that matters
// -- one settings row, one normalizer, one bounds table, one form -- and a
// second class would be that machinery copied for the sake of a word.
//
// THE ONE RULE THIS FILE EXISTS TO ENFORCE: a value here is read AT THE POINT
// OF USE, never captured at module load. A limiter that reads its threshold
// once at boot gives you a panel that reports a new limit and enforces the old
// one -- and because throttles only bite under load, nobody discovers it until
// the night it matters. Every consumer takes the RuntimeLimits instance, not a
// number off it.
//
// NOT here, deliberately:
//  - MAX_SEATED_PLAYERS_PER_ROUND. That 11 is derived from layout.ts's
//    seat-collision maths and pinned by layout.test.ts -- exposing it as a web
//    form would let the felt be broken from a browser, and no amount of load
//    makes that the right lever.
//  - The tracked-IP map caps (MAX_TRACKED_IPS and its siblings). Those bound
//    this process's own memory; they are not policy, and an operator has no
//    way to reason about a good value.
//  - MAX_MONEY and the scrypt parameters. Editable arithmetic bounds and
//    editable password-hashing cost are both ways to silently break something
//    that looks fine.

export type LimitGroup = "capacity" | "protection" | "timing";

export interface LimitsRecord {
  maxRooms: number;
  maxPracticeRooms: number;
  maxPlayersPerRoom: number;
  idleSeatHours: number;

  maxConnectionsPerIp: number;
  maxMessagesPerWindow: number;
  messageWindowSeconds: number;
  maxMessageKb: number;
  maxRoomCreatesPerWindow: number;
  roomCreateWindowSeconds: number;
  maxAdminAttempts: number;
  adminAttemptWindowMinutes: number;

  defaultTurnSeconds: number;
  botThinkMinMs: number;
  botThinkMaxMs: number;
  botBankDecisionMs: number;
  offlineGraceSeconds: number;
  bankerAbandonSeconds: number;
  roomIdleHours: number;
  practiceIdleMinutes: number;
  sessionTtlDays: number;
  auditRetentionDays: number;

  updatedAt: number;
}

// The historical values -- what each of these was as a constant. Changing a
// DEFAULT does not change a running server: whatever is in the settings row
// wins on boot.
export const DEFAULT_LIMITS = {
  maxRooms: 150,
  maxPracticeRooms: 25,
  maxPlayersPerRoom: 100,
  // A day, asked for as "some people still have the app or page running for a
  // while so it thinks the game is still active, we should prob kick them
  // after a day or whatever". Long enough that nothing takes a seat away from
  // somebody who stepped out for the evening and came back.
  idleSeatHours: 24,

  maxConnectionsPerIp: 80,
  maxMessagesPerWindow: 30,
  messageWindowSeconds: 10,
  maxMessageKb: 32,
  maxRoomCreatesPerWindow: 5,
  roomCreateWindowSeconds: 60,
  maxAdminAttempts: 20,
  adminAttemptWindowMinutes: 5,

  defaultTurnSeconds: 60,
  botThinkMinMs: 500,
  botThinkMaxMs: 1200,
  botBankDecisionMs: 3000,
  offlineGraceSeconds: 45,
  bankerAbandonSeconds: 120,
  roomIdleHours: 72,
  practiceIdleMinutes: 30,
  sessionTtlDays: 7,
  auditRetentionDays: 90,
} as const;

export type LimitKey = keyof typeof DEFAULT_LIMITS;

interface LimitMeta {
  group: LimitGroup;
  label: string;
  /** Inclusive floor and ceiling. Fixed in code; the form cannot widen them. */
  bounds: readonly [number, number];
  /** Environment variable read at boot, before the settings row. */
  env: string;
  /**
   * Shown under the field. Reserved for things a naive reading of the label
   * gets WRONG -- when a change takes effect, or which direction is the unsafe
   * one -- not for restating the label in a sentence.
   */
  note?: string;
}

/**
 * One table, so a key cannot exist with a bound but no label, or be renamed in
 * one place and not the other. The admin page renders from this in declaration
 * order, so the order here is the order on screen.
 *
 * On the protection bounds: for a throttle, the ceiling is usually the guard
 * rather than the floor -- a cap set high enough is a cap removed. Where a
 * WINDOW is the field, that reverses: a shorter window with the same count is
 * a higher permitted rate, so those carry a real floor instead.
 */
export const LIMIT_META: Record<LimitKey, LimitMeta> = {
  maxRooms: {
    group: "capacity",
    label: "Max rooms",
    // A typo of 1500 rooms should be refused at the form, not discovered as an
    // OOM at 2am. The floor of 1 exists because 0 rooms is what `closed` mode
    // is for, and a cap of 0 would refuse creation with "room_capacity" -- a
    // confusing way to say something the access gate says clearly.
    bounds: [1, 1000],
    env: "MAX_ROOMS",
  },
  maxPracticeRooms: { group: "capacity", label: "Max practice rooms", bounds: [1, 500], env: "MAX_PRACTICE_ROOMS" },
  maxPlayersPerRoom: { group: "capacity", label: "Max players per room", bounds: [2, 500], env: "MAX_PLAYERS_PER_ROOM" },
  idleSeatHours: {
    group: "capacity",
    label: "Idle seat evicted after (h)",
    // One hour is the floor rather than zero: this control removes people from
    // a table, and a value that evicts anyone who thought for a few minutes is
    // not a setting worth being able to type. The ceiling is 30 days, longer
    // than any room survives its own idle window, so setting it there is how
    // you turn the sweep off without a second switch to get wrong.
    bounds: [1, 720],
    env: "IDLE_SEAT_HOURS",
    note: "Applied at the start of each round, so an empty table sweeps nothing until it deals again.",
  },

  maxConnectionsPerIp: {
    group: "protection",
    label: "Sockets per address",
    // Dozens of players commonly share one home NAT. Was 40 -- too tight for
    // the ~50-person night this app is meant to host.
    bounds: [4, 1000],
    env: "MAX_CONNECTIONS_PER_IP",
    note: "A whole household shares one address. Too low locks out a real table, not an attacker.",
  },
  maxMessagesPerWindow: { group: "protection", label: "Messages per window", bounds: [5, 500], env: "MAX_MESSAGES_PER_WINDOW" },
  messageWindowSeconds: {
    group: "protection",
    label: "Message window (s)",
    bounds: [1, 120],
    env: "MESSAGE_WINDOW_SECONDS",
    note: "Rate is the count above divided by this, so a shorter window is a LOOSER limit, not a tighter one.",
  },
  maxMessageKb: {
    group: "protection",
    label: "Max message size (KB)",
    // `ws` defaults maxPayload to 100 MiB, and the rate limiter counts
    // messages, not bytes -- so an unbounded size is a memory-exhaustion DoS
    // on a public endpoint. The largest legitimate message is a room:create
    // carrying a few short strings.
    bounds: [4, 256],
    env: "MAX_MESSAGE_KB",
  },
  maxRoomCreatesPerWindow: {
    group: "protection",
    label: "Room creates per window",
    bounds: [1, 100],
    env: "MAX_ROOM_CREATES_PER_WINDOW",
    note: "Independent of the message rate above: one socket creating rooms in a loop can exhaust Max rooms without ever tripping it.",
  },
  roomCreateWindowSeconds: { group: "protection", label: "Room-create window (s)", bounds: [10, 3600], env: "ROOM_CREATE_WINDOW_SECONDS" },
  maxAdminAttempts: {
    group: "protection",
    label: "Admin login attempts",
    bounds: [3, 200],
    env: "MAX_ADMIN_ATTEMPTS",
    note: "The brute-force guard on this panel. Raising it is the one change here that weakens the panel itself.",
  },
  adminAttemptWindowMinutes: { group: "protection", label: "Admin attempt window (min)", bounds: [1, 1440], env: "ADMIN_ATTEMPT_WINDOW_MINUTES" },

  defaultTurnSeconds: {
    group: "timing",
    label: "Default turn clock (s)",
    // Matches MIN_TURN_SECONDS/MAX_TURN_SECONDS in store.ts, which bound the
    // per-room setting this is the platform default beneath.
    bounds: [10, 300],
    env: "DEFAULT_TURN_SECONDS",
    note: "Only for rooms that have not set their own. A banker's per-table choice always wins.",
  },
  botThinkMinMs: { group: "timing", label: "Bot think, fastest (ms)", bounds: [0, 10_000], env: "BOT_THINK_MIN_MS" },
  botThinkMaxMs: {
    group: "timing",
    label: "Bot think, slowest (ms)",
    bounds: [0, 20_000],
    env: "BOT_THINK_MAX_MS",
    note: "Below the fastest value, this is ignored and the fastest is used for both.",
  },
  botBankDecisionMs: {
    group: "timing",
    label: "Bot bank decision pause (ms)",
    // The floor is two seconds and is not decoration. This pause was once
    // shared with the think delay above, and at 500-1200ms a "Bank depleted"
    // notice flashed past unread on a real practice table -- the bot ended the
    // round about a second after showing it, and the replenish offer it leads
    // into only appeared once the round was already over. That was measured,
    // not theorised. A value under two seconds is that bug again, so the form
    // cannot reach one.
    bounds: [2000, 30_000],
    env: "BOT_BANK_DECISION_MS",
    note: "Time to READ a prompt, not to consider a card -- which is why it is separate from the think delay and floored at 2s.",
  },
  offlineGraceSeconds: {
    group: "timing",
    label: "Offline grace (s)",
    // How long a disconnection is treated as a blip rather than an absence,
    // for the purpose of being dealt into the next round. Deliberately shorter
    // than a single turn timer: a player inside this window has not missed
    // anything yet.
    bounds: [5, 600],
    env: "OFFLINE_GRACE_SECONDS",
  },
  bankerAbandonSeconds: {
    group: "timing",
    label: "Banker abandoned after (s)",
    // Long enough that a tunnel blip or a phone changing cells does not cost
    // anyone a hand, short enough that a table is not held hostage by a dead
    // battery.
    bounds: [15, 3600],
    env: "BANKER_ABANDON_SECONDS",
  },
  roomIdleHours: {
    group: "timing",
    label: "Room expires after (h)",
    bounds: [1, 720],
    env: "ROOM_IDLE_HOURS",
    note: "Takes effect when a room's timer is next re-armed, on its next activity -- not retroactively on timers already running.",
  },
  practiceIdleMinutes: {
    group: "timing",
    label: "Practice room expires after (min)",
    bounds: [5, 1440],
    env: "PRACTICE_IDLE_MINUTES",
    note: "Same re-arm rule as above. Practice tables are throwaway, single-human sessions.",
  },
  auditRetentionDays: {
    group: "timing",
    label: "Audit trail kept for (days)",
    // Decided up front rather than left to grow, because these rows carry
    // player identifiers and amounts: a trail with no expiry is personal data
    // accumulating for a purpose that expired months ago. Ninety days covers
    // "what happened at the Chanukah game" asked in February, which is the
    // real question this answers. The Privacy page states this window; if the
    // ceiling here moves, that page moves in the same commit.
    bounds: [7, 365],
    env: "AUDIT_RETENTION_DAYS",
    note: "Older entries are deleted permanently. The Privacy page tells players this window, so a change here is a change there.",
  },
  sessionTtlDays: {
    group: "timing",
    label: "Session lifetime (days)",
    bounds: [1, 90],
    env: "SESSION_TTL_DAYS",
    note: "Applies to sessions issued AFTER the change. Ones already handed out keep the lifetime they were given.",
  },
};

export const LIMIT_KEYS: readonly LimitKey[] = Object.keys(LIMIT_META) as LimitKey[];

/** Heading and one line of orientation per group, for the panel. */
export const LIMIT_GROUPS: readonly { id: LimitGroup; title: string; blurb: string }[] = [
  { id: "capacity", title: "Capacity", blurb: "How much this box will take on before it starts refusing." },
  {
    id: "protection",
    title: "Protections",
    blurb:
      "The throttles that absorb abuse. Every one of these is enforced at the moment it is checked, not read at startup -- what is in the box is what is running. See the protections page for what they are currently absorbing.",
  },
  {
    id: "timing",
    title: "Gameplay timing",
    blurb: "Pacing an operator would want to tune after one game night. Read the notes: two of these do not apply retroactively.",
  },
];

export function limitsInGroup(group: LimitGroup): LimitKey[] {
  return LIMIT_KEYS.filter((key) => LIMIT_META[key].group === group);
}

export function isLimitKey(value: unknown): value is LimitKey {
  return typeof value === "string" && (LIMIT_KEYS as readonly string[]).includes(value);
}

/** Clamps to the key's bounds; returns undefined for anything not a whole number. */
export function normalizeLimit(key: LimitKey, raw: unknown): number | undefined {
  // An empty string has to be rejected explicitly: Number("") is 0, which is
  // a perfectly good integer, so a blank form field would otherwise clamp the
  // cap to its minimum instead of being ignored.
  if (typeof raw === "string" && raw.trim() === "") return undefined;
  const value = typeof raw === "string" ? Number(raw.trim()) : raw;
  if (typeof value !== "number" || !Number.isInteger(value)) return undefined;
  const [min, max] = LIMIT_META[key].bounds;
  return Math.min(Math.max(value, min), max);
}

export function limitBounds(key: LimitKey): readonly [number, number] {
  return LIMIT_META[key].bounds;
}

export class RuntimeLimits {
  private values: Record<LimitKey, number> = { ...DEFAULT_LIMITS };
  private updatedAt = Date.now();

  constructor(private readonly onChange?: (record: LimitsRecord) => void) {}

  get maxRooms(): number {
    return this.values.maxRooms;
  }

  get maxPracticeRooms(): number {
    return this.values.maxPracticeRooms;
  }

  get maxPlayersPerRoom(): number {
    return this.values.maxPlayersPerRoom;
  }

  /**
   * How long a seat may sit without its player doing anything, in ms.
   *
   * A getter in ms rather than the raw hours, because every caller wants a
   * duration to compare a timestamp against and none of them wants to remember
   * the conversion. The setting is in hours because that is the unit an
   * operator thinks in. Every duration below follows the same rule.
   */
  get idleSeatMs(): number {
    return this.values.idleSeatHours * 60 * 60_000;
  }

  get maxConnectionsPerIp(): number {
    return this.values.maxConnectionsPerIp;
  }

  get maxMessagesPerWindow(): number {
    return this.values.maxMessagesPerWindow;
  }

  get messageWindowMs(): number {
    return this.values.messageWindowSeconds * 1000;
  }

  get maxMessageBytes(): number {
    return this.values.maxMessageKb * 1024;
  }

  get maxRoomCreatesPerWindow(): number {
    return this.values.maxRoomCreatesPerWindow;
  }

  get roomCreateWindowMs(): number {
    return this.values.roomCreateWindowSeconds * 1000;
  }

  get maxAdminAttempts(): number {
    return this.values.maxAdminAttempts;
  }

  get adminAttemptWindowMs(): number {
    return this.values.adminAttemptWindowMinutes * 60_000;
  }

  get defaultTurnSeconds(): number {
    return this.values.defaultTurnSeconds;
  }

  get botThinkMinMs(): number {
    return this.values.botThinkMinMs;
  }

  /**
   * Never below the fastest value.
   *
   * Resolved on read rather than corrected on write, so the stored pair is
   * always exactly what the operator typed and a later edit to the fastest
   * value cannot silently strand the slowest one at a number nothing chose.
   * The range is then always valid however the two were entered.
   */
  get botThinkMaxMs(): number {
    return Math.max(this.values.botThinkMinMs, this.values.botThinkMaxMs);
  }

  get botBankDecisionMs(): number {
    return this.values.botBankDecisionMs;
  }

  get offlineGraceMs(): number {
    return this.values.offlineGraceSeconds * 1000;
  }

  get bankerAbandonMs(): number {
    return this.values.bankerAbandonSeconds * 1000;
  }

  get roomIdleMs(): number {
    return this.values.roomIdleHours * 60 * 60_000;
  }

  get practiceIdleMs(): number {
    return this.values.practiceIdleMinutes * 60_000;
  }

  get sessionTtlMs(): number {
    return this.values.sessionTtlDays * 24 * 60 * 60_000;
  }

  get auditRetentionDays(): number {
    return this.values.auditRetentionDays;
  }

  get(key: LimitKey): number {
    return this.values[key];
  }

  isDefault(key: LimitKey): boolean {
    return this.values[key] === DEFAULT_LIMITS[key];
  }

  toRecord(): LimitsRecord {
    return { ...this.values, updatedAt: this.updatedAt };
  }

  // Boot-time load. Does not fire onChange, same reasoning as AccessControl.
  // Every value goes through normalizeLimit rather than being trusted: this
  // row is JSON from a database, and a hand-edited or half-written one must
  // not be able to set a cap of NaN, which compares false against everything
  // and silently removes the limit entirely.
  hydrate(record: Partial<LimitsRecord> | undefined | null): void {
    if (!record) return;
    for (const key of LIMIT_KEYS) {
      const value = normalizeLimit(key, record[key]);
      if (value !== undefined) this.values[key] = value;
    }
    if (typeof record.updatedAt === "number") this.updatedAt = record.updatedAt;
  }

  set(key: LimitKey, raw: unknown): boolean {
    const value = normalizeLimit(key, raw);
    if (value === undefined) return false;
    this.values[key] = value;
    this.updatedAt = Date.now();
    this.onChange?.(this.toRecord());
    return true;
  }

  resetToDefaults(): void {
    this.values = { ...DEFAULT_LIMITS };
    this.updatedAt = Date.now();
    this.onChange?.(this.toRecord());
  }
}

export function limitsFromEnv(env: NodeJS.ProcessEnv = process.env): Partial<LimitsRecord> {
  const out: Partial<LimitsRecord> = {};
  for (const key of LIMIT_KEYS) {
    const value = normalizeLimit(key, env[LIMIT_META[key].env]);
    if (value !== undefined) out[key] = value;
  }
  return out;
}
