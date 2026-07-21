import { Card, Player, RoundPhase, Turn } from "../types";
export const cardImages: Record<string, string> = {
  "1": "/1.png",
  "2": "/2.png",
  "3": "/3.png",
  "4": "/4.png",
  "5": "/5.png",
  "6": "/6.png",
  "7": "/7.png",
  "8": "/8.png",
  "9": "/9.png",
  "10": "/10.png",
  "11": "/11.png",
  "12": "/12.png",
  blank: "/blank.png",
};

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
  "💤",
  "💯",
  "✅",
  "❌",
  "🤑",
  "😭",
  "🤡",
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

export function allTotals(cards: Card[]): number[] {
  const visible = usableCards(cards);
  if (visible.length === 0) return [0];
  return visible.reduce<number[]>((sums, card, index) => {
    const values = (card.attributes?.values?.length ? card.attributes.values : [Number(card.name)])
      .filter((v) => Number.isFinite(v));
    if (index === 0) return [...values];
    const combos: number[] = [];
    sums.forEach((sum) => values.forEach((value) => combos.push(sum + value)));
    return combos;
  }, []);
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
  const isPublicStandby = turn.state === "standby";

  if (!isOwnerView && isBanker && !bankerResolved && !forceBankerReveal) {
    const visible = turn.cards.slice(1);
    if (visible.length === 0)
      return { prefix, value: "hidden", wrapperClassName: "text-slate-500", valueClassName: "text-slate-500" };
    const { total: vTotal, bustedTotal: vBusted } = bestTotal(visible);
    if (vTotal !== undefined) return { prefix, value: `${vTotal}` };
    if (vBusted !== undefined) return { prefix, value: `${vBusted}`, valueClassName: "text-rose-700 font-bold" };
    return { prefix, value: "hidden", wrapperClassName: "text-slate-500", valueClassName: "text-slate-500" };
  }
  if (isPublicStandby) {
    if (total !== undefined) return { prefix, value: `${total}` };
    if (bustedTotal !== undefined) return { prefix, value: `${bustedTotal}`, valueClassName: "text-rose-700 font-bold" };
    return { prefix, value: "--", wrapperClassName: "text-slate-500", valueClassName: "text-slate-500" };
  }
  if (!isOwnerView && isBlattPhase) {
    const visible = turn.cards.slice(1);
    const { total: vTotal, bustedTotal: vBusted } = bestTotal(visible);
    if (vTotal !== undefined) return { prefix, value: `${vTotal}` };
    if (vBusted !== undefined) return { prefix, value: `${vBusted}`, valueClassName: "text-rose-700 font-bold" };
    return { prefix, value: "--", wrapperClassName: "text-slate-500", valueClassName: "text-slate-500" };
  }

  const canRevealTotal =
    isOwnerView || turn.state === "won" || turn.state === "lost" || isPublicStandby || forceBankerReveal;
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

export function statusDisplay(turn: Turn): { label: string; className: string } {
  if (isPushTurn(turn)) return { label: "PUSH", className: "text-slate-600 font-semibold" };
  if (turn.state === "standby") return { label: "STANDING", className: "text-orange-600 font-bold" };
  if (turn.state === "won") return { label: "WON", className: "text-emerald-700 font-bold" };
  if (turn.state === "lost") {
    const { total, bustedTotal } = bestTotal(turn.cards);
    const busted = total === undefined && bustedTotal !== undefined;
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
