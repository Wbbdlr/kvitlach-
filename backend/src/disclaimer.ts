// Operator-authored overrides for the public Disclaimer page's six legal
// sections -- asked for as a SAFER shape than About/Contact's one free-text
// field: this page carries the no-gambling, liability and ownership language,
// and a single textarea with no version history is how an admin fat-fingers a
// warning out of existence with nothing to catch it.
//
// So each section is its own field, keyed by a fixed slug, and there is no
// route to add, remove or rename a section -- only to override or clear one
// section's BODY. The heading (what the section is ABOUT) always comes from
// Disclaimer.tsx, never from a settings row, so the topic list itself can
// never drift out from under an operator typing into a form. An empty
// override means exactly what AboutContent's isEmpty() means: the page shows
// its built-in wording for that section and nothing here overrides it.
//
// Same "small class, not a shared generic" convention as AboutContent /
// ContactContent / RuntimeLimits / AccessControl -- see AboutContent's own
// comment for why.

export const DISCLAIMER_SLUGS = [
  "gambling",
  "responsibility",
  "warranties",
  "liability",
  "ownership",
  "development",
] as const;

export type DisclaimerSlug = (typeof DISCLAIMER_SLUGS)[number];

// The heading is fixed and lives here, not in a settings row -- it is the
// one thing an override must never be able to change. Kept in sync with
// Disclaimer.tsx's own <h2> text by hand; DISCLAIMER_SLUGS is what the admin
// page and the routes actually iterate, so a slug typo fails loudly (an
// unknown slug is simply rejected) rather than silently landing nowhere.
export const DISCLAIMER_HEADINGS: Record<DisclaimerSlug, string> = {
  gambling: "No gambling, no real money",
  responsibility: "Player responsibility",
  warranties: "No warranties or guarantees",
  liability: "Liability",
  ownership: "Ownership",
  development: "Still in development",
};

export function isDisclaimerSlug(value: unknown): value is DisclaimerSlug {
  return typeof value === "string" && (DISCLAIMER_SLUGS as readonly string[]).includes(value);
}

export interface DisclaimerSectionRecord {
  body: string;
  updatedAt: number;
}

export type DisclaimerRecord = Record<DisclaimerSlug, DisclaimerSectionRecord>;

// Shorter than About/Contact's 8000: this replaces a handful of bullet
// points, not a growing credits list.
export const DISCLAIMER_MAX = { body: 4000 } as const;

/**
 * Trims, bounds, and strips anything that is not text. See AboutContent's
 * `normalizeAboutText` for the full reasoning -- same function, own copy,
 * same isolation reason the class itself is not shared. Does NOT escape
 * HTML for the same reason: Disclaimer.tsx renders an override as text, the
 * same way it renders its own built-in bullets, never as innerHTML.
 */
export function normalizeDisclaimerText(raw: unknown, max: number): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, max);
}

function emptySections(): DisclaimerRecord {
  const record = {} as DisclaimerRecord;
  for (const slug of DISCLAIMER_SLUGS) record[slug] = { body: "", updatedAt: 0 };
  return record;
}

export class DisclaimerContent {
  private sections: DisclaimerRecord = emptySections();

  constructor(private readonly onChange?: (record: DisclaimerRecord) => void) {}

  toRecord(): DisclaimerRecord {
    // Shallow-copied per section so a caller cannot mutate internal state
    // through the returned object -- AboutContent's toRecord has nothing to
    // copy (its fields are primitives); this one does.
    const out = {} as DisclaimerRecord;
    for (const slug of DISCLAIMER_SLUGS) out[slug] = { ...this.sections[slug] };
    return out;
  }

  /** True when NO section has an override -- the whole page is its built-in copy. */
  isEmpty(): boolean {
    return DISCLAIMER_SLUGS.every((slug) => this.sections[slug].body === "");
  }

  // Boot-time load. Does not fire onChange, for the same reason AboutContent's
  // doesn't: replaying what was just read would rewrite the row and move
  // updatedAt on every restart. Unknown keys in a hand-edited row are simply
  // ignored rather than throwing -- this is JSON out of a database, not a
  // trusted caller.
  hydrate(record: Partial<Record<string, Partial<DisclaimerSectionRecord>>> | undefined | null): void {
    if (!record) return;
    for (const slug of DISCLAIMER_SLUGS) {
      const entry = record[slug];
      if (!entry) continue;
      const body = normalizeDisclaimerText(entry.body, DISCLAIMER_MAX.body);
      const updatedAt = typeof entry.updatedAt === "number" && Number.isFinite(entry.updatedAt) ? entry.updatedAt : 0;
      this.sections[slug] = { body, updatedAt };
    }
  }

  /**
   * Overrides one section's body. Returns false (and changes nothing) for an
   * unrecognised slug -- there is no section this class does not already
   * know about, so an unknown slug is a caller bug or a tampered form field,
   * not a new section to create on the fly.
   */
  set(slug: unknown, body: unknown): boolean {
    if (!isDisclaimerSlug(slug)) return false;
    const nextBody = normalizeDisclaimerText(body, DISCLAIMER_MAX.body);
    if (nextBody === this.sections[slug].body) return false;
    this.sections[slug] = { body: nextBody, updatedAt: Date.now() };
    this.onChange?.(this.toRecord());
    return true;
  }

  clear(slug: unknown): boolean {
    return this.set(slug, "");
  }
}
