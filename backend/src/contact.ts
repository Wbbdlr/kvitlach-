// Operator-authored text for the public Contact page -- a note appended below
// the built-in copy (closed for the holiday, a different reply-time estimate,
// whatever the operator wants to say without shipping a build).
//
// Same shape as AboutContent, deliberately not shared with it: this project's
// own convention (see AboutContent's own comment, and RuntimeLimits/
// AccessControl before it) is a small class per concept rather than one
// generic base, so each gets isolated instances in tests and there is nothing
// to disentangle when one field's rules diverge from another's later.

export interface ContactRecord {
  heading: string;
  body: string;
  updatedAt: number;
}

// Same caps as About. There is nothing an operator can type that is WRONG
// here, only amounts that are unreasonable -- so the limits exist to bound
// what a public page renders and what a settings row stores, not to police
// wording.
export const CONTACT_MAX = { heading: 120, body: 8000 } as const;

/**
 * Trims, bounds, and strips anything that is not text. See AboutContent's
 * `normalizeAboutText` for the full reasoning -- this is the same function,
 * kept as its own copy rather than a shared import for the same isolation
 * reason the class itself is not shared.
 *
 * What it deliberately does NOT do is escape HTML: escaping here would be a
 * guess about the renderer, and Contact.tsx renders text as text.
 */
export function normalizeContactText(raw: unknown, max: number): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, max);
}

export class ContactContent {
  private heading = "";
  private body = "";
  private updatedAt = 0;

  constructor(private readonly onChange?: (record: ContactRecord) => void) {}

  toRecord(): ContactRecord {
    return { heading: this.heading, body: this.body, updatedAt: this.updatedAt };
  }

  /** Nothing to show: Contact.tsx renders its built-in copy and no extra section. */
  isEmpty(): boolean {
    return this.heading === "" && this.body === "";
  }

  // Boot-time load. Does not fire onChange -- writing back what was just read
  // would rewrite the row on every restart and move updatedAt for no reason.
  hydrate(record: Partial<ContactRecord> | undefined | null): void {
    if (!record) return;
    this.heading = normalizeContactText(record.heading, CONTACT_MAX.heading);
    this.body = normalizeContactText(record.body, CONTACT_MAX.body);
    if (typeof record.updatedAt === "number" && Number.isFinite(record.updatedAt)) {
      this.updatedAt = record.updatedAt;
    }
  }

  /** Returns true if anything actually changed, so the caller can report it. */
  set(heading: unknown, body: unknown): boolean {
    const nextHeading = normalizeContactText(heading, CONTACT_MAX.heading);
    const nextBody = normalizeContactText(body, CONTACT_MAX.body);
    if (nextHeading === this.heading && nextBody === this.body) return false;
    this.heading = nextHeading;
    this.body = nextBody;
    this.updatedAt = Date.now();
    this.onChange?.(this.toRecord());
    return true;
  }

  clear(): boolean {
    return this.set("", "");
  }
}
