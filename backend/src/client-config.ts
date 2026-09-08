// The one thing this server tells the browser about how the game should LOOK.
//
// Everything the client knew until now was either compiled into the bundle or
// arrived over the gameplay socket as room state. There was no channel at all
// for "the operator changed an appearance default", which is why the win and
// futch effects were literal values inside @keyframes: changing a colour meant
// a code edit and a redeploy.
//
// Built as one document rather than a route per setting. The next appearance
// control should be a field here, not a second endpoint -- that is the whole
// reason this exists as its own module instead of being folded into whichever
// feature needed it first.
//
// PUBLIC and unauthenticated. Nothing operator-private may ever be added to
// this record: not access codes, not capacity limits (which would report how
// full the platform is), not counts of anything. If a field would be
// interesting to somebody attacking the server, it belongs behind the admin
// session instead.

/**
 * The win/futch card effects.
 *
 * These are the only non-textual signal that a hand won or busted, so the
 * bounds below are not tidiness -- they are what stops an operator arriving at
 * "no visible difference" by dragging something to its end. See
 * CARD_EFFECT_BOUNDS.
 */
export interface CardEffectsRecord {
  /** Glow colour for a hand that won, as #rrggbb. */
  winColor: string;
  /** Peak of the grow-and-settle, at 55% of the animation. */
  winScalePeak: number;
  /** Where it settles and stays for the rest of the round. */
  winScaleRest: number;
  /** Rim colour for a hand that went over 21, as #rrggbb. */
  futchColor: string;
  /** How far a busted hand shrinks. Below 1, and it stays there. */
  futchScale: number;
  /** How much colour a busted hand keeps. 1 is untouched, 0 is grey. */
  futchSaturate: number;
}

export interface ClientConfigRecord {
  cardEffects: CardEffectsRecord;
  updatedAt: number;
}

// The values that were literals in index.css before this module existed, and
// that are still declared there on :root as the defaults the custom properties
// hold until a fetch replaces them. The duplication is deliberate: a client
// that never reaches this endpoint -- offline, blocked, a cached bundle
// against a dead backend -- must still show a gold win and a red futch rather
// than an unstyled card. If you change one, change both.
export const CARD_EFFECT_DEFAULTS: CardEffectsRecord = {
  winColor: "#e6a44b",
  winScalePeak: 1.07,
  winScaleRest: 1.03,
  futchColor: "#be3c3c",
  futchScale: 0.94,
  futchSaturate: 0.35,
};

/**
 * Floors and ceilings for the numeric fields, in code and not editable.
 *
 * Each end is doing a job:
 *  - winScalePeak's floor keeps the grow visible at all; its ceiling stops a
 *    winning card covering its neighbours (it already lifts above them -- see
 *    `.k-hand > .k-card-win` -- so an unbounded scale hides the hand).
 *  - winScaleRest may sit at 1: settling flush is a legitimate taste, and the
 *    glow still carries the signal.
 *  - futchScale's ceiling keeps the shrink perceptible; its floor stops a
 *    busted hand becoming unreadably small.
 *  - futchSaturate's ceiling keeps some of the cooling. Its floor is 0, full
 *    grey, which is a deliberate choice rather than something you fall into --
 *    but see index.css on why a futched hand must not end up looking like an
 *    Eleveroon reject, which is full grayscale AND no rim.
 */
export const CARD_EFFECT_BOUNDS: Record<string, readonly [number, number]> = {
  winScalePeak: [1.02, 1.2],
  winScaleRest: [1.0, 1.12],
  futchScale: [0.8, 0.98],
  futchSaturate: [0, 0.9],
};

const HEX_SIX = /^#[0-9a-f]{6}$/;
const HEX_THREE = /^#[0-9a-f]{3}$/;

/**
 * Colours are accepted as #rrggbb and nothing else -- not `red`, not
 * `rgb(...)`, not a var().
 *
 * This is the strictest normalizer in the codebase and the reason is where the
 * value ends up: the client writes this string straight into a CSS custom
 * property, and a custom property is not parsed until it is substituted. A
 * permissive parser here would let an admin session author arbitrary CSS on
 * every player's table. Admins are trusted; this costs nothing, and the blast
 * radius if a session is ever stolen is every browser at every table.
 *
 * `#abc` is expanded rather than refused -- it is a colour a person types.
 */
export function normalizeHexColor(raw: unknown, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  let value = raw.trim().toLowerCase();
  if (HEX_THREE.test(value)) {
    value = "#" + value[1] + value[1] + value[2] + value[2] + value[3] + value[3];
  }
  return HEX_SIX.test(value) ? value : fallback;
}

function normalizeNumber(raw: unknown, key: string, fallback: number): number {
  const parsed = typeof raw === "number" ? raw : Number.parseFloat(String(raw ?? ""));
  if (!Number.isFinite(parsed)) return fallback;
  const [min, max] = CARD_EFFECT_BOUNDS[key];
  // Rounded to three places before clamping: these end up in a stylesheet, and
  // a scale of 1.0700000000000003 out of a number input is noise every way you
  // look at it.
  return Math.min(max, Math.max(min, Math.round(parsed * 1000) / 1000));
}

/**
 * Clamps a whole effects record.
 *
 * Out-of-range and unparseable values fall back to that field's default rather
 * than rejecting the submission: a settings form that discards five good
 * fields because the sixth was left empty is worse to operate than one that
 * shows you what it kept.
 */
export function normalizeCardEffects(raw: Partial<CardEffectsRecord> | undefined | null): CardEffectsRecord {
  const src = raw ?? {};
  const effects: CardEffectsRecord = {
    winColor: normalizeHexColor(src.winColor, CARD_EFFECT_DEFAULTS.winColor),
    winScalePeak: normalizeNumber(src.winScalePeak, "winScalePeak", CARD_EFFECT_DEFAULTS.winScalePeak),
    winScaleRest: normalizeNumber(src.winScaleRest, "winScaleRest", CARD_EFFECT_DEFAULTS.winScaleRest),
    futchColor: normalizeHexColor(src.futchColor, CARD_EFFECT_DEFAULTS.futchColor),
    futchScale: normalizeNumber(src.futchScale, "futchScale", CARD_EFFECT_DEFAULTS.futchScale),
    futchSaturate: normalizeNumber(src.futchSaturate, "futchSaturate", CARD_EFFECT_DEFAULTS.futchSaturate),
  };
  // A rest bigger than the peak turns grow-then-settle into shrink-then-grow,
  // which does not read as a flourish, it reads as a rendering fault. Both are
  // in range by this point, so the peak is the one to lift.
  if (effects.winScaleRest > effects.winScalePeak) {
    effects.winScalePeak = effects.winScaleRest;
  }
  return effects;
}

export class ClientConfig {
  private cardEffects: CardEffectsRecord = { ...CARD_EFFECT_DEFAULTS };
  private updatedAt = 0;

  constructor(private readonly onChange?: (record: ClientConfigRecord) => void) {}

  toRecord(): ClientConfigRecord {
    return { cardEffects: { ...this.cardEffects }, updatedAt: this.updatedAt };
  }

  /** True when nothing has been moved off the shipped defaults. */
  isDefault(): boolean {
    return (Object.keys(CARD_EFFECT_DEFAULTS) as (keyof CardEffectsRecord)[]).every(
      (key) => this.cardEffects[key] === CARD_EFFECT_DEFAULTS[key],
    );
  }

  // Boot-time load. Does not fire onChange, for the same reason none of the
  // other settings records do: writing back what was just read would rewrite
  // the row on every restart and move updatedAt for no reason.
  hydrate(record: Partial<ClientConfigRecord> | undefined | null): void {
    if (!record) return;
    this.cardEffects = normalizeCardEffects(record.cardEffects);
    if (typeof record.updatedAt === "number" && Number.isFinite(record.updatedAt)) {
      this.updatedAt = record.updatedAt;
    }
  }

  /** Returns true if anything actually changed, so the caller can report it. */
  setCardEffects(raw: Partial<CardEffectsRecord> | undefined | null): boolean {
    const next = normalizeCardEffects(raw);
    const keys = Object.keys(CARD_EFFECT_DEFAULTS) as (keyof CardEffectsRecord)[];
    if (keys.every((key) => next[key] === this.cardEffects[key])) return false;
    this.cardEffects = next;
    this.updatedAt = Date.now();
    this.onChange?.(this.toRecord());
    return true;
  }

  reset(): boolean {
    return this.setCardEffects({ ...CARD_EFFECT_DEFAULTS });
  }
}
