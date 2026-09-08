// Render errors that happened in somebody's browser, kept where an operator
// can read them.
//
// Until now a crash in the app reached console.error on the player's phone and
// nowhere else. That is why the control-bar crash stayed unreproduced through
// roughly 150 synthetic drags: the one artifact that would have identified it
// lived on a device nobody could open. A player says "it went white again" and
// there is nothing to look at.
//
// In memory only, and deliberately so. These are debugging breadcrumbs with a
// short useful life, not records: a restart clearing them costs nothing, and
// putting player-submitted text in Postgres turns an unauthenticated write
// endpoint into unbounded storage. The ring below is the entire retention
// policy.

/** What the browser sends. Every field is untrusted and is clamped on arrival. */
export interface ClientErrorReport {
  message: string;
  /** Where in the app it happened -- the route path, not a full URL. */
  route?: string;
  /** APP_VERSION from the build that crashed, so a stale tab is obvious. */
  version?: string;
  /** React's component stack, or the error's own, whichever the sender had. */
  stack?: string;
  userAgent?: string;
}

export interface StoredClientError extends ClientErrorReport {
  at: number;
  ip: string;
  /** How many times this exact message has arrived since it was first seen. */
  count: number;
}

// One screenful of distinct failures is what an operator can actually act on,
// and a bigger ring mostly stores older copies of the same bug.
const MAX_REPORTS = 50;
const MAX_MESSAGE_LEN = 500;
const MAX_STACK_LEN = 4000;
const MAX_ROUTE_LEN = 200;
const MAX_VERSION_LEN = 20;
const MAX_UA_LEN = 300;

// Per-IP throttle. A crash loop is the normal case here, not an attack: a
// component that throws on every render will post as fast as React can
// re-render it, and one broken phone must not be able to push every other
// report out of the ring.
const REPORT_WINDOW_MS = 60_000;
const MAX_REPORTS_PER_WINDOW = 5;
const MAX_TRACKED_IPS = 500;

const clamp = (value: unknown, max: number): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  // Control characters stripped rather than escaped: this text is rendered by
  // the admin page (through escapeHtml, so markup is already inert) and read
  // in a terminal, and a raw \r or an ANSI escape in either is somebody else's
  // problem to have avoided.
  return trimmed.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, max);
};

export class ClientErrorLog {
  private reports: StoredClientError[] = [];
  private byIp = new Map<string, { count: number; resetAt: number }>();
  private droppedToThrottle = 0;

  /**
   * Records one report. Returns false when the throttle refused it.
   *
   * Repeats of the same message bump a counter on the existing entry instead
   * of taking another slot -- the ring holds distinct failures, which is what
   * an operator reads, and "42 times" is more useful than 42 rows anyway.
   */
  record(raw: unknown, ip: string): boolean {
    if (this.throttled(ip)) {
      this.droppedToThrottle += 1;
      return false;
    }
    const body = (raw ?? {}) as Record<string, unknown>;
    const message = clamp(body.message, MAX_MESSAGE_LEN);
    if (!message) return false;

    const existing = this.reports.find((r) => r.message === message);
    if (existing) {
      existing.count += 1;
      existing.at = Date.now();
      return true;
    }

    this.reports.unshift({
      message,
      route: clamp(body.route, MAX_ROUTE_LEN),
      version: clamp(body.version, MAX_VERSION_LEN),
      stack: clamp(body.stack, MAX_STACK_LEN),
      userAgent: clamp(body.userAgent, MAX_UA_LEN),
      at: Date.now(),
      ip,
      count: 1,
    });
    if (this.reports.length > MAX_REPORTS) this.reports.length = MAX_REPORTS;
    return true;
  }

  private throttled(ip: string): boolean {
    const now = Date.now();
    const entry = this.byIp.get(ip);
    if (!entry || now > entry.resetAt) {
      // Bounded the same way the admin-login tracker and the room-creation
      // throttle are, and for the same reason: a rotating address defeats a
      // per-IP limit regardless, so the cap is about not letting a public
      // endpoint spend unbounded memory rather than about stopping rotation.
      if (this.byIp.size >= MAX_TRACKED_IPS && !this.byIp.has(ip)) {
        let oldestKey: string | undefined;
        let oldestAt = Infinity;
        for (const [key, e] of this.byIp) {
          if (e.resetAt < oldestAt) {
            oldestAt = e.resetAt;
            oldestKey = key;
          }
        }
        if (oldestKey !== undefined) this.byIp.delete(oldestKey);
      }
      this.byIp.set(ip, { count: 1, resetAt: now + REPORT_WINDOW_MS });
      return false;
    }
    entry.count += 1;
    return entry.count > MAX_REPORTS_PER_WINDOW;
  }

  list(): StoredClientError[] {
    return [...this.reports];
  }

  snapshot() {
    return {
      reports: this.list(),
      dropped: this.droppedToThrottle,
      limit: MAX_REPORTS_PER_WINDOW,
      windowMs: REPORT_WINDOW_MS,
      capacity: MAX_REPORTS,
    };
  }

  clear(): number {
    const n = this.reports.length;
    this.reports = [];
    this.droppedToThrottle = 0;
    return n;
  }
}
