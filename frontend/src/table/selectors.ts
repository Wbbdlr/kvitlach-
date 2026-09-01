import { Card, Player, RoundPhase, Turn } from "../types";
import { APP_VERSION } from "../version";
// The 12 faces carry ?v=<APP_VERSION> and blank.png deliberately does not.
//
// These live in public/, so unlike anything Vite bundles they keep their plain
// filenames forever -- there is no content hash to change when the art does.
// Redrawing the cards in v7.9 shipped new bytes to the same twelve URLs, and
// browsers and the Cloudflare edge both went on serving what they already had;
// the deploy looked like it had silently not happened. The query string moves
// with every version bump, which is exactly when the art can have changed.
//
// blank.png is excluded because index.css fetches it by its bare URL too, and
// a versioned copy here would mean downloading that 2.6MB file twice.
const CARD_VERSION = `?v=${APP_VERSION}`;

export const cardImages: Record<string, string> = {
  "1": `/1.png${CARD_VERSION}`,
  "2": `/2.png${CARD_VERSION}`,
  "3": `/3.png${CARD_VERSION}`,
  "4": `/4.png${CARD_VERSION}`,
  "5": `/5.png${CARD_VERSION}`,
  "6": `/6.png${CARD_VERSION}`,
  "7": `/7.png${CARD_VERSION}`,
  "8": `/8.png${CARD_VERSION}`,
  "9": `/9.png${CARD_VERSION}`,
  "10": `/10.png${CARD_VERSION}`,
  "11": `/11.png${CARD_VERSION}`,
  "12": `/12.png${CARD_VERSION}`,
  blank: "/blank.png",
};

// Dropped the flatter/monochrome-reading glyphs a couple of rendering
// engines show with little to no color (the plain checkmark/cross and a
// couple of others) in favor of ones that read as colorful and expressive
// everywhere, and added a couple that fit an in-person card game
// specifically (a joker, a money bag for the chip talk). The sleeping "Zzz"
// was cut in that same pass but brought back by request -- it earns its
// keep calling out a slow player.
export const REACTION_EMOJIS = [
  "👏",
  "😂",
  "😮",
  "❤️",
  "🔥",
  "👍",
  "😢",
  "🤯",
  "😎",
  "🙌",
  "😡",
  "🤔",
  "🎉",
  "🤞",
  "🙏",
  "🍀",
  "🍻",
  "🍕",
  "💯",
  "🤑",
  "😭",
  "🥳",
  "🃏",
  "💰",
  "😏",
  "💤",
];

// Short Yiddish/Hebrew exclamations, alongside the emoji above -- rendered
// as text pills rather than single glyphs (see ReactionLayer.tsx). Kept to a
// tasteful handful rather than an exhaustive phrasebook.
export const REACTION_PHRASES = [
  "בהצלחה", // B'hatzlacha! -- good luck
  "מזל טוב", // Mazel tov! -- congratulations
  "אוי וויי", // Oy vey -- dismay
  "קיין עין הרע", // Kein ayin hara -- no evil eye / knock wood
  "גוואלד", // Gevalt! -- shock/alarm
  "נו?", // Nu? -- well?/c'mon
  "גיי שוין", // Gai shoyn! -- go already! (for the slowpokes)
];

// In-game banter, kept separate from REACTION_PHRASES since those render
// right-to-left (see ReactionLayer.tsx's dir="rtl" wrapper) and these don't.
// Echoes the table's own vocabulary (PlayerDock's BANK! button, the
// "You Futched!" outcome toast) so a reaction always reads as the same
// moment the game itself just called out.
export const REACTION_GAME_CALLS = [
  "BANK!",
  "Futched!",
  "Stay",
  "Nice hand!",
  "So close!",
  "Deal me in!",
];

export function usableCards(cards: Card[]): Card[] {
  return cards.filter((card) => !card.attributes?.eleveroonIgnored);
}

export function isRosierPair(cards: Card[]): boolean {
  const visible = usableCards(cards);
  if (visible.length < 2) return false;
  const [first, second] = visible;
  return first.attributes.type === "rosier" && second.attributes.type === "rosier";
}

// Mirrors backend/src/turn.ts's calcSums, including its two prunings -- see
// that function's comment for why collapsing duplicate and busted readings is
// free, and why the un-pruned product can't be left to grow.
export function allTotals(cards: Card[]): number[] {
  const visible = usableCards(cards);
  if (visible.length === 0) return [0];
  let sums = [0];
  for (const card of visible) {
    const values = (card.attributes?.values?.length ? card.attributes.values : [Number(card.name)])
      .filter((v) => Number.isFinite(v));
    if (values.length === 0) continue;
    const next = new Set<number>();
    let smallestBust: number | undefined;
    for (const sum of sums) {
      for (const value of values) {
        const total = sum + value;
        if (total > 21) {
          if (smallestBust === undefined || total < smallestBust) smallestBust = total;
        } else {
          next.add(total);
        }
      }
    }
    if (smallestBust !== undefined) next.add(smallestBust);
    sums = [...next];
  }
  return sums;
}

export function bestTotal(cards: Card[]): { total?: number; bustedTotal?: number } {
  const visible = usableCards(cards);
  if (visible.length === 0) return { total: 0 };
  if (isRosierPair(visible)) return { total: 21 };
  const totals = allTotals(visible);
  const valid = totals.filter((sum) => sum <= 21);
  if (valid.length > 0) return { total: Math.max(...valid) };
  if (totals.length === 0) return { total: 0 };
  return { bustedTotal: Math.min(...totals) };
}

export function fullName(player: Player): string {
  return [player.firstName, player.lastName].filter(Boolean).join(" ").trim();
}

export function formatNames(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

export function isPushTurn(turn: Turn): boolean {
  const wager = turn.bet ?? 0;
  const settled = turn.settledBet ?? wager;
  return turn.state === "won" && wager === 0 && settled === 0;
}

// Chips the bank has tied up covering this player's wager: money it has
// promised but not yet paid out or collected. A hand the bank already won
// (lost/skipped) or has settled live frees its reservation again.
//
// This is the single definition behind both what a player is allowed to bet
// (useTableData's bankInfo) and what the felt draws (BankReservations) -- if
// the two ever disagreed, the table would show one number and enforce
// another.
export function reservedAgainst(turn: Turn): number {
  if (turn.player.type === "admin") return 0;
  if (turn.state === "lost" || turn.state === "skipped") return 0;
  if (turn.settled) return 0;
  return Math.max(0, turn.bet ?? 0);
}
export function totalDisplay(
  turn: Turn,
  viewerId?: string,
  _roundState?: RoundPhase,
  opts?: { forceBankerReveal?: boolean }
): {
  prefix: string;
  value: string;
  wrapperClassName?: string;
  valueClassName?: string;
} {
  const prefix = "Total:";
  const { total, bustedTotal } = bestTotal(turn.cards);
  const isOwnerView = viewerId === turn.player.id;
  const isBanker = turn.player.type === "admin";
  const isBlattPhase = (turn.bet ?? 0) === 0;
  const bankerResolved = turn.state === "lost" || turn.state === "standby" || turn.state === "won";
  const forceBankerReveal = opts?.forceBankerReveal;

  if (!isOwnerView && isBanker && !bankerResolved && !forceBankerReveal) {
    const visible = turn.cards.slice(1);
    if (visible.length === 0)
      return { prefix, value: "hidden", wrapperClassName: "text-slate-500", valueClassName: "text-slate-500" };
    const { total: vTotal, bustedTotal: vBusted } = bestTotal(visible);
    if (vTotal !== undefined) return { prefix, value: `${vTotal}` };
    if (vBusted !== undefined) return { prefix, value: `${vBusted}`, valueClassName: "text-rose-700 font-bold" };
    return { prefix, value: "hidden", wrapperClassName: "text-slate-500", valueClassName: "text-slate-500" };
  }
  // A player's total is NOT revealed just because they stood (turn.state
  // "standby") -- their wager cards stay face-down to everyone else at that
  // point too (see Seat.tsx's own isPublicStandby, which only ever shows
  // pre-bet "blatt" cards while standing, never the bet/hit cards). Revealing
  // the aggregate total here while the cards behind it stay hidden would be
  // a real information leak to players still deciding their own hand.
  // calculateEndState always resolves a standing player to won/lost once the
  // round actually terminates (round.ts), so the reveal below still lands at
  // exactly the right moment -- this only holds the total back while the
  // outcome is genuinely still undecided.
  // `!isBanker` matters here and didn't used to be checked: isBlattPhase reads
  // turn.bet === 0, which means "no wager" for a PLAYER, but calculateEndState
  // (round.ts) repurposes the admin turn's own `bet` to hold its round-net
  // balance once resolved -- $0 there means "broke even," not "never bet."
  // Landing on exactly $0 net is an ordinary outcome (one seat's win offsets
  // another's loss), not an edge case, and without this guard a busted banker
  // whose round net happened to net to 0 fell into this branch and had its
  // displayed total recomputed from `cards.slice(1)` -- silently dropping the
  // hole card and showing a stale, non-busted number instead of the real
  // bust total (reported live 2026-08-27: "the banker busted but his tally
  // didn't reflect the busted total").
  if (!isOwnerView && !isBanker && isBlattPhase) {
    const visible = turn.cards.slice(1);
    const { total: vTotal, bustedTotal: vBusted } = bestTotal(visible);
    if (vTotal !== undefined) return { prefix, value: `${vTotal}` };
    if (vBusted !== undefined) return { prefix, value: `${vBusted}`, valueClassName: "text-rose-700 font-bold" };
    return { prefix, value: "--", wrapperClassName: "text-slate-500", valueClassName: "text-slate-500" };
  }

  const canRevealTotal = isOwnerView || turn.state === "won" || turn.state === "lost" || forceBankerReveal;
  const revealForOwnerStandby = isOwnerView && turn.state === "standby";
  if (!canRevealTotal && !revealForOwnerStandby) {
    return { prefix, value: "hidden", wrapperClassName: "text-slate-500", valueClassName: "text-slate-500" };
  }
  if (turn.state === "lost" && total === undefined && bustedTotal !== undefined) {
    return { prefix, value: `${bustedTotal}`, valueClassName: "text-rose-700 font-bold" };
  }
  if (total !== undefined) return { prefix, value: `${total}` };
  if (bustedTotal !== undefined) return { prefix, value: `${bustedTotal}` };
  return { prefix, value: "--", wrapperClassName: "text-slate-500", valueClassName: "text-slate-500" };
}

// Maps a statusDisplay() label onto the felt-table pill variants (Seat.tsx,
// Dealer.tsx) -- one shared mapping so the banker's own bust/win tag can
// never silently drift out of sync with a regular player's again.
export function tagVariant(label: string, isCurrentTurn: boolean): string {
  if (isCurrentTurn) return "turn";
  if (label === "BANK 21!") return "natural";
  if (label === "WON") return "won";
  if (label === "LOST" || label === "FUTCHED!") return "bust";
  if (label === "STANDING") return "stand";
  // Banker split results (see bankerOutcome). A mixed round is genuinely
  // neither a win nor a loss for the bank, so it takes the neutral amber
  // rather than being forced into one or the other.
  if (label.startsWith("BEAT") && label.includes("LOST")) return "stand";
  if (label.startsWith("BEAT")) return "won";
  if (label.startsWith("LOST TO")) return "bust";
  return "muted";
}

// The banker plays ONE hand against the whole table, so "did the bank win?"
// has no single answer: an 18 beats a 17 and loses to a 20 in the same round.
// The server's turn.state can't express that -- it doubles as the banker's
// money result, so a banker who beat three players but paid out one big wager
// comes back "lost", which a player holding 17 quite reasonably read as "the
// bank lost to me".
//
// Returns undefined while the round is still live: `beat`/`lostTo` are only
// ever set by the server at settlement (calculateEndState), so their presence
// is also the signal that there's a final outcome to show at all.
export function bankerOutcome(turn: Turn): { label: string; className: string } | undefined {
  if (turn.player.type !== "admin") return undefined;
  if (turn.beat === undefined || turn.lostTo === undefined) return undefined;
  if (turn.busted) return { label: "FUTCHED!", className: "text-rose-700 font-bold" };
  const { beat, lostTo } = turn;
  if (beat === 0 && lostTo === 0) return { label: "NO WAGERS", className: "text-slate-500" };
  if (lostTo === 0) return { label: `BEAT ${beat}`, className: "text-emerald-700 font-bold" };
  if (beat === 0) return { label: `LOST TO ${lostTo}`, className: "text-rose-600 font-semibold" };
  return { label: `BEAT ${beat} · LOST ${lostTo}`, className: "text-orange-600 font-bold" };
}

export function statusDisplay(turn: Turn): { label: string; className: string } {
  const banker = bankerOutcome(turn);
  if (banker) return banker;
  // The banker hitting exactly 21 outright beats everyone still live in
  // the round, the same instant a bust futches them -- it deserves the
  // same kind of stand-out moment FUTCHED! gets, not the plain "WON" a
  // player's ordinary showdown win shows. bankerOutcome (above) already
  // claims this turn once beat/lostTo exist post-settlement (the "BEAT N"
  // tag), so this only ever fires in the live window before that -- same
  // mid-turn timing as App.tsx's own natural-21 sound check.
  // Reads off the turn's own live cards/state rather than a once-per-round
  // flag, so a SECOND banker hand within one round (a BANK! wager's forced
  // auto-redeal -- see store.ts's settleBankOutcome) gets caught the same
  // way if it also lands on 21.
  //
  // Must sit ABOVE isPushTurn, which is where it used to live (inside the
  // `state === "won"` block below) and was unreachable: a push is a returned
  // wager, and the bank never wagers, so its bet === 0 read as a push and
  // returned "PUSH" first. That's exactly the live-window case this branch
  // was written for -- an auto-redealt second hand carries no beat/lostTo,
  // so bankerOutcome doesn't claim it either.
  if (turn.player.type === "admin" && turn.state === "won" && bestTotal(turn.cards).total === 21) {
    return { label: "BANK 21!", className: "text-amber-700 font-bold" };
  }
  if (isPushTurn(turn)) return { label: "PUSH", className: "text-slate-600 font-semibold" };
  if (turn.state === "standby") return { label: "STANDING", className: "text-orange-600 font-bold" };
  if (turn.state === "won") {
    return { label: "WON", className: "text-emerald-700 font-bold" };
  }
  if (turn.state === "lost") {
    // `turn.busted` wins when present -- a server-backfilled history turn
    // carries no cards to derive this from (see the `busted` field on Turn).
    const busted =
      turn.busted ??
      (() => {
        const { total, bustedTotal } = bestTotal(turn.cards);
        return total === undefined && bustedTotal !== undefined;
      })();
    if (busted) return { label: "FUTCHED!", className: "text-rose-700 font-bold" };
    return { label: "LOST", className: "text-rose-600 font-semibold" };
  }
  if (turn.state === "skipped") return { label: "Skipped", className: "text-slate-500" };
  if (turn.state === "pending") return { label: "Waiting...", className: "text-slate-500" };
  return { label: "", className: "text-slate-500" };
}

export function betDisplay(turn: Turn, includeBanker = false): { label: string; className: string } {
  if (turn.player.type === "admin" && !includeBanker) return { label: "—", className: "text-slate-400" };
  if (turn.player.type === "admin" && includeBanker && typeof turn.settledNet === "number") {
    const signed = turn.settledNet >= 0 ? `+$${Math.abs(turn.settledNet)}` : `-$${Math.abs(turn.settledNet)}`;
    const tone = turn.settledNet >= 0 ? "text-emerald-600 font-semibold" : "text-rose-600 font-semibold";
    return { label: signed, className: tone };
  }
  const baseBet = turn.bet ?? 0;
  const amount = baseBet > 0 ? baseBet : turn.settledBet ?? baseBet;
  if (isPushTurn(turn)) return { label: "$0", className: "text-slate-500" };
  if (turn.state === "won") return { label: `+$${Math.abs(amount)}`, className: "text-emerald-600 font-semibold" };
  if (turn.state === "lost") return { label: `-$${Math.abs(amount)}`, className: "text-rose-600 font-semibold" };
  if (amount === 0) return { label: "$0", className: "text-slate-400" };
  return { label: `$${amount}`, className: "text-slate-600" };
}
