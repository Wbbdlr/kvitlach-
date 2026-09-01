import { Turn } from "./types";
import type { CompletedRoundSummary } from "./state";
import { statusDisplay } from "./table/selectors";

// Building the keepsake, not just a dump.
//
// This used to live inside App.tsx and hang off the banker's Manage drawer,
// which meant the only person who could keep a record of the night was the one
// running it -- everyone else went home with nothing. It is out here so the
// player-facing drawer can call it too, and so the format can be tested
// without rendering a table.
//
// Deliberately plain text rather than CSV or JSON: the thing being made is
// something somebody reads years later, or prints and sticks in a drawer, not
// something re-imported. A spreadsheet of `settledNet` is not a memory of
// Chanukah night.

export interface PlayerTotals {
  playerId: string;
  name: string;
  isBanker: boolean;
  rounds: number;
  wagered: number;
  net: number;
  best: number;
  worst: number;
  wins: number;
  losses: number;
  pushes: number;
  busts: number;
}

const playerName = (turn: Turn): string =>
  [turn.player.firstName, turn.player.lastName].filter(Boolean).join(" ") ||
  turn.player.firstName ||
  "Player";

/** Per-player totals across every completed round, richest first. */
export function summarize(rounds: CompletedRoundSummary[]): PlayerTotals[] {
  const byId = new Map<string, PlayerTotals>();
  for (const round of rounds) {
    for (const turn of round.turns ?? []) {
      const id = turn.player.id;
      let row = byId.get(id);
      if (!row) {
        row = {
          playerId: id,
          name: playerName(turn),
          isBanker: turn.player.type === "admin",
          rounds: 0,
          wagered: 0,
          net: 0,
          best: 0,
          worst: 0,
          wins: 0,
          losses: 0,
          pushes: 0,
          busts: 0,
        };
        byId.set(id, row);
      }
      // A later round's name wins: someone who renamed mid-session should
      // appear under the name they finished the night with.
      row.name = playerName(turn);
      row.rounds += 1;
      if (typeof turn.bet === "number") row.wagered += turn.bet;
      if (turn.busted) row.busts += 1;
      const net = typeof turn.settledNet === "number" ? turn.settledNet : 0;
      row.net += net;
      if (net > row.best) row.best = net;
      if (net < row.worst) row.worst = net;
      if (net > 0) row.wins += 1;
      else if (net < 0) row.losses += 1;
      else row.pushes += 1;
    }
  }
  return [...byId.values()].sort((a, b) => b.net - a.net);
}

const money = (n: number): string => `${n < 0 ? "-" : ""}$${Math.abs(n)}`;
const signed = (n: number): string => `${n > 0 ? "+" : n < 0 ? "-" : ""}$${Math.abs(n)}`;

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

export interface ExportOptions {
  rounds: CompletedRoundSummary[];
  roomId?: string;
  roomName?: string;
  /** When set, the file is written from this player's point of view. */
  focusPlayerId?: string;
  now?: Date;
}

export function buildHistoryText({ rounds, roomId, roomName, focusPlayerId, now = new Date() }: ExportOptions): string {
  const totals = summarize(rounds);
  const me = focusPlayerId ? totals.find((t) => t.playerId === focusPlayerId) : undefined;
  const lines: string[] = [];

  lines.push("KVITLACH");
  if (roomName) lines.push(roomName);
  if (roomId) lines.push(`Table ${roomId}`);
  const first = rounds[0]?.completedAt;
  const last = rounds[rounds.length - 1]?.completedAt;
  if (first && last) {
    lines.push(`Played ${new Date(first).toLocaleString()} — ${new Date(last).toLocaleTimeString()}`);
  }
  lines.push(`${rounds.length} round${rounds.length === 1 ? "" : "s"} · exported ${now.toLocaleString()}`);
  lines.push("");

  if (me) {
    lines.push(`YOUR NIGHT — ${me.name}`);
    lines.push("=".repeat(52));
    lines.push(`  Finished       ${signed(me.net)}`);
    lines.push(`  Rounds played  ${me.rounds}   (won ${me.wins}, lost ${me.losses}, push ${me.pushes})`);
    lines.push(`  Total wagered  ${money(me.wagered)}`);
    if (me.best > 0) lines.push(`  Best round     ${signed(me.best)}`);
    if (me.worst < 0) lines.push(`  Worst round    ${signed(me.worst)}`);
    if (me.busts) lines.push(`  Futch          ${me.busts} time${me.busts === 1 ? "" : "s"}`);
    const place = totals.findIndex((t) => t.playerId === me.playerId) + 1;
    if (place > 0) lines.push(`  Finished       ${place} of ${totals.length} at the table`);
    lines.push("");
  }

  lines.push("FINAL STANDINGS");
  lines.push("=".repeat(52));
  lines.push(`  ${pad("Player", 22)}${pad("Net", 10)}${pad("Rounds", 8)}Wagered`);
  for (const row of totals) {
    const label = `${row.name}${row.isBanker ? " (Banker)" : ""}${row.playerId === focusPlayerId ? " ←" : ""}`;
    lines.push(`  ${pad(label, 22)}${pad(signed(row.net), 10)}${pad(String(row.rounds), 8)}${money(row.wagered)}`);
  }
  lines.push("");

  lines.push("ROUND BY ROUND");
  lines.push("=".repeat(52));
  rounds.forEach((round, idx) => {
    lines.push("");
    lines.push(`Round ${round.roundNumber ?? idx + 1} — ${new Date(round.completedAt).toLocaleString()}`);
    const nameById = new Map((round.turns ?? []).map((t) => [t.player.id, playerName(t)]));
    for (const turn of round.turns ?? []) {
      const role = turn.player.type === "admin" ? "Banker" : "Player";
      const bet = typeof turn.bet === "number" ? money(turn.bet) : "--";
      const net = typeof turn.settledNet === "number" ? ` | ${signed(turn.settledNet)}` : "";
      const mark = turn.player.id === focusPlayerId ? "→ " : "  ";
            // Card.name, not a value: the 12 is worth 12, 9 or 10 depending on the
      // hand, so printing one number would be a lie about what was dealt.
      const cards = (turn.cards ?? []).map((c) => c.name).join(" ");
      lines.push(
        `${mark}${pad(playerName(turn), 20)} ${pad(role, 7)} ${pad(statusDisplay(turn).label || turn.state, 12)} bet ${bet}${net}${cards ? `   [${cards}]` : ""}`
      );
    }
    if (round.balances?.length) {
      lines.push("  Settled:");
      for (const b of round.balances) {
        lines.push(`    ${nameById.get(b.payer) ?? b.payer} → ${nameById.get(b.payee) ?? b.payee}: ${money(b.amount)}`);
      }
    }
  });

  lines.push("");
  lines.push("A gut yontif. — kvitlach.us");
  return lines.join("\n");
}

export function historyFilename(roomId?: string, focused = false, now = new Date()): string {
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return `kvitlach-${focused ? "my-" : ""}history${roomId ? `-${roomId}` : ""}-${stamp}.txt`;
}

/**
 * Hands the text to the browser as a download.
 *
 * Blob URL rather than a data: URI because Safari refuses to download a
 * data: URI opened from script, and object URLs are revoked on the next tick
 * so a long session does not leak one file's worth of memory per export.
 */
export function downloadText(filename: string, content: string): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
