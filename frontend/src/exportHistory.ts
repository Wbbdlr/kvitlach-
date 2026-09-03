import { Turn } from "./types";
import type { CompletedRoundSummary } from "./state";
import { statusDisplay } from "./table/selectors";
import { CHIPS, ChipName, DEFAULT_CHIP, DEFAULT_FELT, FELTS, FeltName } from "./theme";

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

/**
 * What one turn was actually worth, and whether any of it was ever at stake.
 *
 * This is the whole of the export's money bug, in one place. The sheet used to
 * read `turn.settledNet` for everybody and `turn.bet` as everybody's wager,
 * and both are wrong in a way that only shows up against real data:
 *
 *   settledNet is set on the BANKER's turn by the BANK!-lock settlement path
 *   (store.ts) and NOWHERE ELSE. An ordinary player's turn never carries it,
 *   so every player's net came out as exactly 0 -- which is why the sheet
 *   showed $0 down every column, and why every round was then counted a push,
 *   because the W/L tally is derived from that same number.
 *
 *   the banker's `bet` is not a wager. calculateEndState overwrites the admin
 *   turn's `bet` with the round's SIGNED NET (round.ts), so adding it into a
 *   "wagered" total booked the bank's winnings as money it had put up. The
 *   banker never wagers; their stake is always 0.
 *
 * A player's real stake is `settledBet ?? bet`, in that order: `bet` is zeroed
 * the moment a seat is paid out mid-round and settledBet keeps what was at
 * risk (see round.ts's noWager/alreadySettled notes). Nothing at stake is a
 * push whatever the cards said -- a blatt does not win or lose money.
 *
 * Mirrors the server's own buildRoundHistoryEntry (round.ts), which has always
 * computed it this way for the durable history; only the export disagreed.
 */
function turnMoney(turn: Turn): { stake: number; net: number } {
  if (turn.player.type === "admin") {
    const net = typeof turn.settledNet === "number" ? turn.settledNet : turn.bet ?? 0;
    return { stake: 0, net };
  }
  const stake = turn.settledBet ?? turn.bet ?? 0;
  if (stake === 0) return { stake: 0, net: 0 };
  if (turn.state === "won") return { stake, net: stake };
  if (turn.state === "lost") return { stake, net: -stake };
  return { stake, net: 0 };
}

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
      const { stake, net } = turnMoney(turn);
      row.wagered += stake;
      // statusDisplay is the one place that knows the difference between
      // going over 21 and merely losing the showdown -- App.tsx leans on it
      // for the same reason. `turn.busted` alone is set on the banker and on
      // server-backfilled history turns, but a live player's bust is only
      // derivable from their cards, so counting the flag missed most of them.
      if (statusDisplay(turn).label === "FUTCHED!") row.busts += 1;
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

/**
 * The sheet in the exporting player's own table colours.
 *
 * Felt and chip are per-viewer preferences (theme.ts) -- they never leave the
 * client, so nobody else's copy changes. Which is the point: the file is a
 * keepsake of the table THAT PLAYER sat at, and it shipped in a fixed green
 * regardless of what they had been looking at all night.
 *
 * Only the dark chrome takes the felt. The sheet itself stays warm paper: it
 * is meant to be printed and screenshotted, and a full-bleed coloured
 * document is a worse keepsake and a much worse print. The chip colour is the
 * one accent inside the paper -- rules, the rank column, the round dividers.
 */
const style = (feltName: FeltName, chipName: ChipName): string => {
  const felt = FELTS[feltName] ?? FELTS[DEFAULT_FELT];
  const chip = CHIPS[chipName] ?? CHIPS[DEFAULT_CHIP];
  return `
  *{box-sizing:border-box}
  body{margin:0;padding:28px 18px 48px;background:${felt.lo};color:#1f2937;
    font-family:ui-serif,Georgia,"Times New Roman",serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .sheet{max-width:760px;margin:0 auto;background:#faf7f2;border-radius:14px;
    box-shadow:0 18px 50px rgba(0,0,0,.35);overflow:hidden}
  .top{background:linear-gradient(160deg,${felt.hi},${felt.lo});color:#f3ede4;
    padding:26px 30px 22px;text-align:center;border-bottom:3px solid ${chip.swatch}}
  *{box-sizing:border-box}
  body{margin:0;padding:28px 18px 48px;background:#0f2419;color:#1f2937;
    font-family:ui-serif,Georgia,"Times New Roman",serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .sheet{max-width:760px;margin:0 auto;background:#faf7f2;border-radius:14px;
    box-shadow:0 18px 50px rgba(0,0,0,.35);overflow:hidden}
  .top{background:#12271c;color:#f3ede4;padding:26px 30px 22px;text-align:center}
  .brand{font-size:11px;letter-spacing:.42em;text-transform:uppercase;color:${chip.swatch}}
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
  h2{font-size:11px;letter-spacing:.26em;text-transform:uppercase;color:${chip.swatch};
    margin:0;padding:20px 30px 8px;border-top:2px solid ${chip.swatch}33}
  table{width:100%;border-collapse:collapse;font-size:14px}
  th,td{padding:7px 10px;text-align:left}
  thead th{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#8a8175;font-weight:600}
  tbody tr:nth-child(odd){background:#f2ece2}
  td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
  .wrap{padding:0 30px 8px}
  tr.me td{font-weight:700}
  .rank{color:${chip.swatch};opacity:.65;width:26px}
  .round{padding:12px 30px;border-top:1px solid #efe9de}
  .round h3{margin:0 0 6px;font-size:13px;font-weight:600}
  .round h3 span{font-weight:400;color:#8a8175;font-size:11px;margin-left:8px}
  .hand{display:flex;justify-content:space-between;gap:10px;font-size:13px;padding:2px 0}
  .hand.me{font-weight:700}
  .muted{color:#8a8175;font-size:11px;letter-spacing:.08em;font-weight:400}
  .foot{padding:20px 30px 26px;text-align:center;color:#8a8175;font-size:11px;border-top:1px solid #e7e0d5}
  .foot a{color:inherit}
  .foot .powered{display:block;margin-top:7px;font-size:10px;letter-spacing:.1em;opacity:.8}
  @media print{body{background:#fff;padding:0}.sheet{box-shadow:none;border-radius:0;max-width:none}}
`;
};

export interface ExportOptions {
  rounds: CompletedRoundSummary[];
  roomId?: string;
  roomName?: string;
  /** When set, the sheet is written from this player's point of view. */
  focusPlayerId?: string;
  /** The exporting player's own table colours -- see style(). */
  felt?: FeltName;
  chip?: ChipName;
  now?: Date;
}

const chip = (label: string, value: string) =>
  `<div class="chip"><b>${esc(value)}</b><span>${esc(label)}</span></div>`;

const tone = (n: number) => (n > 0 ? "up" : n < 0 ? "down" : "flat");

export function buildHistoryHtml({
  rounds,
  roomId,
  roomName,
  focusPlayerId,
  // Bound under different names than the option keys on purpose: `chip` is
  // already a module-level helper here (it renders a stat tile), and
  // destructuring over it shadowed the function inside this scope.
  felt: feltName = DEFAULT_FELT,
  chip: chipName = DEFAULT_CHIP,
  now = new Date(),
}: ExportOptions): string {
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
          // Same derivation as the standings above -- see turnMoney. Reading
          // settledNet directly here printed every player's hand as $0, which
          // is the round-by-round half of the same bug.
          const { stake, net } = turnMoney(turn);
          // Card NAMES, not values: the 12 is worth 12, 9 or 10 depending on
          // the hand, so one printed number would misreport what was dealt.
          const cards = (turn.cards ?? []).map((c) => c.name).join(" · ");
          // statusDisplay already separates FUTCHED! (went over 21) from LOST
          // (the banker simply had the better hand), which is the distinction
          // that matters most when you read this back weeks later. The one
          // thing it cannot say is BLATT: it sees a $0 result and calls it a
          // push, but a push and a hand played with nothing at stake are not
          // the same event at this table -- and the sheet is the only place
          // anyone will ever re-read the night from.
          // Not a skipped turn, which is also stakeless and is not a blatt.
          const isBlatt = turn.player.type !== "admin" && turn.state !== "skipped" && stake === 0;
          const label = isBlatt ? "BLATT" : statusDisplay(turn).label || turn.state;
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
<style>${style(feltName, chipName)}</style></head>
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
  <div class="foot">
    Ah freilichin Chanuka · <a href="https://kvitlach.us">kvitlach.us</a>
    <span class="powered">Powered by <a href="https://computerrabbis.com">ComputerRabbis.com</a></span>
  </div>
</div></body></html>`;
}

/**
 * Strip everything a filesystem, a download folder or a chat app would object
 * to, and keep it short. Windows bans \ / : * ? " < > |, every platform hates
 * a leading dot, and a room named with only emoji or Hebrew punctuation must
 * still leave something behind -- hence the empty-string caller checks below.
 */
function fileSafe(value: string, max = 40): string {
  return value
    .replace(/[\\/:*?"<>|]/g, " ")
    // Control characters cannot appear in a filename and are easy to write
    // into one by accident -- a pasted room name carries whatever came with it.
    .replace(/[\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, max)
    .trim();
}

/**
 * What the file is called once it lands in someone's Downloads.
 *
 * It used to be `kvitlach-table-ZXD636-2026-01-01.html` -- a room ID nobody
 * recognises a week later, and every table on the same night sorting together
 * under an identical prefix. Reported as the exported files needing better
 * names, and it matters more than it sounds: this is a keepsake people keep,
 * and the name is the only thing they see when they go looking for it.
 *
 * Now it leads with what a person would actually search for -- their own name
 * on a personal copy, the table's name on the table copy -- and falls back
 * through the room ID to a plain date, so it is never bare.
 */
export function historyFilename(
  roomId?: string,
  focused = false,
  now = new Date(),
  names: { roomName?: string; playerName?: string } = {}
): string {
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const room = fileSafe(names.roomName ?? "");
  const player = focused ? fileSafe(names.playerName ?? "", 30) : "";
  const parts = ["Kvitlach"];
  if (player) parts.push(player);
  if (room) parts.push(room);
  // Only when neither name survived -- an ID beats nothing, but it is noise
  // next to a name that already identifies the table.
  else if (roomId) parts.push(roomId);
  parts.push(stamp);
  return `${parts.join(" - ")}.html`;
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
