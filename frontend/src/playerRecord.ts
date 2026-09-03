import { CompletedRoundSummary } from "./state";
import { Turn } from "./types";
import { isPushTurn } from "./table/selectors";

// A player's own record across every night they have played on this device.
//
// The local half of the analytics split (docs: A18). The other half is the
// table-wide view of tonight, which the banker reads off the same round
// history the export already uses -- see tableStandings below.
//
// Deliberately NOT a server feature, and the reason is the part worth keeping:
// a lifetime record that lives on the server needs identity, which needs
// accounts, retention, deletion and a decision about what a banker may see
// about a guest who played once. None of that is needed to answer "how am I
// doing", because the answer is already sitting in this browser -- state.ts
// has been persisting every completed round under kvitlach.history.<roomId>
// since long before anyone asked for stats.
//
// The honest limitation, stated here so nobody has to rediscover it: this is
// per-DEVICE. A player who switches phones or clears their browser starts
// over, and two people sharing a tablet share a record. That is the price of
// not building an identity system, and for a game played once a year around a
// table it is the right trade.

const HISTORY_PREFIX = "kvitlach.history.";
const SESSION_PREFIX = "kvitlach.session.";

export interface LifetimeRecord {
  nights: number;
  rounds: number;
  wins: number;
  losses: number;
  pushes: number;
  /** Rounds played without a wager -- not a loss, and not a push either. */
  blatts: number;
  net: number;
  best: number;
  worst: number;
  longestWinStreak: number;
}

export const EMPTY_RECORD: LifetimeRecord = {
  nights: 0,
  rounds: 0,
  wins: 0,
  losses: 0,
  pushes: 0,
  blatts: 0,
  net: 0,
  best: 0,
  worst: 0,
  longestWinStreak: 0,
};

/**
 * What one turn was worth to the player who took it.
 *
 * Mirrors useTableData's netAmount and betDisplay's own amount selection, and
 * has to keep mirroring them: a lifetime total that disagrees with the sum of
 * the rounds a player can see in their own stats list is worse than no total.
 *
 * The admin branch is the one that is not obvious. calculateEndState (round.ts)
 * overwrites the banker's `bet` with the round's SIGNED NET once it resolves,
 * so for the bank that field is already the answer and must not be re-derived
 * from win/loss -- the bank does not win or lose a wager, it settles several.
 */
export function turnNet(turn: Turn): number {
  if (turn.player.type === "admin") return turn.bet ?? 0;
  if (isPushTurn(turn)) return 0;
  const baseBet = turn.bet ?? 0;
  const amount = baseBet > 0 ? baseBet : turn.settledBet ?? baseBet;
  if (turn.state === "won") return amount;
  if (turn.state === "lost") return -amount;
  return 0;
}

function stake(turn: Turn): number {
  if (turn.player.type === "admin") return 0;
  const baseBet = turn.bet ?? 0;
  return baseBet > 0 ? baseBet : turn.settledBet ?? 0;
}

function parse<T>(raw: string | null): T | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

/**
 * Reads every room this device has history for and folds the rounds this
 * device's own player took into one record.
 *
 * Storage is taken as an argument rather than reached for, so this is testable
 * without a browser and so a private-mode failure is the caller's to handle.
 */
export function readLifetimeRecord(storage: Storage): LifetimeRecord {
  let keys: string[];
  try {
    keys = Object.keys(storage).filter((key) => key.startsWith(HISTORY_PREFIX));
  } catch {
    // Reading localStorage throws outright in some privacy configurations.
    // No record is a fine answer; a crashed stats dialog is not.
    return EMPTY_RECORD;
  }

  const record: LifetimeRecord = { ...EMPTY_RECORD };
  let streak = 0;

  for (const key of keys) {
    const roomId = key.slice(HISTORY_PREFIX.length);
    // Which player WAS this device in that room. Without the session there is
    // no way to know, and guessing (say, the only non-bot) would quietly
    // attribute a stranger's night to this player.
    const session = parse<{ playerId?: string }>(storage.getItem(SESSION_PREFIX + roomId));
    const playerId = session?.playerId;
    if (!playerId) continue;

    const rounds = parse<CompletedRoundSummary[]>(storage.getItem(key));
    if (!Array.isArray(rounds) || rounds.length === 0) continue;

    let playedHere = false;
    // Oldest first, so the streak is counted in the order the rounds were
    // actually played. state.ts prepends, so stored order is newest first.
    const ordered = [...rounds].sort((a, b) => (a.completedAt ?? 0) - (b.completedAt ?? 0));
    for (const round of ordered) {
      const turn = round.turns?.find((t) => t.player?.id === playerId);
      if (!turn) continue;
      playedHere = true;
      record.rounds += 1;

      const net = turnNet(turn);
      record.net += net;
      if (net > record.best) record.best = net;
      if (net < record.worst) record.worst = net;

      if (turn.player.type !== "admin" && stake(turn) === 0) record.blatts += 1;

      if (isPushTurn(turn)) record.pushes += 1;
      else if (turn.state === "won") record.wins += 1;
      else if (turn.state === "lost") record.losses += 1;

      // A streak is consecutive real WINS. A push neither extends nor breaks
      // one -- nothing happened.
      //
      // The push check has to come FIRST, and this is why: a blatt resolves
      // with state "won" (the player took the round without a wager), and
      // isPushTurn is what tells the two apart. Testing state alone counted
      // every blatt as a win for streak purposes while the wins tally --
      // which does check isPushTurn first -- did not. Caught on real data
      // rather than in a unit test: 18 rounds, 1 win, and a reported longest
      // streak of 8.
      if (isPushTurn(turn)) {
        // no-op, deliberately: a push is not a break in the streak
      } else if (turn.state === "won") {
        streak += 1;
        if (streak > record.longestWinStreak) record.longestWinStreak = streak;
      } else {
        streak = 0;
      }
    }
    // A room whose history exists but holds none of this player's turns is not
    // a night they played -- they watched, or joined and left before a hand.
    if (playedHere) record.nights += 1;
    streak = 0; // Streaks do not run across nights.
  }

  return record;
}

export interface StandingRow {
  playerId: string;
  name: string;
  isBanker: boolean;
  rounds: number;
  wins: number;
  losses: number;
  net: number;
}

/**
 * Tonight, for everyone at the table, from the round history the client
 * already holds.
 *
 * The banker sees every column here, on the table's own decision -- asked and
 * answered directly: "you can let the banker see everything." So there is no
 * redaction pass and no per-viewer variant; if this is ever shown to a
 * non-banker, that has to become a real decision rather than an oversight,
 * which is why the caller gates it rather than this function.
 *
 * Client-side on purpose. The banker is present for the whole night, so their
 * own history is the complete one -- which is exactly why this is the view
 * that gets shown to them and not to a player who joined at round twelve.
 */
export function tableStandings(rounds: CompletedRoundSummary[]): StandingRow[] {
  const rows = new Map<string, StandingRow>();
  for (const round of rounds) {
    for (const turn of round.turns ?? []) {
      const player = turn.player;
      if (!player?.id) continue;
      const row =
        rows.get(player.id) ??
        {
          playerId: player.id,
          name: [player.firstName, player.lastName].filter(Boolean).join(" ").trim() || "Player",
          isBanker: player.type === "admin",
          rounds: 0,
          wins: 0,
          losses: 0,
          net: 0,
        };
      row.rounds += 1;
      row.net += turnNet(turn);
      if (!isPushTurn(turn)) {
        if (turn.state === "won") row.wins += 1;
        else if (turn.state === "lost") row.losses += 1;
      }
      rows.set(player.id, row);
    }
  }
  // Banker first -- the table's counterparty is the row everything else is
  // measured against -- then by net, biggest winner down.
  return [...rows.values()].sort((a, b) => {
    if (a.isBanker !== b.isBanker) return a.isBanker ? -1 : 1;
    return b.net - a.net;
  });
}
