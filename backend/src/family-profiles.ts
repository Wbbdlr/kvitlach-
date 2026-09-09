// A named look, selected by a link, stamped onto a table.
//
// A family opens kvitlach.us/m/dov once; their device remembers it, and any
// table they host is stamped with it so everyone who joins sees the same felt,
// the same print, the same mark on the cards.
//
// THE HOUSE LOOK IS A PROFILE TOO, and that is the whole design. If the shipped
// appearance were "what happens when no profile is set", every read site would
// need a profile-or-default branch, and family mode would be a second code path
// that has to be changed and checked twice -- which rots the first time somebody
// forgets, which is soon. Expressed as HOUSE below, there is no branch to
// forget: every table is on a profile, Dov's is one of them, and every existing
// test exercises the mechanism without being rewritten to.
//
// So: nothing in this codebase should ever ask "is this a family table". It
// should ask which profile is active and read a field off it.
//
// PUBLIC lookup, by slug only, through get() below -- there is deliberately
// no route that lists profiles, because a profile carries a family's surname
// and a directory of them is not something an unauthenticated browser should
// be able to page through.

import { normalizeNameList } from "./bot-names.js";

export interface FamilyProfile {
  /** URL segment, lowercase. The half of kvitlach.us/m/<slug> that varies. */
  slug: string;
  /** Shown in the admin panel and in a crash report. Not shown to players. */
  name: string;
  /** Replaces the lobby's own greeting. Empty means keep the built-in one. */
  greeting: string;
  /** The Hebrew print on the felt. Empty means keep the built-in one. */
  feltPrint: string;
  /** The maker's mark on cards 1, 8 and 12. LATIN ONLY -- see normalizeMark. */
  cardMark: string;
  /** A felt name from frontend/src/theme.ts's FELTS. Empty inherits the house. */
  felt: string;
  /** A chip theme from that same file's CHIPS. Empty inherits the house. */
  chip: string;
  /** Newline or comma separated; empty falls back to the built-in pool. */
  bankerNames: string;
  playerNames: string;
  /**
   * Carried by the link so a family member is not asked to type a code when
   * the platform is gated. NOT a password and not a gate of its own: the real
   * gate is access.ts, and this only saves the typing. See the note on it in
   * the admin editor.
   */
  accessCode: string;
}

export interface FamilyProfilesRecord {
  profiles: FamilyProfile[];
  updatedAt: number;
}

// The shipped look, as profile zero. Every value here is what the app does
// today with no profile anywhere: navy felt, gold chips, the Schlesinger mark,
// and empty strings wherever the client already has its own built-in copy.
export const HOUSE_SLUG = "house";
export const HOUSE: FamilyProfile = {
  slug: HOUSE_SLUG,
  name: "Kvitlach",
  greeting: "",
  feltPrint: "",
  cardMark: "SCHLESINGER",
  felt: "navy",
  chip: "gold",
  bankerNames: "",
  playerNames: "",
  accessCode: "",
};

// Mirrors frontend/src/theme.ts. `listed` there decides whether the felt
// switcher offers it; a profile may name any of them, listed or not, which is
// how two felts are held back for families without anything asking "is this a
// family table". family-profiles.test.ts fails if these lists drift.
export const FELT_NAMES = ["green", "burgundy", "navy", "spruce", "plum"] as const;
export const CHIP_NAMES = ["gold", "ruby", "sapphire", "silver"] as const;

export const MAX = {
  slug: 32,
  name: 40,
  greeting: 80,
  feltPrint: 60, // matches MAX_WATERMARK_LEN in store.ts
  // Generous rather than tight, because the CLIENT is what knows whether a
  // name fits: markSvgBody measures it against the card and shrinks the type
  // to suit. A character cap here would have to assume the widest letter and
  // would then refuse perfectly good narrow names -- "WILLIAMSON" fits where
  // ten W's do not. This is the bound on what is worth storing, not on what
  // will render.
  cardMark: 24,
  accessCode: 40,
} as const;

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

/** Trims, strips control characters, and bounds. Never returns undefined. */
function clean(raw: unknown, max: number): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/\r\n?/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, max);
}

/**
 * Lowercased, and refused unless it is URL-safe on its own.
 *
 * No percent-encoding, no dots, no slashes: this ends up in a path segment and
 * in an admin form, and a slug that needs encoding to be written down is a slug
 * somebody will mistype into a group chat.
 */
export function normalizeSlug(raw: unknown): string {
  const value = clean(raw, MAX.slug).toLowerCase().replace(/\s+/g, "-");
  return SLUG_RE.test(value) ? value : "";
}

/**
 * The card mark is Latin only, and this is a constraint rather than a taste.
 *
 * The mark renders in Cinzel, which this app ships as an ASCII subset with no
 * Hebrew glyphs at all -- Hebrew in this field would draw nothing whatsoever on
 * the card, which a family would discover mid-game rather than at the form. The
 * felt print is the field that takes Hebrew; it renders in Frank Ruhl Libre,
 * whose own unicode-range is Hebrew-only.
 *
 * Uppercased because the mark is set in an inscriptional face and every
 * shipped example is caps; lowercase is legal in the font and simply looks
 * like a mistake at 56px.
 */
export function normalizeMark(raw: unknown): string {
  const value = clean(raw, MAX.cardMark).toUpperCase();
  return /^[\x20-\x7e]*$/.test(value) ? value : "";
}

export function normalizeProfile(raw: Partial<FamilyProfile> | undefined | null): FamilyProfile | undefined {
  const src = raw ?? {};
  const slug = normalizeSlug(src.slug);
  if (!slug || slug === HOUSE_SLUG) return undefined;
  const pick = (value: unknown, allowed: readonly string[], fallback: string) =>
    typeof value === "string" && allowed.includes(value) ? value : fallback;
  return {
    slug,
    name: clean(src.name, MAX.name) || slug,
    greeting: clean(src.greeting, MAX.greeting),
    feltPrint: clean(src.feltPrint, MAX.feltPrint),
    cardMark: normalizeMark(src.cardMark),
    // Empty means "no opinion", NOT navy. A family that names no felt inherits
    // whatever the operator has set as the house look, live, and follows it
    // when it changes. Falling back to HOUSE.felt here instead pinned every
    // family to the SHIPPED colour, so an operator who set a house felt found
    // it reaching everybody except the families -- which is how this was found.
    // An unknown name lands here too: better to inherit than to assert navy.
    felt: pick(src.felt, FELT_NAMES, ""),
    chip: pick(src.chip, CHIP_NAMES, ""),
    // Through the same normalizer the bot-name editor uses, so a profile
    // cannot hold a list the built-in pool would have refused -- and stored
    // as text, one per line, because that is what the form round-trips.
    bankerNames: normalizeNameList(src.bankerNames).join("\n"),
    playerNames: normalizeNameList(src.playerNames).join("\n"),
    accessCode: clean(src.accessCode, MAX.accessCode),
  };
}

export class FamilyProfiles {
  private profiles: FamilyProfile[] = [];
  private updatedAt = 0;

  constructor(private readonly onChange?: (record: FamilyProfilesRecord) => void) {}

  toRecord(): FamilyProfilesRecord {
    return { profiles: this.profiles.map((p) => ({ ...p })), updatedAt: this.updatedAt };
  }

  /** Admin-facing. The public path is get(slug), which takes one at a time. */
  list(): FamilyProfile[] {
    return this.profiles.map((p) => ({ ...p }));
  }

  /**
   * One profile, or the house look.
   *
   * Never undefined, and that is deliberate: a caller holding "the active
   * profile" should never have to decide what to do without one, because that
   * decision is exactly the branch this design exists to remove. An unknown
   * slug is the house look, which is also the right answer for a link somebody
   * mistyped.
   */
  get(slug: unknown): FamilyProfile {
    const wanted = normalizeSlug(slug);
    if (!wanted || wanted === HOUSE_SLUG) return { ...HOUSE };
    return { ...(this.profiles.find((p) => p.slug === wanted) ?? HOUSE) };
  }

  /** True only for a slug that names a real family profile. */
  has(slug: unknown): boolean {
    const wanted = normalizeSlug(slug);
    return Boolean(wanted) && this.profiles.some((p) => p.slug === wanted);
  }

  // Boot-time load. Does not fire onChange, same reasoning as every other
  // settings record here: writing back what was just read would rewrite the
  // row on every restart and move updatedAt for no reason.
  hydrate(record: Partial<FamilyProfilesRecord> | undefined | null): void {
    if (!record || !Array.isArray(record.profiles)) return;
    this.profiles = record.profiles
      .map((p) => normalizeProfile(p))
      .filter((p): p is FamilyProfile => Boolean(p));
    if (typeof record.updatedAt === "number" && Number.isFinite(record.updatedAt)) {
      this.updatedAt = record.updatedAt;
    }
  }

  /** Adds or replaces one profile, keyed by slug. Returns false if unusable. */
  save(raw: Partial<FamilyProfile> | undefined | null): boolean {
    const next = normalizeProfile(raw);
    if (!next) return false;
    const at = this.profiles.findIndex((p) => p.slug === next.slug);
    if (at === -1) this.profiles.push(next);
    else this.profiles[at] = next;
    this.updatedAt = Date.now();
    this.onChange?.(this.toRecord());
    return true;
  }

  remove(slug: unknown): boolean {
    const wanted = normalizeSlug(slug);
    const at = this.profiles.findIndex((p) => p.slug === wanted);
    if (at === -1) return false;
    this.profiles.splice(at, 1);
    this.updatedAt = Date.now();
    this.onChange?.(this.toRecord());
    return true;
  }
}
