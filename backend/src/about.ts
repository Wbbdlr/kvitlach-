// Operator-authored text for the public About page -- the beta-tester credits
// and anything else the banker wants to thank people for.
//
// Same shape as RuntimeLimits and AccessControl, for the same reason: a class
// so tests get isolated instances, an onChange callback so persistence stays
// out of the logic, and hydrate() for boot. It is stored in the same `settings`
// key/value row those two use, so it needs no schema change -- this project has
// no migration tool by design (db.ts).
//
// It exists at all because the alternative is editing About.tsx and shipping a
// build to add a name to a thank-you list, which is the same wrong-operation
// problem that produced access.ts and limits.ts.

export interface AboutRecord {
  heading: string;
  body: string;
  updatedAt: number;
}

// Caps, not validation. There is nothing an operator can type that is WRONG
// here, only amounts that are unreasonable -- so the limits exist to bound what
// a public page renders and what a settings row stores, not to police wording.
export const ABOUT_MAX = { heading: 120, body: 8000 } as const;

/**
 * Trims, bounds, and strips anything that is not text.
 *
 * Control characters go because this string is rendered into a page and read
 * out of a database; a stray NUL or an ANSI escape in a credits list is never
 * intentional and is exactly what a paste from a terminal carries. Newlines and
 * tabs survive -- they are the only formatting this field has. CRLF collapses
 * so a Windows paste does not double every paragraph break downstream.
 *
 * What it deliberately does NOT do is escape HTML. Escaping here would be a
 * guess about the renderer; the renderer's job is to render text AS text, which
 * About.tsx does by splitting on blank lines into <p> elements rather than
 * assigning innerHTML. Sanitising on the way in and trusting on the way out is
 * how a stored-XSS hole gets built one refactor later.
 */
export function normalizeAboutText(raw: unknown, max: number): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, max);
}

export class AboutContent {
  private heading = "";
  private body = "";
  private updatedAt = 0;

  constructor(private readonly onChange?: (record: AboutRecord) => void) {}

  toRecord(): AboutRecord {
    return { heading: this.heading, body: this.body, updatedAt: this.updatedAt };
  }

  /** Nothing to show: About.tsx renders its built-in copy and no extra section. */
  isEmpty(): boolean {
    return this.heading === "" && this.body === "";
  }

  // Boot-time load. Does not fire onChange -- writing back what was just read
  // would rewrite the row on every restart and move updatedAt for no reason.
  // Every field is re-normalized rather than trusted: this is JSON from a
  // database, and a hand-edited row must not be able to put 200KB or a control
  // character onto a public page.
  hydrate(record: Partial<AboutRecord> | undefined | null): void {
    if (!record) return;
    this.heading = normalizeAboutText(record.heading, ABOUT_MAX.heading);
    this.body = normalizeAboutText(record.body, ABOUT_MAX.body);
    if (typeof record.updatedAt === "number" && Number.isFinite(record.updatedAt)) {
      this.updatedAt = record.updatedAt;
    }
  }

  /** Returns true if anything actually changed, so the caller can report it. */
  set(heading: unknown, body: unknown): boolean {
    const nextHeading = normalizeAboutText(heading, ABOUT_MAX.heading);
    const nextBody = normalizeAboutText(body, ABOUT_MAX.body);
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
