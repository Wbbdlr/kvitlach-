// Who is allowed onto the platform right now.
//
// Two different emergencies wanted the same lever and neither was served by
// the one that existed. `MAINTENANCE_MODE=true` (an env var read inline in
// ws-server.ts) could only be changed by editing compose and restarting the
// container -- which is exactly the wrong operation when the reason you are
// reaching for it is that the box is already struggling. And it only ever
// gated room creation, so it could not answer "let only these people play".
//
// So: a mode plus a set of codes, both changeable at runtime from the
// token-gated admin page, and both persisted so a restart cannot quietly
// fling the doors back open. That last part matters more than it sounds --
// if you locked down because of load, the most likely next event is a
// restart.
//
// Deliberately NOT a per-person allowlist: the platform has no accounts. A
// player is a name typed into a box and a per-room session token, so there
// is no identity to put on a list. A shared code is the only "certain
// people" this data model can actually express, and pretending otherwise
// would be security theatre.
//
// A class, not module-level mutable state, so tests get isolated instances
// (same reasoning as Metrics).

export type AccessMode = "open" | "invite" | "closed";

// The three ways onto the platform. `resume` is absent on purpose -- see
// assertAllowed's comment.
export type GatedAction = "create" | "join" | "practice";

export interface AccessSnapshot {
  mode: AccessMode;
  // The codes themselves are never handed out, not even to the admin page's
  // own renderer -- it re-reads them separately. A count is enough for
  // /health/detail and /metrics to be useful without publishing secrets.
  codeCount: number;
  updatedAt: number;
}

export interface AccessRecord {
  mode: AccessMode;
  codes: string[];
  updatedAt: number;
}

const MODES: readonly AccessMode[] = ["open", "invite", "closed"];
const MAX_CODES = 200;
const MAX_CODE_LEN = 64;

export function isAccessMode(value: unknown): value is AccessMode {
  return typeof value === "string" && (MODES as readonly string[]).includes(value);
}

// Codes are compared byte-for-byte after this, so the normalisation has to
// happen on the way in on BOTH sides -- here for storage, and again for
// whatever a player types. Trimming and case-folding because these get read
// down a phone line and typed by hand; a code that fails because someone's
// keyboard capitalised the first letter is a support call, not security.
export function normalizeCode(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

export function parseCodeList(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  const seen = new Set<string>();
  for (const part of raw.split(/[\n,]/)) {
    const code = normalizeCode(part);
    if (code && code.length <= MAX_CODE_LEN) seen.add(code);
    if (seen.size >= MAX_CODES) break;
  }
  return [...seen];
}

export class AccessControl {
  private mode: AccessMode = "open";
  private codes: string[] = [];
  private updatedAt = Date.now();

  // Called after every successful change so the caller can persist. Kept as
  // a callback rather than a Database reference so this file stays pure and
  // testable, and so a deploy with no DATABASE_URL simply passes nothing.
  constructor(private readonly onChange?: (record: AccessRecord) => void) {}

  getMode(): AccessMode {
    return this.mode;
  }

  snapshot(): AccessSnapshot {
    return { mode: this.mode, codeCount: this.codes.length, updatedAt: this.updatedAt };
  }

  toRecord(): AccessRecord {
    return { mode: this.mode, codes: [...this.codes], updatedAt: this.updatedAt };
  }

  // Boot-time load from storage. Does NOT fire onChange -- this is reading
  // back what was already persisted, and writing it straight out again would
  // just be a pointless round trip on every startup.
  hydrate(record: Partial<AccessRecord> | undefined | null): void {
    if (!record) return;
    if (isAccessMode(record.mode)) this.mode = record.mode;
    if (Array.isArray(record.codes)) {
      this.codes = record.codes.map(normalizeCode).filter(Boolean).slice(0, MAX_CODES);
    }
    if (typeof record.updatedAt === "number") this.updatedAt = record.updatedAt;
  }

  setMode(mode: AccessMode): void {
    this.mode = mode;
    this.touch();
  }

  setCodes(codes: string[]): void {
    const seen = new Set<string>();
    for (const c of codes) {
      const code = normalizeCode(c);
      if (code && code.length <= MAX_CODE_LEN) seen.add(code);
      if (seen.size >= MAX_CODES) break;
    }
    this.codes = [...seen];
    this.touch();
  }

  // Compares against every code without short-circuiting. A `.some()` here
  // would leak, through timing, how far down the list a guess got -- which
  // with a handful of family codes is close to leaking a prefix. Cheap to do
  // properly at this list size, so do it properly.
  hasCode(raw: unknown): boolean {
    const given = normalizeCode(raw);
    if (!given) return false;
    let matched = false;
    for (const code of this.codes) {
      matched = constantTimeEquals(given, code) || matched;
    }
    return matched;
  }

  // Throws the same bare snake_case codes every other backend refusal uses,
  // so ws-server forwards them and errorCopy.ts turns them into sentences.
  //
  // `room:resume` never comes through here, and that is the single most
  // important rule in this file. Resume is how a player who is ALREADY
  // seated at a live table gets back after a dropped connection, a locked
  // phone, or a browser reload. Gating it would mean flipping the lockdown
  // switch silently ejects everyone mid-hand the moment their connection
  // blinks -- turning "stop new load" into "destroy the games in progress".
  // Lockdown closes the door; it does not empty the building.
  assertAllowed(action: GatedAction, code?: unknown): void {
    if (this.mode === "open") return;
    if (this.mode === "closed") throw new Error("locked_down");
    // invite
    const given = normalizeCode(code);
    if (!given) throw new Error("invite_required");
    if (!this.hasCode(given)) throw new Error("invalid_invite");
    void action;
  }

  private touch(): void {
    this.updatedAt = Date.now();
    this.onChange?.(this.toRecord());
  }
}

// Length is not secret here (the code is typed by a human into a visible
// field, and its length is observable from the form anyway), but the
// contents are, so a mismatch still walks the full shorter string rather
// than returning at the first differing byte.
function constantTimeEquals(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// Boot defaults, overridden by anything found in storage.
//
// MAINTENANCE_MODE is still honoured: it is documented, it may be sitting in
// a compose file on the server right now, and silently ignoring it would
// mean a deploy that believed it was closed quietly reopening. It maps to
// `closed`, which is a superset of what it used to do (it gated creation;
// closed gates creation, joining and practice).
export function accessFromEnv(env: NodeJS.ProcessEnv = process.env): AccessRecord {
  const mode: AccessMode = isAccessMode(env.ACCESS_MODE)
    ? env.ACCESS_MODE
    : env.MAINTENANCE_MODE === "true"
      ? "closed"
      : "open";
  return { mode, codes: parseCodeList(env.ACCESS_CODES), updatedAt: Date.now() };
}
