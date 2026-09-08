// Who did what to whom, kept somewhere it can be read back.
//
// Every consequential action in store.ts already called audit() -- wallet
// adjustments, kicks, force-deletes, bank top-ups, undo, reshuffles, turn-clock
// changes, seat claims, pass-bank. It wrote one JSON line to stdout and died
// with the container. "Who deleted that table" had no answer, and neither did
// "did the banker actually give him those chips or did he take them", which is
// the question this exists for: money moves on this platform at a banker's
// discretion, and the ledger says what happened to a wallet without saying who
// decided it.
//
// TWO SINKS, and the pair is the point. The ring is what the panel reads and
// works with no database at all -- this app runs fully in-memory when
// DATABASE_URL is unset, and an audit trail that only exists in the configured
// case is one you cannot rely on. The table is what survives a restart, which
// is the entire reason for the feature: an in-memory-only trail answers
// questions about the past exactly until the moment somebody restarts the
// container to fix the thing you wanted to ask about.
//
// RETENTION IS FIXED IN ADVANCE, not left to grow. These rows carry player
// identifiers and amounts, so a trail with no expiry is a slowly accumulating
// pile of personal data collected for a purpose that expired months ago. The
// window is limits.auditRetentionDays and the Privacy page states it; if that
// number changes, that page changes in the same commit. It is code-only for
// exactly this reason.

import type { Database } from "./db.js";
import type { RuntimeLimits } from "./limits.js";

export interface AuditEntry {
  /** Epoch ms. */
  at: number;
  /** A stable slug -- "kick", "wallet-adjust". See AUDIT_ACTIONS. */
  action: string;
  roomId: string;
  /** Who did it. A player id, or "admin"/"server" for the two non-players. */
  actorId: string;
  /** Action-specific, already small. Serialized as JSON in the table. */
  details: Record<string, unknown>;
}

// What the panel offers as a filter. Derived from the call sites in store.ts
// rather than invented: audit-actions.test.ts fails if store.ts grows an action
// that is not listed here, which is the only thing keeping a filter dropdown
// from silently going stale.
export const AUDIT_ACTIONS = [
  "admin-force-delete",
  "auto-stand",
  "bank-topup",
  "buyin-approve",
  "buyin-reject",
  "idle-seat-swept",
  "kick",
  "leave",
  "pass-bank",
  "rename-approve",
  "rename-reject",
  "reshuffle-deck",
  "reshuffle-deck-live",
  "seat-claim-approve",
  "seat-claim-reject",
  "seat-claim-request",
  "set-deck-count",
  "set-turn-seconds",
  "set-watermark",
  "switch-admin",
  "undo-correction",
  "void-abandoned-round",
  "wallet-adjust",
] as const;

// One night at a fifty-person table generates a few hundred of these. The ring
// is a working window for the panel, not the record -- the table is the record,
// and the panel reads the table whenever there is one.
const RING_SIZE = 500;

// The prune is opportunistic rather than scheduled: no setInterval, so there is
// no timer to leak in a process meant to run for months, and nothing to reason
// about at shutdown. At most once an hour, on an append that was happening
// anyway.
const PRUNE_INTERVAL_MS = 60 * 60_000;

export interface AuditQuery {
  roomId?: string;
  action?: string;
  actorId?: string;
  limit?: number;
}

export class AuditLog {
  private ring: AuditEntry[] = [];
  private lastPruneAt = 0;

  constructor(
    private readonly limits: RuntimeLimits,
    private readonly db?: Database,
  ) {}

  /**
   * Records one action. Never throws and never awaits.
   *
   * The caller is a game action mid-flight -- a kick, a wallet adjustment --
   * and an audit write must not be able to fail one. A database that is down
   * costs the durable copy of this entry; it must not also cost the player
   * their chips. The console line is kept alongside both sinks because it is
   * what `docker compose logs` shows, and that is still the first place
   * anybody looks.
   */
  record(action: string, roomId: string, actorId: string, details: Record<string, unknown> = {}): void {
    const entry: AuditEntry = { at: Date.now(), action, roomId, actorId, details };
    this.ring.unshift(entry);
    if (this.ring.length > RING_SIZE) this.ring.length = RING_SIZE;

    console.info(JSON.stringify({ audit: { ts: new Date(entry.at).toISOString(), roomId, actorId, action, ...details } }));

    if (!this.db) return;
    void this.db.appendAudit(entry).catch((e) => console.error("db appendAudit", e));
    this.maybePrune();
  }

  private maybePrune(): void {
    const now = Date.now();
    if (now - this.lastPruneAt < PRUNE_INTERVAL_MS) return;
    // Stamped BEFORE the await, not after: two appends in the same tick would
    // otherwise both see a stale stamp and both start a prune.
    this.lastPruneAt = now;
    const cutoff = now - this.limits.auditRetentionDays * 24 * 60 * 60_000;
    void this.db?.pruneAudit(cutoff).catch((e) => console.error("db pruneAudit", e));
  }

  /**
   * Most recent first.
   *
   * Reads the table when there is one, because the ring holds only what this
   * process has seen since it started -- and a restart is very often exactly
   * what happened between the event and the question. Falls back to the ring
   * on any database error rather than showing the operator an error page: a
   * partial answer beats none when somebody is trying to find out what
   * happened.
   */
  async list(query: AuditQuery = {}): Promise<{ entries: AuditEntry[]; source: "database" | "memory" }> {
    const limit = Math.min(Math.max(query.limit ?? 200, 1), RING_SIZE);
    if (this.db) {
      try {
        return { entries: await this.db.listAudit({ ...query, limit }), source: "database" };
      } catch (e) {
        console.error("db listAudit; falling back to this process's own memory", e);
      }
    }
    return { entries: this.filterRing(query, limit), source: "memory" };
  }

  private filterRing(query: AuditQuery, limit: number): AuditEntry[] {
    return this.ring
      .filter(
        (e) =>
          (!query.roomId || e.roomId === query.roomId) &&
          (!query.action || e.action === query.action) &&
          (!query.actorId || e.actorId === query.actorId),
      )
      .slice(0, limit);
  }

  /** What this process itself has seen. Used by the tests and the fallback. */
  recent(limit = RING_SIZE): AuditEntry[] {
    return this.ring.slice(0, limit);
  }

  get hasDatabase(): boolean {
    return Boolean(this.db);
  }

  get retentionDays(): number {
    return this.limits.auditRetentionDays;
  }
}
