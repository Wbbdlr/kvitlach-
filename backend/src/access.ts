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

// Each way in is gated separately. One mode for all three could not express
// the thing actually wanted most often -- "anyone can join a table, but only
// I can start one" -- because creating and joining shared a single switch.
export type ActionMode = "open" | "code" | "closed";

// The three ways onto the platform. `resume` is absent on purpose -- see
// assertAllowed's comment.
export type GatedAction = "create" | "join" | "practice";

export const GATED_ACTIONS: readonly GatedAction[] = ["create", "join", "practice"];

// The presets, kept as a named type because they are what /health/detail
// publishes, what ACCESS_MODE sets, and what the admin page's one-click
// buttons apply. `custom` is not settable -- it is what summarize() reports
// when the three actions disagree.
export type AccessMode = "open" | "invite" | "closed" | "custom";

export type ActionModes = Record<GatedAction, ActionMode>;

export interface AccessSnapshot {
  mode: AccessMode;
  modes: ActionModes;
  // The codes themselves are never handed out, not even to the admin page's
  // own renderer -- it re-reads them separately. A count is enough for
  // /health/detail and /metrics to be useful without publishing secrets.
  codeCount: number;
  updatedAt: number;
}

export interface AccessRecord {
  modes: ActionModes;
  codes: string[];
  updatedAt: number;
  // Written alongside `modes` purely so a rollback to the single-mode build
  // reads something sane out of the settings row instead of defaulting to
  // wide open. Never read by this build; delete it a release after nobody
  // can roll back that far.
  mode?: AccessMode;
}

const ACTION_MODES: readonly ActionMode[] = ["open", "code", "closed"];
const PRESETS: readonly AccessMode[] = ["open", "invite", "closed"];
const MAX_CODES = 200;
const MAX_CODE_LEN = 64;

export function isActionMode(value: unknown): value is ActionMode {
  return typeof value === "string" && (ACTION_MODES as readonly string[]).includes(value);
}

// Only the three presets are accepted as input; `custom` is an output.
export function isAccessMode(value: unknown): value is AccessMode {
  return typeof value === "string" && (PRESETS as readonly string[]).includes(value);
}

export function expandPreset(mode: AccessMode): ActionModes {
  const action: ActionMode = mode === "open" ? "open" : mode === "closed" ? "closed" : "code";
  return { create: action, join: action, practice: action };
}

// The inverse, for display and for the Kuma monitor that watches this string.
// Anything other than a clean preset reports `custom`, which reads as "not
// fully open" -- correct for a monitor whose job is to notice a restriction
// nobody remembered leaving on.
export function summarize(modes: ActionModes): AccessMode {
  const values = GATED_ACTIONS.map((a) => modes[a]);
  if (values.every((v) => v === "open")) return "open";
  if (values.every((v) => v === "closed")) return "closed";
  if (values.every((v) => v === "code")) return "invite";
  return "custom";
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
  private modes: ActionModes = expandPreset("open");
  private codes: string[] = [];
  private updatedAt = Date.now();

  // Called after every successful change so the caller can persist. Kept as
  // a callback rather than a Database reference so this file stays pure and
  // testable, and so a deploy with no DATABASE_URL simply passes nothing.
  constructor(private readonly onChange?: (record: AccessRecord) => void) {}

  getMode(): AccessMode {
    return summarize(this.modes);
  }

  getModes(): ActionModes {
    return { ...this.modes };
  }

  snapshot(): AccessSnapshot {
    return {
      mode: summarize(this.modes),
      modes: { ...this.modes },
      codeCount: this.codes.length,
      updatedAt: this.updatedAt,
    };
  }

  toRecord(): AccessRecord {
    return {
      modes: { ...this.modes },
      mode: summarize(this.modes),
      codes: [...this.codes],
      updatedAt: this.updatedAt,
    };
  }

  // Boot-time load from storage. Does NOT fire onChange -- this is reading
  // back what was already persisted, and writing it straight out again would
  // just be a pointless round trip on every startup.
  //
  // Reads the old single-mode shape too. A row written by the previous build
  // has `mode` and no `modes`, and silently defaulting that to wide open
  // would reopen a platform somebody deliberately closed -- the one failure
  // this whole file exists to prevent.
  hydrate(record: Partial<AccessRecord> | undefined | null): void {
    if (!record) return;
    if (record.modes) {
      for (const action of GATED_ACTIONS) {
        const value = record.modes[action];
        if (isActionMode(value)) this.modes[action] = value;
      }
    } else if (isAccessMode(record.mode)) {
      this.modes = expandPreset(record.mode);
    }
    if (Array.isArray(record.codes)) {
      this.codes = record.codes.map(normalizeCode).filter(Boolean).slice(0, MAX_CODES);
    }
    if (typeof record.updatedAt === "number") this.updatedAt = record.updatedAt;
  }

  /** Applies a preset to all three actions at once. */
  setMode(mode: AccessMode): void {
    this.modes = expandPreset(mode);
    this.touch();
  }

  setActionMode(action: GatedAction, mode: ActionMode): void {
    this.modes[action] = mode;
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
    const mode = this.modes[action];
    if (mode === "open") return;
    if (mode === "closed") throw new Error("locked_down");
    // "code"
    const given = normalizeCode(code);
    if (!given) throw new Error("invite_required");
    if (!this.hasCode(given)) throw new Error("invalid_invite");
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
  return {
    modes: expandPreset(mode),
    mode,
    codes: parseCodeList(env.ACCESS_CODES),
    updatedAt: Date.now(),
  };
}
