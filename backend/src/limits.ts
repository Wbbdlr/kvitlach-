// Capacity caps that can be changed while the server is running.
//
// These were `const`s in store.ts, which meant throttling a struggling box
// required an edit, a rebuild and a restart -- the same wrong-operation
// problem that produced access.ts. Same shape as AccessControl for that
// reason: a class so tests get isolated instances, an onChange callback so
// persistence stays out of the logic, and hydrate() for boot.
//
// NOT here, deliberately: MAX_SEATED_PLAYERS_PER_ROUND. That 11 is derived
// from layout.ts's seat-collision maths and pinned by layout.test.ts --
// exposing it as a web form would let the felt be broken from a browser, and
// no amount of load makes that the right lever. If capacity is the problem,
// the caps below are the ones that help.

export interface LimitsRecord {
  maxRooms: number;
  maxPracticeRooms: number;
  maxPlayersPerRoom: number;
  updatedAt: number;
}

// The historical values. Changing a DEFAULT does not change a running
// server -- whatever is in the settings row wins on boot.
export const DEFAULT_LIMITS = {
  maxRooms: 150,
  maxPracticeRooms: 25,
  maxPlayersPerRoom: 100,
} as const;

// Upper bounds on what the admin page will accept. A typo of 1500 rooms
// should be refused at the form, not discovered as an OOM at 2am; the floor
// of 1 exists because 0 rooms is what `closed` mode is for, and a cap of 0
// would refuse creation with "room_capacity" -- a confusing way to say
// something the access gate says clearly.
const BOUNDS = {
  maxRooms: [1, 1000],
  maxPracticeRooms: [1, 500],
  maxPlayersPerRoom: [2, 500],
} as const;

export type LimitKey = keyof typeof DEFAULT_LIMITS;

export const LIMIT_KEYS: readonly LimitKey[] = ["maxRooms", "maxPracticeRooms", "maxPlayersPerRoom"];

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
  const [min, max] = BOUNDS[key];
  return Math.min(Math.max(value, min), max);
}

export function limitBounds(key: LimitKey): readonly [number, number] {
  return BOUNDS[key];
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
  const fromEnv: Record<LimitKey, string | undefined> = {
    maxRooms: env.MAX_ROOMS,
    maxPracticeRooms: env.MAX_PRACTICE_ROOMS,
    maxPlayersPerRoom: env.MAX_PLAYERS_PER_ROOM,
  };
  for (const key of LIMIT_KEYS) {
    const value = normalizeLimit(key, fromEnv[key]);
    if (value !== undefined) out[key] = value;
  }
  return out;
}
