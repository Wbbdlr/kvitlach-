import { Turn } from "./types";
import type { CompletedRoundSummary } from "./state";
import { statusDisplay } from "./table/selectors";

// The keepsake.
//
// This used to be a plain-text dump hanging off the banker's Manage drawer,
// which meant the only person who could keep a record of the night was the one
// running it -- everyone else went home with nothing.
//
// It is a self-contained HTML file, not text and not CSV. Text cannot be handed
// to someone in a way that looks like anything, and CSV is for re-importing,
// which nobody will ever do with this. HTML opens in any browser on any device,
// prints to PDF from the same menu, and screenshots cleanly for the group chat
// -- which is realistically what happens to it. Everything is inlined (no
// fonts, no images, no scripts) so it still renders years from now on a machine
// with no network.

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
  /** Longest run of winning rounds, in the order they were played. */
  streak: number;
}

const playerName = (turn: Turn): string =>
  [turn.player.firstName, turn.player.lastName].filter(Boolean).join(" ") ||
  turn.player.firstName ||
  "Player";

/** Per-player totals across every completed round, richest first. */
export function summarize(rounds: CompletedRoundSummary[]): PlayerTotals[] {
  const byId = new Map<string, PlayerTotals>();
  const running = new Map<string, number>();
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
          streak: 0,
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
      if (net > 0) {
        row.wins += 1;
        const run = (running.get(id) ?? 0) + 1;
        running.set(id, run);
        if (run > row.streak) row.streak = run;
      } else {
        if (net < 0) row.losses += 1;
        else row.pushes += 1;
        running.set(id, 0);
      }
    }
  }
  return [...byId.values()].sort((a, b) => b.net - a.net);
}

const money = (n: number): string => `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString()}`;
const signed = (n: number): string => `${n > 0 ? "+" : n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString()}`;

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

// One line saying how the night went, so the top of the sheet reads like
// something a person would say rather than something a spreadsheet would
// print. This is the difference between a record and a keepsake.
export function verdict(me: PlayerTotals, place: number, of: number): string {
  if (me.rounds === 0) return "Sat this one out.";
  if (me.isBanker) {
    if (me.net > 0) return `Held the bank and came out ahead over ${me.rounds} rounds.`;
    if (me.net < 0) return `Held the bank and paid out over ${me.rounds} rounds.`;
    return "Held the bank and broke exactly even.";
  }
  if (place === 1 && me.net > 0) return `Top of the table across ${me.rounds} rounds.`;
  if (me.net > 0) return `Finished up, ${place} of ${of} at the table.`;
  if (me.net === 0) return `Broke exactly even across ${me.rounds} rounds.`;
  if (me.streak >= 3) return `Down on the night, but took ${me.streak} in a row at one point.`;
  return `Down on the night across ${me.rounds} rounds.`;
}

const STYLE = `
  *{box-sizing:border-box}
  body{margin:0;padding:28px 18px 48px;background:#0f2419;color:#1f2937;
    font-family:ui-serif,Georgia,"Times New Roman",serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .sheet{max-width:760px;margin:0 auto;background:#faf7f2;border-radius:14px;
    box-shadow:0 18px 50px rgba(0,0,0,.35);overflow:hidden}
  .top{background:#12271c;color:#f3ede4;padding:26px 30px 22px;text-align:center}
  .brand{font-size:11px;letter-spacing:.42em;text-transform:uppercase;opacity:.72}
  .table-name{font-size:24px;margin:8px 0 2px}
  .when{font-size:12px;opacity:.66;letter-spacing:.04em}
  .hero{padding:26px 30px 4px;text-align:center}
  .who{font-size:12px;letter-spacing:.28em;text-transform:uppercase;color:#8a8175}
  .net{font-size:58px;line-height:1.05;margin:6px 0 4px;font-weight:600}
  .up{color:#15734e}.down{color:#a33a2e}.flat{color:#6b6459}
  .verdict{font-size:14px;color:#5f584d;margin:0}
  .chips{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;padding:18px 30px 22px}
  .chip{border:1px solid #e0d8ca;border-radius:9px;padding:8px 13px;min-width:88px;background:#fff;text-align:center}
  .chip b{display:block;font-size:19px;font-weight:600}
  .chip span{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#8a8175}
  h2{font-size:11px;letter-spacing:.26em;text-transform:uppercase;color:#8a8175;
    margin:0;padding:20px 30px 8px;border-top:1px solid #e7e0d5}
  table{width:100%;border-collapse:collapse;font-size:14px}
  th,td{padding:7px 10px;text-align:left}
  thead th{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#8a8175;font-weight:600}
  tbody tr:nth-child(odd){background:#f2ece2}
  td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
  .wrap{padding:0 30px 8px}
  tr.me td{font-weight:700}
  .rank{color:#a89e8e;width:26px}
  .round{padding:12px 30px;border-top:1px solid #efe9de}
  .round h3{margin:0 0 6px;font-size:13px;font-weight:600}
  .round h3 span{font-weight:400;color:#8a8175;font-size:11px;margin-left:8px}
  .hand{display:flex;justify-content:space-between;gap:10px;font-size:13px;padding:2px 0}
  .hand.me{font-weight:700}
  .muted{color:#8a8175;font-size:11px;letter-spacing:.08em;font-weight:400}
  .foot{padding:20px 30px 26px;text-align:center;color:#8a8175;font-size:11px;border-top:1px solid #e7e0d5}
  @media print{body{background:#fff;padding:0}.sheet{box-shadow:none;border-radius:0;max-width:none}}
`;

export interface ExportOptions {
  rounds: CompletedRoundSummary[];
  roomId?: string;
  roomName?: string;
  /** When set, the sheet is written from this player's point of view. */
  focusPlayerId?: string;
  now?: Date;
}

const chip = (label: string, value: string) =>
  `<div class="chip"><b>${esc(value)}</b><span>${esc(label)}</span></div>`;

const tone = (n: number) => (n > 0 ? "up" : n < 0 ? "down" : "flat");

export function buildHistoryHtml({ rounds, roomId, roomName, focusPlayerId, now = new Date() }: ExportOptions): string {
  const totals = summarize(rounds);
  const me = focusPlayerId ? totals.find((t) => t.playerId === focusPlayerId) : undefined;
  const place = me ? totals.findIndex((t) => t.playerId === me.playerId) + 1 : 0;
  const first = rounds[0]?.completedAt;
  const last = rounds[rounds.length - 1]?.completedAt;

  const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const when =
    first && last
      ? `${new Date(first).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · ${time(first)}–${time(last)}`
      : now.toLocaleDateString();

  // The hero is the whole point of the personal copy: one big number and one
  // sentence. Everything under it is for the curious.
  const hero = me
    ? `<div class="hero">
        <div class="who">${esc(me.name)}${me.isBanker ? " · Banker" : ""}</div>
        <div class="net ${tone(me.net)}">${esc(signed(me.net))}</div>
        <p class="verdict">${esc(verdict(me, place, totals.length))}</p>
      </div>
      <div class="chips">
        ${chip("Rounds", String(me.rounds))}
        ${chip("Won", String(me.wins))}
        ${chip("Lost", String(me.losses))}
        ${me.pushes ? chip("Pushed", String(me.pushes)) : ""}
        ${chip("Wagered", money(me.wagered))}
        ${me.best > 0 ? chip("Best round", signed(me.best)) : ""}
        ${me.worst < 0 ? chip("Worst round", signed(me.worst)) : ""}
        ${me.streak > 1 ? chip("Best streak", `${me.streak} in a row`) : ""}
        ${me.busts > 0 ? chip("Futch", String(me.busts)) : ""}
        ${!me.isBanker && totals.length > 1 ? chip("Finished", `${place} of ${totals.length}`) : ""}
      </div>`
    : `<div class="hero">
        <div class="who">The table</div>
        <div class="net flat">${rounds.length}</div>
        <p class="verdict">${rounds.length === 1 ? "round" : "rounds"} played · ${totals.length} at the table</p>
      </div><div class="chips"></div>`;

  const standings = totals
    .map(
      (row, i) => `<tr class="${row.playerId === focusPlayerId ? "me" : ""}">
        <td class="rank">${i + 1}</td>
        <td>${esc(row.name)}${row.isBanker ? ' <span class="muted">Banker</span>' : ""}</td>
        <td class="num ${tone(row.net)}">${esc(signed(row.net))}</td>
        <td class="num">${row.rounds}</td>
        <td class="num">${row.wins}–${row.losses}</td>
        <td class="num">${esc(money(row.wagered))}</td>
      </tr>`
    )
    .join("");

  const roundBlocks = rounds
    .map((round, idx) => {
      const hands = (round.turns ?? [])
        .map((turn) => {
          const net = typeof turn.settledNet === "number" ? turn.settledNet : 0;
          // Card NAMES, not values: the 12 is worth 12, 9 or 10 depending on
          // the hand, so one printed number would misreport what was dealt.
          const cards = (turn.cards ?? []).map((c) => c.name).join(" · ");
          const label = statusDisplay(turn).label || turn.state;
          return `<div class="hand${turn.player.id === focusPlayerId ? " me" : ""}">
            <span>${esc(playerName(turn))}${turn.player.type === "admin" ? ' <span class="muted">Banker</span>' : ""}${cards ? ` <span class="muted">${esc(cards)}</span>` : ""}</span>
            <span><span class="muted">${esc(label)}</span> <b class="${tone(net)}">${esc(signed(net))}</b></span>
          </div>`;
        })
        .join("");
      return `<div class="round">
        <h3>Round ${round.roundNumber ?? idx + 1}<span>${esc(time(round.completedAt))}</span></h3>
        ${hands}
      </div>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Kvitlach — ${esc(me ? me.name : roomName || roomId || "table")}</title>
<style>${STYLE}</style></head>
<body><div class="sheet">
  <div class="top">
    <div class="brand">Kvitlach</div>
    <div class="table-name">${esc(roomName || "A Chanukah table")}</div>
    <div class="when">${esc(when)}${roomId ? ` · ${esc(roomId)}` : ""}</div>
  </div>
  ${hero}
  <h2>Final standings</h2>
  <div class="wrap"><table>
    <thead><tr><th class="rank"></th><th>Player</th><th class="num">Net</th><th class="num">Rounds</th><th class="num">W–L</th><th class="num">Wagered</th></tr></thead>
    <tbody>${standings}</tbody>
  </table></div>
  <h2>Round by round</h2>
  ${roundBlocks || '<div class="round"><div class="hand">No completed rounds.</div></div>'}
  <div class="foot">A gut yontif · kvitlach.us</div>
</div></body></html>`;
}

export function historyFilename(roomId?: string, focused = false, now = new Date()): string {
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return `kvitlach-${focused ? "my-night" : "table"}${roomId ? `-${roomId}` : ""}-${stamp}.html`;
}

/**
 * Hands the file to the browser as a download.
 *
 * Blob URL rather than a data: URI because Safari refuses to download a data:
 * URI opened from script, and object URLs are revoked on the next tick so a
 * long session does not leak one file's worth of memory per export.
 */
export function downloadFile(filename: string, content: string, type = "text/html;charset=utf-8"): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const url = URL.createObjectURL(new Blob([content], { type }));
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
