// What the computer players are called, editable at runtime.
//
// Same shape as RuntimeLimits, AccessControl and AboutContent, for the same
// reasons: a class so tests get isolated instances, an onChange callback so
// persistence stays out of the logic, and hydrate() for boot. Stored in the
// same `settings` key/value row those use, so it needs no schema change --
// this project has no migration tool by design (db.ts).
//
// It exists because both pools were `const` arrays in store.ts, which made
// "call one of them Yossi" a code edit, a rebuild and a deploy. That is the
// wrong operation for a name, and it is the same problem that produced
// access.ts, limits.ts and about.ts.
//
// The banker is a POOL rather than the single "The Gabbai" it used to be,
// asked for directly: the practice dealer wore the same name every table.
// Rotation is per room, picked at creation and fixed for that room's life --
// a banker whose name changed mid-night would read as a different person
// having taken over the table, which is a real thing that can happen here
// (see passBankAfterBankDecision) and must not be faked by a label.

export interface BotNamesRecord {
  banker: string[];
  players: string[];
  updatedAt: number;
}

// A starting point, not a house style -- the whole point of this file is that
// the operator changes them. "The Gabbai" stays first because it is the name
// every practice table has worn until now.
export const DEFAULT_BANKER_NAMES = ["The Gabbai", "The Shammes", "Der Zeide", "The Bubbe", "The Rebbetzin"];

// Ten was the old ceiling and the old length at once: MAX_SEATED_PLAYERS_PER_ROUND
// caps a round's non-banker seats at 11 and the human learner holds one, so ten
// bots is the table's real limit. The pool is no longer required to match it --
// see pickPlayerNames.
export const DEFAULT_PLAYER_NAMES = [
  "Sruly",
  "Shimmy",
  "Shmuely",
  "Nati",
  "Josh",
  "Binyomin",
  "Shlomo",
  "Moshe",
  "Chaim",
  "Meshulam",
];

// Caps, not validation. There is nothing an operator can type here that is
// WRONG, only lengths a nameplate cannot hold and list sizes nothing would
// read. `name` is well under store.ts's MAX_NAME_LEN of 40 on purpose: these
// are rendered onto a seat plate on a phone, where a real player's own name is
// already the thing that overflows first.
export const BOT_NAME_MAX = { name: 24, pool: 60 } as const;

/**
 * One textarea into a clean list of names.
 *
 * Splits on newlines AND commas because both are how people actually paste a
 * list, and asking which one the box wanted is a support question nobody
 * should have to answer. Control characters go for the same reason they go in
 * about.ts -- a paste out of a terminal carries them and they are never
 * intended. Duplicates go case-insensitively: two seats at one table wearing
 * the same name is unreadable on the felt and indistinguishable in the
 * settlement list afterwards.
 */
export function normalizeNameList(raw: unknown): string[] {
  const text =
    typeof raw === "string" ? raw : Array.isArray(raw) ? raw.filter((v) => typeof v === "string").join("\n") : "";
  const seen = new Set<string>();
  const out: string[] = [];
  for (const piece of text.split(/[\n,]/)) {
    const name = piece
      .replace(/[\u0000-\u001F\u007F]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, BOT_NAME_MAX.name);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= BOT_NAME_MAX.pool) break;
  }
  return out;
}

export type BotNamePool = "banker" | "players";

export class BotNames {
  // Empty means "not configured" and the defaults answer instead. Deliberately
  // NOT seeded with the defaults: the difference between "the operator chose
  // this list, which happens to match" and "nobody has touched it" is what
  // lets the panel say so, and what makes clearing the box a working reset.
  private banker: string[] = [];
  private players: string[] = [];
  private updatedAt = 0;

  constructor(private readonly onChange?: (record: BotNamesRecord) => void) {}

  toRecord(): BotNamesRecord {
    return { banker: [...this.banker], players: [...this.players], updatedAt: this.updatedAt };
  }

  isDefault(pool: BotNamePool): boolean {
    return (pool === "banker" ? this.banker : this.players).length === 0;
  }

  /** The list actually in use, custom or built-in. Never empty. */
  bankerNames(): string[] {
    return this.banker.length ? [...this.banker] : [...DEFAULT_BANKER_NAMES];
  }

  playerNames(): string[] {
    return this.players.length ? [...this.players] : [...DEFAULT_PLAYER_NAMES];
  }

  /** What the operator typed, for re-filling the panel's textarea. */
  customText(pool: BotNamePool): string {
    return (pool === "banker" ? this.banker : this.players).join("\n");
  }

  // Boot-time load. Does not fire onChange -- writing back what was just read
  // would rewrite the row on every restart and move updatedAt for nothing.
  // Every field is re-normalized rather than trusted: this is JSON from a
  // database, and a hand-edited row must not put 200KB or 900 seats on a felt.
  hydrate(record: Partial<BotNamesRecord> | undefined | null): void {
    if (!record) return;
    this.banker = normalizeNameList(record.banker);
    this.players = normalizeNameList(record.players);
    if (typeof record.updatedAt === "number" && Number.isFinite(record.updatedAt)) {
      this.updatedAt = record.updatedAt;
    }
  }

  /**
   * Replaces both lists. Returns true if anything actually changed, so a
   * no-op save can say so instead of claiming an edit.
   *
   * An empty box means "use the built-in list", not "no names" -- a pool with
   * nothing in it cannot seat a table, and the operator who cleared the field
   * meant to undo their edit, not to break practice mode.
   */
  set(banker: unknown, players: unknown): boolean {
    const nextBanker = normalizeNameList(banker);
    const nextPlayers = normalizeNameList(players);
    const same =
      nextBanker.length === this.banker.length &&
      nextBanker.every((n, i) => n === this.banker[i]) &&
      nextPlayers.length === this.players.length &&
      nextPlayers.every((n, i) => n === this.players[i]);
    if (same) return false;
    this.banker = nextBanker;
    this.players = nextPlayers;
    this.updatedAt = Date.now();
    this.onChange?.(this.toRecord());
    return true;
  }

  /** One name for this table's banker bot, drawn fresh each room. */
  pickBankerName(): string {
    const pool = this.bankerNames();
    return pool[Math.floor(Math.random() * pool.length)];
  }

  /**
   * `count` distinct names for a practice table's bot seats.
   *
   * The old pool held exactly one name per available seat, so running out was
   * impossible and nothing handled it. An editable list makes it ordinary: an
   * operator who types two names and then asks for eight bots is not making a
   * mistake, they just did not think about it. Numbering the overflow
   * ("Sruly 2") keeps every seat filled and every seat distinguishable, which
   * both matter more than the names being pretty -- a table that quietly deals
   * six bots when eight were asked for is a bug report nobody can explain.
   */
  pickPlayerNames(count: number): string[] {
    const pool = this.playerNames();
    const shuffled = [...pool];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const out: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const base = shuffled[i % shuffled.length];
      const lap = Math.floor(i / shuffled.length);
      out.push(lap === 0 ? base : `${base} ${lap + 1}`);
    }
    return out;
  }
}
