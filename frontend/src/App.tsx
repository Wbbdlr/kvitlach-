import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { clsx } from "clsx";
import { useGameStore } from "./state";
import { Card, Player, RoomState, RoundPhase, RoundState, Turn } from "./types";
import { AudioManager } from "./audio";

const cardImages: Record<string, string> = {
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

function usableCards(cards: Card[]): Card[] {
  return cards.filter((card) => !card.attributes?.eleveroonIgnored);
}

function isRosierPair(cards: Card[]): boolean {
  const visible = usableCards(cards);
  if (visible.length < 2) return false;
  const [first, second] = visible;
  return first.attributes.type === "rosier" && second.attributes.type === "rosier";
}

function allTotals(cards: Card[]): number[] {
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

function bestTotal(cards: Card[]): { total?: number; bustedTotal?: number } {
  const visible = usableCards(cards);
  if (visible.length === 0) return { total: 0 };
  if (isRosierPair(visible)) return { total: 21 };
  const totals = allTotals(visible);
  const valid = totals.filter((sum) => sum <= 21);
  if (valid.length > 0) return { total: Math.max(...valid) };
  if (totals.length === 0) return { total: 0 };
  return { bustedTotal: Math.min(...totals) };
}

function fullName(player: Player): string {
  return [player.firstName, player.lastName].filter(Boolean).join(" ").trim();
}

function formatNames(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function isPushTurn(turn: Turn): boolean {
  const wager = turn.bet ?? 0;
  const settled = turn.settledBet ?? wager;
  return turn.state === "won" && wager === 0 && settled === 0;
}

function totalDisplay(
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
  const roundState = _roundState;
  const prefix = "Total:";
  const { total, bustedTotal } = bestTotal(turn.cards);
  const isOwnerView = viewerId === turn.player.id;
  const isBanker = turn.player.type === "admin";
  const isBlattPhase = (turn.bet ?? 0) === 0;
  const bankerResolved = turn.state === "lost" || turn.state === "standby" || turn.state === "won";
  const forceBankerReveal = opts?.forceBankerReveal;
  const isPublicStandby = turn.state === "standby";

  // For non-owners viewing player hands (including the banker), keep totals hidden until the hand resolves or the round ends.
  if (
    !isOwnerView &&
    !isBanker &&
    roundState !== "terminate" &&
    turn.state !== "won" &&
    turn.state !== "lost"
  ) {
    return { prefix, value: "hidden", wrapperClassName: "text-slate-500", valueClassName: "text-slate-500" };
  }

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

function statusDisplay(turn: Turn): { label: string; className: string } {
  if (isPushTurn(turn)) return { label: "PUSH", className: "text-slate-600 font-semibold" };
  if (turn.state === "standby") return { label: "STANDING", className: "text-orange-600 font-bold" };
  if (turn.state === "won") return { label: "WON", className: "text-emerald-700 font-bold" };
  if (turn.state === "lost") {
    const { total, bustedTotal } = bestTotal(turn.cards);
    const busted = total === undefined && bustedTotal !== undefined;
    if (busted) return { label: "BUSTED", className: "text-rose-700 font-bold" };
    return { label: "LOST", className: "text-rose-600 font-semibold" };
  }
  if (turn.state === "skipped") return { label: "Skipped", className: "text-slate-500" };
  if (turn.state === "pending") return { label: "Waiting...", className: "text-slate-500" };
  return { label: "", className: "text-slate-500" };
}

function betDisplay(turn: Turn, includeBanker = false): { label: string; className: string } {
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

function CardView({ card, hidden, size = "md" }: { card: Card; hidden?: boolean; size?: "md" | "lg" }) {
  const key = hidden ? "blank" : card.name;
  const src = cardImages[key] ?? cardImages.blank;
  const alt = hidden ? "Face-down card" : `Card ${card.name}`;
  const showFallback = !hidden && !cardImages[key];
  const sizeClass = size === "lg" ? "w-16 h-24" : "w-12 h-16";
  const ignored = Boolean(card.attributes?.eleveroonIgnored);

  return (
    <div
      className={clsx(
        `${sizeClass} rounded-lg border bg-transparent shadow-none overflow-hidden relative`,
        hidden ? "border-transparent" : "border-transparent",
        ignored && "opacity-60 grayscale border-slate-300"
      )}
    >
      <img src={src} alt={alt} className="w-full h-full object-contain" />
      {showFallback && (
        <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-slate-700">
          {card.name}
        </span>
      )}
      {ignored && !hidden && (
        <span className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold text-slate-600 bg-white/40">
          Eleveroon
        </span>
      )}
    </div>
  );
}

function WalletBadge({
  player,
  amount,
  turnPosition,
  onClick,
}: {
  player: Player;
  amount?: number;
  turnPosition?: "active" | "next";
  onClick?: (playerId: string) => void;
}) {
  const name = [player.firstName, player.lastName].filter(Boolean).join(" ");
  const isBanker = player.type === "admin";
  const presenceTone = player.presence === "online" ? "bg-emerald-500" : "bg-slate-300";
  return (
    <div
      className={clsx(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold shadow-sm bg-white",
        isBanker ? "border-amber-200 text-amber-700" : "border-slate-200 text-slate-600"
      )}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : -1}
      onClick={onClick ? () => onClick(player.id) : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(player.id); } } : undefined}
      style={onClick ? { cursor: "pointer" } : undefined}
    >
      <span className="inline-flex items-center gap-1">
        <span className={clsx("h-2.5 w-2.5 rounded-full", presenceTone)} aria-hidden="true"></span>
        {isBanker && (
          <svg className="h-3 w-3 text-amber-600" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path d="M10 2l7 3v2h-1v8h1v2H3v-2h1V7H3V5l7-3zm-4 5v8h2V7H6zm4 0v8h2V7h-2zm4 0v8h2V7h-2z" />
          </svg>
        )}
        <span>{name || "Player"}</span>
      </span>
      {typeof amount === "number" && <span className="text-[11px] text-slate-500">${amount}</span>}
      {turnPosition && (
        <span
          className={clsx(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide",
            turnPosition === "active"
              ? "bg-blue-50 text-blue-700 border border-blue-200"
              : "bg-amber-50 text-amber-700 border border-amber-200"
          )}
        >
          {turnPosition === "active" ? "Active" : "Next"}
        </span>
      )}
    </div>
  );
}

function TurnCard({
  turn,
  isAdmin,
  viewerId,
  isActiveTurn,
  isNextTurn,
  roundState,
  onSkipOther,
  highlightBanker,
  walletAmount,
  betAmount,
  onBetChange,
  onBet,
  betError,
  onHit,
  onStand,
  isCompact,
  bankAvailable,
  bankAddAmount,
  bankSelected,
  onToggleBank,
  bankDisabled,
  bankDisabledReason,
  firstBetCardIndex,
  forceBankerReveal,
  eleveroonSelected,
  onToggleEleveroon,
  turnTimer,
}: {
  turn: Turn;
  isAdmin: boolean;
  viewerId?: string;
  isActiveTurn?: boolean;
  isNextTurn?: boolean;
  roundState?: RoundPhase;
  onSkipOther?: (playerId: string) => void;
  highlightBanker?: boolean;
  walletAmount?: number;
  betAmount?: string;
  onBetChange?: (value: string) => void;
  onBet?: () => void;
  betError?: string;
  onHit?: () => void;
  onStand?: () => void;
  isCompact?: boolean;
  bankAvailable?: number;
  bankAddAmount?: number;
  bankSelected?: boolean;
  onToggleBank?: (selected: boolean) => void;
  bankDisabled?: boolean;
  bankDisabledReason?: string;
  firstBetCardIndex?: Record<string, number>;
  forceBankerReveal?: boolean;
  eleveroonSelected?: boolean;
  onToggleEleveroon?: (selected: boolean) => void;
  turnTimer?: { playerId: string; remainingMs: number; percent: number; durationMs: number };
}) {
  const statusInfo = statusDisplay(turn);
  const isMe = viewerId === turn.player.id;
  const isBanker = turn.player.type === "admin";
  const canActTurn = isMe && turn.state === "pending" && isActiveTurn;
  const showPlayerControls = canActTurn && !isBanker && onBet && onHit && onStand && betAmount !== undefined && onBetChange;
  const showBankerControls = canActTurn && isBanker && !forceBankerReveal && onHit && onStand;
  const showEleveroonToggle = showPlayerControls || showBankerControls;
  const isCurrentTurn = Boolean(isActiveTurn && turn.state === "pending" && roundState !== "terminate");
  const isNextPlayer = Boolean(isNextTurn && !isCurrentTurn && turn.state === "pending" && roundState !== "terminate");
  const waitingForTurn = isMe && turn.state === "pending" && !canActTurn && roundState !== "terminate";
  const shouldForceReveal = isBanker && (forceBankerReveal || roundState === "final" || roundState === "terminate");
  const showBankerResolutionWait =
    isMe && turn.player.type !== "admin" && turn.state === "standby" && roundState !== "terminate";
  const totalInfo = totalDisplay(turn, viewerId, roundState, { forceBankerReveal: shouldForceReveal });
  const betInfo = betDisplay(turn);
  const bankerStyle = highlightBanker
    ? {
        background: "linear-gradient(135deg, #eef2ff 0%, #e0f2fe 50%, #f8fafc 100%)",
        borderColor: "#bfdbfe",
      }
    : undefined;
  const useCompact = Boolean(isCompact && !isCurrentTurn);
  const canAdminSkip = Boolean(isAdmin && turn.player.type !== "admin" && turn.state === "pending" && onSkipOther);
  const displayName = [turn.player.firstName, turn.player.lastName].filter(Boolean).join(" ");
  const nameLabel = displayName || turn.player.firstName;
  const isWaitingDisplay = turn.state === "pending" && !isCurrentTurn;
  const hasPlacedBet = (turn.bet ?? 0) > 0;
  const drawButtonLabel = hasPlacedBet ? "Hit" : "Blatt";
  const drawButtonTitle = hasPlacedBet
    ? "Draw one more card without changing your current wager."
    : "Take a Blatt to draw a face-up card without risking chips.";
  const headerStatus = !isCurrentTurn
    ? isWaitingDisplay
      ? { label: "Waiting...", className: "text-slate-500" }
      : statusInfo.label
      ? statusInfo
      : undefined
    : undefined;
  const showTurnTimer = Boolean(
    turnTimer &&
      turnTimer.playerId === turn.player.id &&
      turn.player.type !== "admin" &&
      turn.state === "pending" &&
      roundState !== "terminate"
  );
  const timerSecondsLeft = showTurnTimer ? Math.max(0, Math.ceil((turnTimer?.remainingMs ?? 0) / 1000)) : undefined;

  const header = (
    <div className="flex justify-between items-center flex-wrap gap-2">
      <div className="flex items-center gap-2 font-semibold">
        <span className="inline-flex items-center gap-1">
          {turn.player.type === "admin" && (
            <svg
              className="h-3.5 w-3.5 text-amber-600"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M10 2l7 3v2h-1v8h1v2H3v-2h1V7H3V5l7-3zm-4 5v8h2V7H6zm4 0v8h2V7h-2zm4 0v8h2V7h-2z" />
            </svg>
          )}
          <span>
            {nameLabel}
            {isMe && !useCompact ? " (Me)" : ""}
          </span>
        </span>
        {isMe && !useCompact && typeof walletAmount === "number" && (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
            <span className="text-[9px] uppercase tracking-[0.3em] text-emerald-600">Cash</span>
            <span>${walletAmount}</span>
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {headerStatus?.label && (
          <span className={clsx("text-xs uppercase tracking-wide", headerStatus.className)}>{headerStatus.label}</span>
        )}
        {isNextPlayer && (
          <span className="text-xs font-semibold text-amber-700 bg-amber-100 border border-amber-200 rounded px-2 py-0.5 uppercase tracking-wide">
            Up next
          </span>
        )}
        {isCurrentTurn && !useCompact && (
          <span className="text-xs font-semibold text-blue-600 bg-blue-50 border border-blue-200 rounded px-2 py-0.5 uppercase tracking-wide">
            {isMe ? "Your turn" : "Active turn"}
          </span>
        )}
      </div>
    </div>
  );

  if (useCompact) {
    return (
      <div className={clsx("card-surface p-3 flex flex-col gap-2 text-sm border border-slate-200")} style={bankerStyle}>
        {header}
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <div className="w-12 h-16 rounded-lg border border-transparent bg-transparent shadow-none overflow-hidden">
            <img src="/blank.png" alt="Banker card back" className="w-full h-full object-contain opacity-80" />
          </div>
          <span>Banker reveals after every player finishes; the area expands once it is their turn.</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={clsx(
        "card-surface p-4 flex flex-col gap-2",
        isCurrentTurn && "ring-2 ring-blue-300 border-blue-300"
      )}
      style={bankerStyle}
    >
      {header}
      {showTurnTimer && (
        <div className="flex items-center gap-2 text-xs text-blue-700">
          <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-1 font-semibold">
            <span className="h-2 w-2 rounded-full bg-blue-500" aria-hidden="true"></span>
            <span>{timerSecondsLeft ?? 0}s left</span>
          </span>
          <div className="flex-1 h-1.5 min-w-[96px] rounded-full bg-slate-200 overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-[width] duration-300 ease-linear"
              style={{ width: `${turnTimer?.percent ?? 0}%` }}
              aria-hidden="true"
            ></div>
          </div>
        </div>
      )}
      <div className="flex gap-2 flex-wrap text-sm items-center">
        {turn.cards.map((c, idx) => {
          const isOwnerView = viewerId === turn.player.id;
          const isBlattPhase = (turn.bet ?? 0) === 0;
          const bankerReveal = turn.player.type !== "admin" ? true : forceBankerReveal || turn.state !== "pending";
          const roundFinished = roundState === "terminate" || forceBankerReveal;
          const betStart = firstBetCardIndex?.[turn.player.id];
          const totals = bestTotal(turn.cards);
          const resolved = turn.state === "lost" || turn.state === "won";
          const auto21 = totals.total === 21 || isRosierPair(turn.cards);
            const standbyReveal = false;

            const hasBet = typeof betStart === "number";
            const isInitialCard = idx === 0;
            const isBlattCard = hasBet ? idx > 0 && idx < betStart : isBlattPhase && idx > 0;
            const isBetOrHitCard = hasBet ? idx >= betStart : false;

          let hide = true;
          if (isOwnerView) {
            hide = false;
          } else if (turn.player.type === "admin") {
            hide = idx === 0 && !bankerReveal;
            } else if (resolved || standbyReveal || roundFinished) {
            hide = false;
            } else if (turn.state === "standby") {
              // Standing but unresolved: keep non-blatt hidden, blatt cards stay visible.
              hide = !(isBlattCard && !isInitialCard);
            } else if (isBlattPhase) {
              // No bet yet: initial hidden, blatts visible.
              hide = idx === 0;
            } else if (hasBet) {
              // After bet: initial hidden; pre-bet blatts visible; bet/hit cards hidden until resolution.
              hide = isInitialCard || isBetOrHitCard ? true : !isBlattCard;
          } else {
            hide = true;
          }

          const shouldEnlarge = turn.player.type !== "admin" || isCurrentTurn;
          const cardSize = useCompact ? "md" : shouldEnlarge ? "lg" : "md";
          return <CardView key={idx} card={c} hidden={hide} size={cardSize} />;
        })}
      </div>
      <div className={clsx("text-xs", totalInfo.wrapperClassName ?? "text-slate-600")}> 
        {totalInfo.prefix}
        <span className={clsx("ml-1", totalInfo.valueClassName ?? totalInfo.wrapperClassName ?? "text-slate-600")}> 
          {totalInfo.value}
        </span>
      </div>
      {turn.player.type !== "admin" && (
        <div className="text-xs text-slate-600">
          Bet: <span className={clsx(betInfo.className)}>{betInfo.label}</span>
        </div>
      )}
      {canAdminSkip && (
        <button
          className="self-start inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-3 py-1 text-[11px] font-semibold text-rose-700 shadow-sm hover:border-rose-300 hover:text-rose-800"
          onClick={() => onSkipOther?.(turn.player.id)}
        >
          Skip player
        </button>
      )}
      {showPlayerControls && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="number"
            value={betAmount}
            min={0}
            step={1}
            onChange={(e) => onBetChange?.(e.target.value)}
            className="border rounded px-3 py-2 w-24"
            onFocus={(event) => event.target.select()}
          />
          {betError && <span className="text-xs text-rose-600 whitespace-nowrap">{betError}</span>}
          <label
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm transition-colors hover:border-slate-300"
            title="BANK! bets the remaining available bank for your seat; the banker must resolve this wager immediately for you and any already-standing players."
          >
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
              checked={bankSelected}
              disabled={bankDisabled}
              onChange={(event) => onToggleBank?.(event.target.checked)}
            />
            <span>BANK!</span>
            {typeof bankAvailable === "number" && (
              <span className="text-[11px] font-normal text-slate-500">Bank ${bankAvailable.toLocaleString()}</span>
            )}
            {typeof bankAddAmount === "number" && bankAddAmount > 0 && (
              <span className="text-[11px] font-normal text-slate-500">Adds ${bankAddAmount.toLocaleString()}</span>
            )}
          </label>
          {bankDisabled && bankDisabledReason && (
            <span className="text-[11px] text-rose-600">{bankDisabledReason}</span>
          )}
            {showEleveroonToggle && (
              <label
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm"
                title={
                  isBanker
                    ? "Eleveroon automatically ignores a single busting eleven for the banker."
                    : "Eleveroon lets you ignore one busting eleven when your total was 11."
                }
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  checked={Boolean(isBanker ? true : eleveroonSelected)}
                  disabled={isBanker}
                  onChange={(event) => onToggleEleveroon?.(event.target.checked)}
                />
                <span>Eleveroon</span>
                {isBanker && <span className="text-[11px] font-normal text-slate-500">Always on</span>}
              </label>
            )}
          <button
            className="bg-accent text-white px-3 py-2 rounded"
            title="Place or raise your wager; each bet also deals you one more card."
            onClick={onBet}
          >
            Bet
          </button>
          <button className="bg-blue-600 text-white px-3 py-2 rounded" title={drawButtonTitle} onClick={onHit}>
            {drawButtonLabel}
          </button>
          <button
            className="bg-ink text-white px-3 py-2 rounded"
            title="End your turn and keep the hand and wager you have."
            onClick={onStand}
          >
            Stand
          </button>
        </div>
      )}

      {waitingForTurn && <div className="text-xs text-slate-500 mt-2">Waiting for your turn...</div>}

      {showBankerResolutionWait && (
        <div className="mt-2 text-xs font-semibold text-amber-700 animate-pulse">
          Waiting for Banker to Play You Out
        </div>
      )}

      {showBankerControls && (
        <div className="flex flex-wrap gap-2 items-center mt-2">
          <button className="bg-blue-600 text-white px-3 py-2 rounded" title="Draw one more card." onClick={onHit}>
            Hit
          </button>
          <button className="bg-ink text-white px-3 py-2 rounded" title="End your turn." onClick={onStand}>
            Stand
          </button>
            {showEleveroonToggle && (
              <label
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm"
                title="Eleveroon automatically ignores a single busting eleven for the banker."
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 text-blue-600"
                  checked={true}
                  disabled
                />
                <span>Eleveroon</span>
                <span className="text-[11px] font-normal text-slate-500">Always on</span>
              </label>
            )}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const store = useGameStore();
  const {
    room,
    round,
    balances,
    playerId,
    message,
    status,
    wsUrl,
    roundHistory,
    notifications,
    bankerSummaryAt,
    connections,
  } = store;
  const [statsPlayerId, setStatsPlayerId] = useState<string | undefined>(undefined);
  const [bankerFirstName, setBankerFirst] = useState("");
  const [bankerLastName, setBankerLast] = useState("");
  const [joinFirstName, setJoinFirst] = useState("");
  const [joinLastName, setJoinLast] = useState("");
  const [roomIdInput, setRoomId] = useState("");
  const [roomName, setRoomName] = useState("");
  const [customRoomId, setCustomRoomId] = useState("");
  const [roomPassword, setRoomPassword] = useState("");
  const [joinPassword, setJoinPassword] = useState("");
  const [buyIn, setBuyIn] = useState(100);
  const [bankerBankroll, setBankerBankroll] = useState(100);
  const [bankerBankrollManuallySet, setBankerBankrollManuallySet] = useState(false);
  const [showBankAdjust, setShowBankAdjust] = useState(false);
  const [bankAdjustAmount, setBankAdjustAmount] = useState("");
  const [bankAdjustNote, setBankAdjustNote] = useState("");
  const [bankAdjustError, setBankAdjustError] = useState<string | undefined>(undefined);
  const [betAmount, setBet] = useState<string>("5");
  const [deckCount, setDeckCount] = useState<string>("");
  const [preferredDecks, setPreferredDecks] = useState<string>("");
  const [showHowTo, setShowHowTo] = useState(false);
  const [showWhatIs, setShowWhatIs] = useState(false);
  const [showLobby, setShowLobby] = useState(true);
  const [bankerFormExpanded, setBankerFormExpanded] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [renameFirstName, setRenameFirst] = useState("");
  const [renameLastName, setRenameLast] = useState("");
  const [showRenameForm, setShowRenameForm] = useState(false);
  const [showBuyInForm, setShowBuyInForm] = useState(false);
  const [buyInAmount, setBuyInAmount] = useState("");
  const [buyInNote, setBuyInNote] = useState("");
  const [bankBetSelected, setBankBetSelected] = useState(false);
  const [betError, setBetError] = useState<string | undefined>(undefined);
  const [eleveroonSelected, setEleveroonSelected] = useState(false);
  const [showContact, setShowContact] = useState(false);
  const [firstBetCardIndex, setFirstBetCardIndex] = useState<Record<string, number>>({});
  const [walletAdjustTarget, setWalletAdjustTarget] = useState<string | null>(null);
  const [walletAdjustAmount, setWalletAdjustAmount] = useState("");
  const [walletAdjustNote, setWalletAdjustNote] = useState("");
  const [walletAdjustError, setWalletAdjustError] = useState<string | undefined>(undefined);
  const [pendingKick, setPendingKick] = useState<{ playerId: string; label: string } | null>(null);
  const [nowTs, setNowTs] = useState(() => Date.now());
  const [musicEnabled, setMusicEnabled] = useState(false);
  const [sfxEnabled, setSfxEnabled] = useState(true);
  const [userInteracted, setUserInteracted] = useState(false);
  const audioManager = useMemo(() => new AudioManager(), []);
  const prevRoundRef = useRef<RoundState | undefined>(undefined);
  const prefilledRoomIdRef = useRef(false);
  const formErrors = store.formErrors ?? {};
  const dismissNotification = store.dismissNotification;
  const dismissBankerSummary = store.dismissBankerSummary;

  // Normalize turns early so hooks below can safely depend on this array.
  const turns = round?.turns?.filter(Boolean) ?? [];

  useEffect(() => {
    if (prefilledRoomIdRef.current) return;
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get("room");
    if (fromQuery) {
      setRoomId(fromQuery);
      prefilledRoomIdRef.current = true;
      return;
    }
    const lastRoom = window.localStorage.getItem("kvitlach.lastRoomId");
    if (lastRoom) {
      setRoomId(lastRoom);
      prefilledRoomIdRef.current = true;
    }
  }, []);

  useEffect(() => {
    if (formErrors.create) setBankerFormExpanded(true);
  }, [formErrors.create]);

  useEffect(() => {
    const markInteraction = () => {
      if (!userInteracted) setUserInteracted(true);
      audioManager.noteInteraction();
    };
    const handlePointerDown = (event: PointerEvent) => {
      markInteraction();
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable], [role='textbox']")) return;
      const active = document.activeElement as HTMLElement | null;
      if (active && active.blur && active !== document.body && active.matches("input, textarea, select")) {
        active.blur();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [audioManager, userInteracted]);

  useEffect(() => {
    if (room) setShowLobby(false);
  }, [room]);

  useEffect(() => {
    // Reset bet tracking when the round changes
    setFirstBetCardIndex({});
  }, [round?.roundId]);

  useEffect(() => {
    // Record the index of the first card drawn with a wager so we can keep earlier Blatt cards visible to others.
    if (!round) return;
    const next: Record<string, number> = { ...firstBetCardIndex };
    let changed = false;
    turns.forEach((t) => {
      if ((t.bet ?? 0) > 0 && next[t.player.id] === undefined && t.cards.length > 0) {
        next[t.player.id] = Math.max(1, t.cards.length - 1);
        changed = true;
      }
    });
    if (changed) setFirstBetCardIndex(next);
  }, [turns, round, firstBetCardIndex]);

  useEffect(() => {
    // Reset Eleveroon selection when a new round begins.
    setEleveroonSelected(false);
  }, [round?.roundId]);

  useEffect(() => {
    // Keep manager flags in sync with UI toggles.
    audioManager.setSfxEnabled(sfxEnabled);
  }, [audioManager, sfxEnabled]);

  useEffect(() => {
    audioManager.setMusicEnabled(musicEnabled && userInteracted);
    return () => audioManager.setMusicEnabled(false);
  }, [audioManager, musicEnabled, userInteracted]);

  useEffect(() => {
    if (!round) {
      prevRoundRef.current = undefined;
      return;
    }
    const prev = prevRoundRef.current;
    if (!prev || prev.roundId !== round.roundId) {
      prevRoundRef.current = round;
      return;
    }

    round.turns.forEach((turn) => {
      const prevTurn = prev.turns.find((t) => t.player.id === turn.player.id);
      if (!prevTurn) return;
      if ((turn.cards?.length ?? 0) > (prevTurn.cards?.length ?? 0)) {
        audioManager.playSfx("deal");
      }
      if (turn.state !== prevTurn.state) {
        if (turn.state === "won") audioManager.playSfx("win");
        if (turn.state === "lost") {
          const { total, bustedTotal } = bestTotal(turn.cards);
          const busted = total === undefined && bustedTotal !== undefined;
          if (busted) audioManager.playSfx("bust");
        }
      }
    });

    prevRoundRef.current = round;
  }, [audioManager, round]);

  useEffect(() => {
    const interval = window.setInterval(() => setNowTs(Date.now()), 500);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    // Clear or collapse the wallet adjustment form when players or rooms change.
    if (!room?.roomId) {
      setWalletAdjustTarget(null);
      setWalletAdjustAmount("");
      setWalletAdjustNote("");
      setWalletAdjustError(undefined);
      return;
    }
    if (walletAdjustTarget && !room.players.some((p) => p.id === walletAdjustTarget)) {
      setWalletAdjustTarget(null);
      setWalletAdjustAmount("");
      setWalletAdjustNote("");
      setWalletAdjustError(undefined);
    }
  }, [room?.roomId, room?.players, walletAdjustTarget]);

  useEffect(() => {
    if (!bankerBankrollManuallySet) {
      setBankerBankroll(buyIn);
    }
  }, [buyIn, bankerBankrollManuallySet]);

  useEffect(() => {
    if (bankerBankrollManuallySet && bankerBankroll === buyIn) {
      setBankerBankrollManuallySet(false);
    }
  }, [bankerBankroll, buyIn, bankerBankrollManuallySet]);

  useEffect(() => {
    store.init();
  }, []);
  const me = room?.players.find((p) => p.id === playerId);
  const bankerTurns = turns.filter((t) => t.player?.type === "admin");
  const playerTurns = turns.filter((t) => t.player?.type !== "admin");
  const myTurn = turns.find((t) => t.player?.id === playerId);
  const myPlayerTurn = playerTurns.find((t) => t.player?.id === playerId);
  const otherPlayerTurns = playerTurns.filter((t) => t.player?.id !== playerId);
  const isAdmin = room?.players.find((p) => p.id === playerId)?.type === "admin";
  const pendingTurns = useMemo(() => turns.filter((t) => t.state === "pending"), [turns]);
  const overviewTurns = useMemo(() => {
    const banker = turns.filter((t) => t.player.type === "admin");
    const others = turns.filter((t) => t.player.type !== "admin");
    return [...banker, ...others];
  }, [turns]);
  const bankLock = round?.bankLock;
  const primaryBankerTurn = bankerTurns[0];
  const activeTurnId = useMemo(() => {
    if (round?.state === "final" && primaryBankerTurn?.player?.id) return primaryBankerTurn.player.id;
    if (bankLock?.stage === "banker" && primaryBankerTurn?.player?.id) return primaryBankerTurn.player.id;
    if (bankLock?.stage === "player" && bankLock.playerId) return bankLock.playerId;
    return pendingTurns[0]?.player.id;
  }, [round?.state, bankLock?.playerId, bankLock?.stage, pendingTurns, primaryBankerTurn?.player?.id]);
  const nextTurnId = useMemo(() => {
    if (bankLock?.stage === "banker") return pendingTurns[0]?.player.id;
    return pendingTurns[1]?.player.id;
  }, [bankLock?.stage, pendingTurns]);
  const activeTimerPlayerId = round?.turnTimerPlayerId;
  const activeTimerRemainingMs = round?.turnTimerExpiresAt ? Math.max(round.turnTimerExpiresAt - nowTs, 0) : undefined;
  const turnTimerDurationMs = round?.turnTimerDurationMs ?? 90_000;
  const activeTurnTimer = useMemo(() => {
    if (!activeTimerPlayerId || activeTimerRemainingMs === undefined) return undefined;
    const percent = Math.max(0, Math.min(100, Math.round((activeTimerRemainingMs / turnTimerDurationMs) * 100)));
    return { playerId: activeTimerPlayerId, remainingMs: activeTimerRemainingMs, percent, durationMs: turnTimerDurationMs };
  }, [activeTimerPlayerId, activeTimerRemainingMs, turnTimerDurationMs]);
  const bankerActive = bankerTurns.some((t) => t.player?.id === activeTurnId);
  const bankerCompact = Boolean(round && !bankerActive && round.state !== "terminate" && round.state !== "final");
  const canAct =
    !!myTurn &&
    myTurn.player?.id === playerId &&
    myTurn.state === "pending" &&
    activeTurnId === playerId &&
    bankLock?.stage !== "decision";
  const bankerPlayer = useMemo(() => room?.players.find((p) => p.type === "admin"), [room?.players]);
  const bankInfo = useMemo(() => {
    if (!round || !bankerPlayer || !myPlayerTurn) return undefined;
    const bankerWallet = room?.wallets?.[bankerPlayer.id] ?? 0;
    const playerIndex = round.turns.findIndex((turn) => turn.player.id === myPlayerTurn.player.id);
    if (playerIndex < 0) return undefined;
    const outstanding = round.turns
      .slice(0, playerIndex)
      .filter((turn) => turn.player.type !== "admin" && turn.state !== "lost" && turn.state !== "skipped")
      .reduce((sum, turn) => sum + (turn.bet ?? 0), 0);
    const available = Math.max(bankerWallet - outstanding, 0);
    return { available, outstanding, bankerWallet, playerIndex };
  }, [round, bankerPlayer, myPlayerTurn, room?.wallets]);
  const currentBetAmount = myPlayerTurn?.bet ?? 0;
  const bankIncrement = useMemo(() => {
    if (!bankInfo) return 0;
    return Math.max(bankInfo.available - currentBetAmount, 0);
  }, [bankInfo, currentBetAmount]);
  const canBank = Boolean(bankInfo && bankInfo.available > 0 && bankIncrement > 0);
  const bankDisabledReason = useMemo(() => {
    if (!bankInfo) return "Bank unavailable.";
    if (bankInfo.available <= 0) return "Bank is empty.";
    if (bankIncrement <= 0) return "Current wager already matches the bank.";
    return undefined;
  }, [bankInfo, bankIncrement]);
  const bankerDecisionRequired = Boolean(isAdmin && bankLock?.stage === "decision");
  const viewerWaitingForBankDecision = Boolean(!isAdmin && bankLock?.stage === "decision");
  const bankShowdownActive = bankLock?.stage === "banker";
  const bankShowdownPlayer = bankLock?.playerId
    ? room?.players.find((p) => p.id === bankLock.playerId)
    : undefined;
  const bankShowdownName = bankShowdownPlayer ? fullName(bankShowdownPlayer) || bankShowdownPlayer.firstName : "the bank";
  const bankPlayerActing = bankLock?.stage === "player";
  const showBankSummary = Boolean(bankerSummaryAt);
  const latestSummary = roundHistory?.[0];
  const totalStakes = useMemo(
    () =>
      turns
        .filter((t) => t.player.type !== "admin")
        .reduce((sum, turn) => sum + Math.max(0, turn.bet ?? 0), 0),
    [turns]
  );
  const bankerWalletTotal = bankerPlayer ? room?.wallets?.[bankerPlayer.id] ?? 0 : undefined;

  useEffect(() => {
    setBankBetSelected(false);
  }, [myPlayerTurn?.player.id, round?.roundId]);
  useEffect(() => {
    if (!betError) return;
    const timer = setTimeout(() => setBetError(undefined), 3000);
    return () => clearTimeout(timer);
  }, [betError]);
  const renameRequests = room?.renameRequests ?? [];
  const myRenameRequest = renameRequests.find((req) => req.playerId === playerId);
  const buyInRequests = room?.buyInRequests ?? [];
  const myBuyInRequest = buyInRequests.find((req) => req.playerId === playerId);
  const pendingBankerTasks = renameRequests.length + buyInRequests.length;
  const waitingPlayerIds = room?.waitingPlayerIds ?? [];
  const waitingPlayers = waitingPlayerIds
    .map((id) => room?.players.find((p) => p.id === id))
    .filter((p): p is Player => Boolean(p));
  const isViewerWaiting = Boolean(playerId && waitingPlayerIds.includes(playerId));
  const waitingNamesForView = formatNames(
    [
      ...(isViewerWaiting ? ["You"] : []),
      ...waitingPlayers
        .filter((p) => p.id !== playerId)
        .map((p) => fullName(p) || "New player"),
    ].filter(Boolean)
  );
  const roundInProgress = Boolean(round && round.state !== "terminate");
  const roomDisplayName = (room?.name ?? "").trim() || "Game";
  const cardsRemaining = round?.deck?.length ?? 0;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const inviteLink = room?.roomId ? `${origin ? `${origin}/` : ""}?room=${encodeURIComponent(room.roomId)}` : "";
  const preferredDeckCountValue = (() => {
    if (!preferredDecks.trim()) return undefined;
    const parsed = Number(preferredDecks.trim());
    if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
    return parsed;
  })();
  const decksInPlay = round?.deckCount ?? preferredDeckCountValue ?? 1;

  const statsData = useMemo(() => {
    if (!statsPlayerId) return undefined;
    const rounds = roundHistory ?? [];
    const entries = rounds
      .map((r) => {
        const turn = r.turns.find((t) => t.player.id === statsPlayerId);
        if (!turn) return undefined;
        const status = statusDisplay(turn);
        const betInfo = betDisplay(turn, true);
        return {
          roundNumber: r.roundNumber,
          status: status.label || "",
          statusClass: status.className,
          bet: betInfo.label,
          betClass: betInfo.className,
        };
      })
      .filter(Boolean) as {
      roundNumber: number;
      status: string;
      statusClass: string;
      bet: string;
      betClass: string;
    }[];
    if (!entries.length) return { name: "", entries: [], wins: 0, losses: 0, pushes: 0, isBanker: false };
    const wins = entries.filter((e) => e.status === "WON").length;
    const losses = entries.filter((e) => e.status === "LOST" || e.status === "BUSTED").length;
    const pushes = entries.filter((e) => e.status === "PUSH").length;
    const playerRecord = room?.players.find((p) => p.id === statsPlayerId);
    const playerName =
      playerRecord?.firstName ??
      rounds.find((r) => r.turns.some((t) => t.player.id === statsPlayerId))?.turns.find((t) => t.player.id === statsPlayerId)?.player
        ?.firstName ?? "Player";
    const isBanker = playerRecord?.type === "admin";
    return { name: playerName, entries: entries.slice(0, 10), wins, losses, pushes, isBanker };
  }, [statsPlayerId, roundHistory, room?.players]);

  useEffect(() => {
    if (me) {
      setRenameFirst(me.firstName);
      setRenameLast(me.lastName);
    }
  }, [me?.firstName, me?.lastName]);

  useEffect(() => {
    if (myRenameRequest) setShowRenameForm(false);
  }, [myRenameRequest]);

  useEffect(() => {
    if (myBuyInRequest) setShowBuyInForm(false);
  }, [myBuyInRequest]);

  useEffect(() => {
    if (room?.buyIn && !buyInAmount) {
      setBuyInAmount(String(room.buyIn));
    }
  }, [room?.buyIn, buyInAmount]);

  const onCreate = (e: FormEvent) => {
    e.preventDefault();
    const bankerBankrollPayload = bankerBankrollManuallySet ? bankerBankroll : undefined;
    store.createRoom(
      bankerFirstName,
      bankerLastName,
      roomName,
      roomPassword || undefined,
      buyIn,
      customRoomId || undefined,
      bankerBankrollPayload
    );
  };

  const onJoin = (e: FormEvent) => {
    e.preventDefault();
    store.setFormError("join", undefined);
    store.joinRoom(roomIdInput, joinFirstName, joinLastName, joinPassword || undefined);
  };

  const onAdjustBankroll = () => {
    if (!isAdmin) return;
    setBankAdjustError(undefined);
    setShowBankAdjust((prev) => {
      const next = !prev;
      if (next) {
        setBankAdjustAmount("");
        setBankAdjustNote("");
      }
      return next;
    });
  };

  const submitBankAdjust = (event: FormEvent) => {
    event.preventDefault();
    if (!isAdmin) return;
    const rawAmount = bankAdjustAmount.trim();
    const amount = Number(rawAmount);
    if (!rawAmount || !Number.isFinite(amount) || amount === 0) {
      setBankAdjustError("Enter a non-zero amount.");
      return;
    }
    const trimmedNote = bankAdjustNote.trim();
    store.topUpBanker(amount, trimmedNote ? trimmedNote : undefined);
    setShowBankAdjust(false);
    setBankAdjustAmount("");
    setBankAdjustNote("");
    setBankAdjustError(undefined);
  };

  const cancelBankAdjust = () => {
    setShowBankAdjust(false);
    setBankAdjustAmount("");
    setBankAdjustNote("");
    setBankAdjustError(undefined);
  };

  const openBankAdjustForm = () => {
    if (!isAdmin) return;
    setBankAdjustError(undefined);
    setBankAdjustAmount("");
    setBankAdjustNote("");
    setShowBankAdjust(true);
  };

  const toggleWalletAdjust = (playerId: string) => {
    if (!isAdmin) return;
    setWalletAdjustError(undefined);
    setWalletAdjustTarget((current) => (current === playerId ? null : playerId));
    setWalletAdjustAmount("");
    setWalletAdjustNote("");
  };

  const submitWalletAdjust = (event: FormEvent) => {
    event.preventDefault();
    if (!walletAdjustTarget) {
      setWalletAdjustError("Choose a player to adjust.");
      return;
    }
    const parsedAmount = Number(walletAdjustAmount.trim());
    if (!walletAdjustAmount.trim() || !Number.isFinite(parsedAmount) || parsedAmount === 0) {
      setWalletAdjustError("Enter a non-zero amount.");
      return;
    }
    const note = walletAdjustNote.trim();
    store.adjustPlayerBankroll(walletAdjustTarget, parsedAmount, note ? note : undefined);
    setWalletAdjustTarget(null);
    setWalletAdjustAmount("");
    setWalletAdjustNote("");
    setWalletAdjustError(undefined);
  };

  const handleKick = (playerId: string) => {
    if (!isAdmin) return;
    const player = room?.players.find((p) => p.id === playerId);
    const label = player ? fullName(player) || player.firstName : "this player";
    setPendingKick({ playerId, label: label || "this player" });
  };

  const confirmKick = () => {
    if (!pendingKick) return;
    store.kickPlayer(pendingKick.playerId);
    setPendingKick(null);
  };

  const cancelKick = () => setPendingKick(null);

  const handleToggleBank = (selected: boolean) => {
    if (!selected) {
      setBankBetSelected(false);
      setBetError(undefined);
      return;
    }
    if (!canBank) return;
    setBankBetSelected(true);
    const nextAmount = bankIncrement;
    setBet(nextAmount > 0 ? String(nextAmount) : "");
    setBetError(undefined);
  };

  return (
    <>
      {pendingKick && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4"
          role="dialog"
          aria-modal="true"
          onClick={cancelKick}
        >
          <div
            className="relative w-full max-w-md card-surface p-5 flex flex-col gap-4"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="text-lg font-semibold text-ink">Remove player?</div>
            <p className="text-sm text-slate-600">Are you sure you want to remove {pendingKick.label} from the table?</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="rounded border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                onClick={cancelKick}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded bg-red-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-500"
                onClick={confirmKick}
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
      {showBankSummary && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4"
          role="dialog"
          aria-modal="true"
          onClick={dismissBankerSummary}
        >
          <div
            className="relative w-full max-w-3xl max-h-[90vh] overflow-y-auto card-surface p-6 flex flex-col gap-4"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="absolute top-3 right-3 text-xs font-semibold text-slate-500 underline"
              onClick={dismissBankerSummary}
            >
              Close
            </button>
            <div className="space-y-2">
              <div className="text-lg font-semibold text-ink">Bank showdown summary</div>
              <div className="text-xs text-slate-500">
                The banker ended the round after the bank was depleted. Review the results below or print/save for your records.
              </div>
            </div>
            {latestSummary ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>Round {latestSummary.roundNumber}</span>
                  <span>{new Date(latestSummary.completedAt).toLocaleString()}</span>
                </div>
                <div className="grid md:grid-cols-2 gap-3">
                  {latestSummary.turns.map((turn) => {
                    const statusInfo = statusDisplay(turn);
                    const betInfo = betDisplay(turn, true);
                    const name = [turn.player.firstName, turn.player.lastName].filter(Boolean).join(" ");
                    const roleLabel = turn.player.type === "admin" ? "Banker" : "Player";
                    return (
                      <div
                        key={`${latestSummary.roundId}-${turn.player.id}`}
                        className="flex justify-between items-start gap-3 border border-slate-200 bg-white rounded px-3 py-2"
                      >
                        <div className="flex flex-col">
                          <span className="font-semibold text-sm text-ink">{name || "Unnamed"}</span>
                          <span className="text-[11px] uppercase tracking-wide text-slate-500">{roleLabel}</span>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <span className={statusInfo.className}>{statusInfo.label}</span>
                          <span className={clsx("text-xs", betInfo.className)}>{betInfo.label}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="text-sm text-slate-600">Preparing summary…</div>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className="inline-flex items-center justify-center rounded border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition-colors hover:border-slate-400 hover:text-slate-700"
                onClick={() => window.print()}
              >
                Print / Save PDF
              </button>
              <button
                type="button"
                className="inline-flex items-center justify-center rounded bg-ink px-3 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-slate-900"
                onClick={dismissBankerSummary}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
      {notifications.length > 0 && (
        <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
          {notifications.map((note) => {
            const toneClass =
              note.tone === "success"
                ? "bg-emerald-50 border border-emerald-200 text-emerald-700"
                : note.tone === "error"
                ? "bg-rose-50 border border-rose-200 text-rose-700"
                : "bg-blue-50 border border-blue-200 text-blue-700";
            return (
              <div
                key={note.id}
                className={`rounded-lg px-4 py-3 shadow-md ${toneClass}`}
                role="alert"
                aria-live="assertive"
              >
                <div className="flex items-start gap-3">
                  <span className="flex-1 text-sm font-medium whitespace-pre-line">{note.message}</span>
                  <button
                    type="button"
                    className="text-xs uppercase tracking-wide"
                    onClick={() => dismissNotification(note.id)}
                  >
                    Close
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {statsPlayerId && statsData && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4"
          onClick={() => setStatsPlayerId(undefined)}
        >
          <div
            className="relative w-full max-w-md card-surface bg-white p-5 pt-9 pr-11 rounded-lg shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="absolute top-3 right-3 inline-flex h-6 w-6 items-center justify-center rounded-full border border-rose-200 bg-rose-50 text-rose-600 text-xs font-bold shadow-sm hover:bg-rose-100"
              style={{ transform: "translateY(4px)" }}
              aria-label="Close stats"
              onClick={() => setStatsPlayerId(undefined)}
            >
              ×
            </button>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm uppercase tracking-wide text-slate-500">{statsData.isBanker ? "Bank stats" : "Player stats"}</div>
                  <div className="text-lg font-semibold text-ink">{statsData.name}</div>
                </div>
                <div className="text-right text-xs text-slate-500">
                  <div>Wins: <span className="font-semibold text-emerald-700">{statsData.wins}</span></div>
                  <div>Losses: <span className="font-semibold text-rose-700">{statsData.losses}</span></div>
                  <div>Pushes: <span className="font-semibold text-slate-600">{statsData.pushes}</span></div>
                </div>
              </div>
              <div className="border border-slate-200 rounded-lg divide-y divide-slate-200 overflow-hidden">
                {statsData.entries.length === 0 && (
                  <div className="p-3 text-xs text-slate-500">No completed rounds yet.</div>
                )}
                {statsData.entries.map((entry) => (
                  <div key={`stats-${statsPlayerId}-${entry.roundNumber}`} className="p-3 flex items-center justify-between text-sm">
                    <div className="text-slate-600">Round {entry.roundNumber}</div>
                    <div className="flex items-center gap-3">
                      <span className={clsx("text-xs uppercase tracking-wide", entry.statusClass)}>{entry.status}</span>
                      <span className={clsx("text-xs", entry.betClass)}>Bet {entry.bet}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
      <div className="max-w-6xl mx-auto px-4 py-8 flex flex-col gap-6">
        {message && !formErrors.join && (
        <div className="card-surface border border-red-200 bg-red-50 text-red-700 px-4 py-2 text-sm">
          {message}
        </div>
      )}
        {bankerDecisionRequired && (
          <div className="card-surface border border-amber-300 bg-amber-50 text-amber-800 px-4 py-3 flex flex-col gap-2">
            <div className="text-sm font-semibold">Bank depleted</div>
            <div className="text-xs text-amber-700">
              The bank is empty after {bankShowdownName}'s BANK! wager. Add chips to continue this round or end the game for everyone.
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="inline-flex items-center justify-center rounded bg-amber-500 px-3 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-amber-600"
                onClick={openBankAdjustForm}
              >
                Replenish bank
              </button>
              <button
                type="button"
                className="inline-flex items-center justify-center rounded border border-rose-300 bg-white px-3 py-2 text-xs font-semibold text-rose-600 transition-colors hover:border-rose-400 hover:text-rose-700"
                onClick={() => store.endRoundDueToBank()}
              >
                End game now
              </button>
            </div>
          </div>
        )}
        {viewerWaitingForBankDecision && (
          <div className="card-surface border border-amber-200 bg-amber-50 text-amber-700 px-4 py-2 text-xs font-semibold">
            Waiting for the banker to replenish the bank or end the game after {bankShowdownName}'s BANK! wager.
          </div>
        )}
        {bankShowdownActive && (
          <div className="card-surface border border-blue-200 bg-blue-50 text-blue-700 px-4 py-2 text-xs font-semibold">
            Banker is playing out {bankShowdownName}'s BANK! wager.
          </div>
        )}
        {bankPlayerActing && playerId !== bankLock?.playerId && (
          <div className="card-surface border border-blue-200 bg-blue-50 text-blue-700 px-4 py-2 text-xs font-semibold">
            {bankShowdownName} is placing a BANK! wager.
          </div>
        )}
      <header className="flex items-center gap-3 flex-wrap">
        <h1 className="flex items-center gap-2 text-3xl font-bold leading-none">
          <span className="relative inline-flex h-9 w-10 items-center justify-center pointer-events-none">
            <img
              src="/11.png"
              alt=""
              aria-hidden="true"
              className="absolute h-9 w-auto -rotate-[24deg] -translate-x-[2px] drop-shadow-sm z-10"
              loading="lazy"
            />
            <img
              src="/12.png"
              alt=""
              aria-hidden="true"
              className="absolute h-9 w-auto rotate-[23deg] translate-x-[16px] drop-shadow-sm"
              loading="lazy"
            />
          </span>
          <span>Kvitlach</span>
        </h1>
        <span className="self-end -translate-y-[4px] transform text-[10px] font-serif uppercase tracking-[0.2em] text-amber-700 leading-tight">
          Ah Heimishe Chanukah Shpil
        </span>
        <span className="self-end -translate-y-[2px] inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-700 shadow-sm">
          Beta
        </span>
        {room && isAdmin && (
          <button
            type="button"
            className="text-xs font-semibold text-accent underline"
            onClick={() => setShowLobby((v) => !v)}
          >
            {showLobby ? "Hide lobby" : "Show lobby"}
          </button>
        )}
      </header>
        {(!room || showLobby) ? (
          <section className="card-surface p-4 flex flex-col gap-2">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-3 max-w-xl">
                <div className="font-semibold text-base">Welcome to Kvitlach</div>
                <div className="text-xs text-slate-500">
                  Join an existing table with the room code your Banker shared, or host one if you are running the game.
                </div>
                {!room && (
                  <div className="space-y-1 text-xs text-slate-500">
                    <p>Banker manages the bankroll and payouts; everyone else plays against them.</p>
                    <p>Most visitors only need the Join form—create a table only if you are the Banker.</p>
                  </div>
                )}
              </div>
              <div className="flex flex-col items-end gap-2">
                <button
                  type="button"
                  className="group inline-flex items-center gap-2 rounded-full border border-accent text-accent px-4 py-2 text-xs font-semibold tracking-wide shadow-sm transition-colors duration-200 hover:bg-accent hover:text-white"
                  onClick={() => {
                    setShowWhatIs(false);
                    setShowHowTo(true);
                  }}
                >
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-accent text-white text-[10px] font-bold transition-colors duration-200 group-hover:bg-white group-hover:text-accent">
                    ?
                  </span>
                  <span>How to play</span>
                </button>
                <button
                  type="button"
                  className="group inline-flex items-center gap-2 rounded-full border border-blue-300 text-blue-600 px-4 py-2 text-xs font-semibold tracking-wide shadow-sm transition-colors duration-200 hover:bg-blue-500 hover:text-white"
                  onClick={() => {
                    setShowHowTo(false);
                    setShowWhatIs(true);
                  }}
                >
                  <span className="inline-flex h-5 w-5 items-center justify-center overflow-hidden rounded border border-blue-300 bg-white shadow-sm transition-colors duration-200 group-hover:border-blue-500 p-[1px]">
                    <img
                      src="/blank.png"
                      alt=""
                      aria-hidden="true"
                      className="h-full w-full object-contain"
                      loading="lazy"
                    />
                  </span>
                  <span>What is Kvitlach?</span>
                </button>
              </div>
            </div>
          </section>
        ) : (
          <section className="card-surface p-3 flex items-center justify-between gap-3 flex-wrap">
            <div className="space-y-0.5">
              <div className="text-sm font-semibold text-ink">Table quick help</div>
              <div className="text-[11px] text-slate-500">Open rules or story without leaving the table.</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-full border border-accent text-accent px-3 py-1.5 text-[11px] font-semibold shadow-sm transition-colors duration-200 hover:bg-accent hover:text-white"
                onClick={() => {
                  setShowWhatIs(false);
                  setShowHowTo(true);
                }}
              >
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-accent text-white text-[10px] font-bold">?</span>
                <span>How to play</span>
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-full border border-blue-300 text-blue-600 px-3 py-1.5 text-[11px] font-semibold shadow-sm transition-colors duration-200 hover:bg-blue-500 hover:text-white"
                onClick={() => {
                  setShowHowTo(false);
                  setShowWhatIs(true);
                }}
              >
                <span className="inline-flex h-5 w-5 items-center justify-center overflow-hidden rounded border border-blue-300 bg-white shadow-sm p-[1px]">
                  <img
                    src="/blank.png"
                    alt=""
                    aria-hidden="true"
                    className="h-full w-full object-contain"
                    loading="lazy"
                  />
                </span>
                <span>What is Kvitlach?</span>
              </button>
            </div>
          </section>
        )}

        {(!room || showLobby) && (
          <section className="grid md:grid-cols-2 gap-4 items-start">
          <form className="card-surface p-4 flex flex-col gap-3" onSubmit={onJoin}>
            <header className="flex flex-col gap-1 pb-3 border-b border-slate-200">
              <h2 className="text-lg font-semibold text-ink flex items-center gap-2">
                Join Game
                <span className="inline-flex items-center gap-1 text-[11px] uppercase tracking-[0.3em] text-slate-600">
                  <svg
                    className="h-3 w-3 text-blue-500"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d="M10 2a4 4 0 110 8 4 4 0 010-8zm0 10c-3.314 0-6 1.79-6 4v1h12v-1c0-2.21-2.686-4-6-4z" />
                  </svg>
                  (Player)
                </span>
              </h2>
              <p className="text-xs text-slate-500">Enter the code you received from the Banker to take a seat.</p>
            </header>
            <label className="text-sm">Game ID
                <input required className="mt-1 w-full rounded border px-3 py-2" value={roomIdInput} onChange={(e) => setRoomId(e.target.value)} />
            </label>
              <label className="text-sm">First name (required)
                <input required className="mt-1 w-full rounded border px-3 py-2" value={joinFirstName} onChange={(e) => setJoinFirst(e.target.value)} />
            </label>
              <label className="text-sm">Last name (optional)
                <input className="mt-1 w-full rounded border px-3 py-2" value={joinLastName} onChange={(e) => setJoinLast(e.target.value)} />
            </label>
            <label className="text-sm">Password (if required)
              <input
                className={clsx(
                  "mt-1 w-full rounded border px-3 py-2",
                  formErrors.join ? "border-red-300 focus:border-red-400 focus:ring-red-200" : ""
                )}
                value={joinPassword}
                onChange={(e) => setJoinPassword(e.target.value)}
              />
            </label>
            {formErrors.join && (
              <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
                {formErrors.join}
              </div>
            )}
              <button
                type="submit"
                className="bg-accent2 text-white rounded px-4 py-2 font-semibold shadow-sm transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent2 hover:bg-accent2/80"
              >
                Join
              </button>
          </form>
          <form
            className={clsx("card-surface p-4 flex flex-col", bankerFormExpanded ? "gap-3" : "gap-2")}
            onSubmit={onCreate}
          >
          <header className={clsx("transition-all", bankerFormExpanded ? "pb-3 border-b border-slate-200" : "pb-0")}
          >
            <button
              type="button"
              className={clsx(
                "w-full rounded-lg border px-4 py-3 text-sm font-semibold transition-colors flex items-center justify-between gap-3",
                bankerFormExpanded ? "bg-ink text-white border-ink" : "border-slate-300 text-slate-700 hover:bg-slate-100"
              )}
              onClick={() => setBankerFormExpanded((v) => !v)}
              aria-expanded={bankerFormExpanded}
              aria-controls="banker-create-fields"
            >
              <span className="inline-flex items-center gap-2">
                <svg className="h-4 w-4 text-amber-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path d="M10 2l7 3v2h-1v8h1v2H3v-2h1V7H3V5l7-3zm-4 5v8h2V7H6zm4 0v8h2V7h-2zm4 0v8h2V7h-2z" />
                </svg>
                <span>Banker: Host the table, set wagers, etc.</span>
              </span>
              <svg
                className={clsx("h-4 w-4 transition-transform", bankerFormExpanded ? "rotate-180" : "rotate-0")}
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M5.23 7.21a.75.75 0 011.06.02L10 10.44l3.71-3.21a.75.75 0 111.04 1.08l-4.24 3.67a.75.75 0 01-1.02 0L5.21 8.31a.75.75 0 01.02-1.1z" />
              </svg>
            </button>
          </header>
          {formErrors.create && (
            <div className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded px-3 py-2">
              {formErrors.create}
            </div>
          )}
          {bankerFormExpanded && (
            <div className="flex flex-col gap-3" id="banker-create-fields">
              <label className="text-sm">Game Name
                <input
                  className="mt-1 w-full rounded border px-3 py-2"
                  value={roomName}
                  onChange={(e) => setRoomName(e.target.value)}
                />
              </label>
              <label className="text-sm">Custom Game ID (optional)
                <input
                  className="mt-1 w-full rounded border px-3 py-2 uppercase"
                  value={customRoomId}
                  onChange={(e) => setCustomRoomId(e.target.value.toUpperCase())}
                  placeholder="e.g. CHOLENT-613"
                  maxLength={20}
                />
                <span className="text-xs text-slate-500">Use 4-20 characters with letters, numbers, or hyphen.</span>
              </label>
              <label className="text-sm">First name (required)
                <input required className="mt-1 w-full rounded border px-3 py-2" value={bankerFirstName} onChange={(e) => setBankerFirst(e.target.value)} />
              </label>
              <label className="text-sm">Last name (optional)
                <input className="mt-1 w-full rounded border px-3 py-2" value={bankerLastName} onChange={(e) => setBankerLast(e.target.value)} />
              </label>
              <label className="text-sm">Password (optional for joining)
                <input className="mt-1 w-full rounded border px-3 py-2" value={roomPassword} onChange={(e) => setRoomPassword(e.target.value)} />
              </label>
              <label className="text-sm">Buy-in per player
                <input className="mt-1 w-full rounded border px-3 py-2" type="number" min={1} value={buyIn} onChange={(e) => setBuyIn(Number(e.target.value))} />
              </label>
              <label className="text-sm">Banker starting bankroll
                <input
                  className="mt-1 w-full rounded border px-3 py-2"
                  type="number"
                  min={1}
                  value={bankerBankroll}
                  onChange={(e) => {
                    if (e.target.value === "") {
                      setBankerBankroll(buyIn);
                      setBankerBankrollManuallySet(false);
                      return;
                    }
                    const next = Number(e.target.value);
                    if (Number.isNaN(next)) return;
                    setBankerBankroll(next);
                    setBankerBankrollManuallySet(next !== buyIn);
                  }}
                />
              </label>
              <div className="flex items-center justify-between text-xs text-slate-500 -mt-1">
                <span>Defaults to the player buy-in amount.</span>
                {bankerBankrollManuallySet && (
                  <button
                    type="button"
                    className="text-accent font-semibold"
                    onClick={() => {
                      setBankerBankroll(buyIn);
                      setBankerBankrollManuallySet(false);
                    }}
                  >
                    Match buy-in
                  </button>
                )}
              </div>
              <label className="text-sm">Decks to use (optional)
                <input className="mt-1 w-full rounded border px-3 py-2" type="number" min={1} max={16} placeholder="auto" value={preferredDecks} onChange={(e) => setPreferredDecks(e.target.value)} />
                <span className="text-xs text-slate-500">Set this before starting the first round; leave blank to auto-size by players (supports large tables).</span>
              </label>
                <button
                  type="submit"
                  className="bg-accent text-white rounded px-4 py-2 font-semibold shadow-sm transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent hover:bg-accent/90"
                >
                  Create
                </button>
            </div>
          )}
        </form>

        </section>
      )}

        {room && (
          (!round || round.state === "terminate") && (
          <div className="card-surface mx-auto max-w-md p-3 text-sm text-amber-800 flex items-center justify-center gap-2 text-center waiting-flash">
            <span className="h-2 w-2 rounded-full bg-amber-500"></span>
            <span className="font-semibold uppercase">Waiting for Banker to start the round</span>
            <span className="h-2 w-2 rounded-full bg-amber-500"></span>
          </div>
        )
      )}

      {room && (
        <section className="card-surface p-4 flex flex-col gap-3">
          <div className="flex items-start justify-between flex-wrap gap-4">
            <div className="flex flex-col gap-3">
              <div className="text-2xl font-bold text-ink leading-tight">{roomDisplayName}</div>
              <div className="grid gap-1 text-xs text-slate-500">
                <div className="flex items-center gap-2">
                  <span>Game ID:</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono bg-amber-100 text-amber-800 px-2 py-1 rounded border border-amber-200">{room.roomId}</span>
                    <button
                      type="button"
                      className="inline-flex items-center justify-center rounded-full border border-amber-300 bg-amber-50 p-1.5 text-amber-700 shadow-sm transition-colors hover:bg-amber-100"
                      onClick={() => navigator.clipboard.writeText(room.roomId)}
                      title="Copy game ID"
                    >
                      <svg
                        className="h-3.5 w-3.5"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        aria-hidden="true"
                      >
                        <path d="M6 2a2 2 0 00-2 2v8h2V4h8V2H6zm4 4a2 2 0 00-2 2v8a2 2 0 002 2h6a2 2 0 002-2V8a2 2 0 00-2-2h-6zm0 10V8h6v8h-6z" />
                      </svg>
                    </button>
                  </div>
                </div>
                <div>
                  Buy-in per player: <span className="font-semibold text-slate-600">${room.buyIn}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span>Banker starting bankroll:</span>
                  <span className="font-semibold text-slate-600">${room.bankerBuyIn ?? room.buyIn}</span>
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={onAdjustBankroll}
                      className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700 shadow-sm transition-colors hover:bg-amber-100 hover:text-amber-800"
                      title="Adjust banker bankroll"
                    >
                      <svg
                        className="h-3.5 w-3.5"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        aria-hidden="true"
                      >
                        <path d="M10 2a8 8 0 018 8 8 8 0 01-8 8 8 8 0 110-16zm1 5H9v2H7v2h2v2h2v-2h2V9h-2V7z" />
                      </svg>
                      <span>Adjust</span>
                    </button>
                  )}
                </div>
                {isAdmin && showBankAdjust && (
                  <form
                    className="mt-2 w-full max-w-xs rounded-lg border border-amber-200 bg-white p-3 shadow-sm"
                    onSubmit={submitBankAdjust}
                  >
                    <div className="text-xs font-semibold uppercase tracking-wide text-amber-800">Update bank</div>
                    <label className="mt-2 block text-xs font-medium text-slate-600">
                      Amount (use negative to remove)
                      <input
                        className="mt-1 w-full rounded border border-amber-200 px-3 py-2 text-sm focus:border-amber-400 focus:outline-none focus:ring focus:ring-amber-100"
                        type="number"
                        step="1"
                        value={bankAdjustAmount}
                        onChange={(event) => {
                          setBankAdjustAmount(event.target.value);
                          if (bankAdjustError) setBankAdjustError(undefined);
                        }}
                        autoFocus
                        inputMode="decimal"
                      />
                    </label>
                    <label className="mt-2 block text-xs font-medium text-slate-600">
                      Optional note
                      <input
                        className="mt-1 w-full rounded border border-amber-200 px-3 py-2 text-sm focus:border-amber-400 focus:outline-none focus:ring focus:ring-amber-100"
                        value={bankAdjustNote}
                        onChange={(event) => setBankAdjustNote(event.target.value)}
                        placeholder="e.g. Cash paid out"
                      />
                    </label>
                    {bankAdjustError && (
                      <div className="mt-2 text-xs font-medium text-rose-600">{bankAdjustError}</div>
                    )}
                    <div className="mt-3 flex items-center gap-2">
                      <button
                        type="submit"
                        className="inline-flex flex-1 items-center justify-center rounded bg-amber-500 px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-amber-600"
                      >
                        Apply
                      </button>
                      <button
                        type="button"
                        className="inline-flex items-center justify-center rounded border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-700"
                        onClick={cancelBankAdjust}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}
                <div>
                  Decks in play: <span className="font-semibold text-slate-600">{decksInPlay}</span>
                </div>
                {isAdmin && room.password && (
                  <div className="flex items-center gap-2 text-rose-600">
                    <span>Room password:</span>
                    <span className="inline-flex items-center gap-1 font-mono bg-rose-50 border border-rose-200 text-rose-700 px-2 py-1 rounded">
                      {room.password}
                    </span>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-slate-500">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-3 py-1 shadow-sm transition-colors hover:bg-slate-100"
                  onClick={() => {
                    const target = inviteLink || room.roomId;
                    if (!target) return;
                    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
                      navigator.clipboard.writeText(target);
                    }
                  }}
                >
                  <svg
                    className="h-3.5 w-3.5 text-ink"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d="M15 5a3 3 0 00-2.82 2H8.82a3 3 0 000 2h3.36A3 3 0 1015 5zm-10 4a3 3 0 012.82-2h3.36a3 3 0 010 2H7.82A3 3 0 005 12a3 3 0 002.82 2h3.36a3 3 0 010 2H7.82A3 3 0 015 18a3 3 0 010-6z" />
                  </svg>
                  Copy invite link
                </button>
                <a
                  className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 shadow-sm transition-colors hover:bg-emerald-100"
                  href={room?.roomId ? `https://wa.me/?text=${encodeURIComponent(`Join our Kvitlach game: ${roomDisplayName} (ID: ${room.roomId}) ${inviteLink || room.roomId}`)}` : undefined}
                  target="_blank"
                  rel="noreferrer"
                >
                  <svg
                    className="h-3.5 w-3.5 text-emerald-600"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d="M19.998 4.004A4.99 4.99 0 0016.17 2c-2.945 0-5.34 2.351-5.34 5.247 0 .412.057.817.17 1.205-3.376-.163-6.567-1.737-8.641-4.314a5.082 5.082 0 00-.72 2.652c0 1.824.96 3.432 2.422 4.372a4.99 4.99 0 01-2.42-.649v.064c0 2.55 1.88 4.678 4.374 5.159a5.073 5.073 0 01-2.416.089c.68 2.056 2.652 3.555 4.986 3.595-1.83 1.396-4.137 2.23-6.64 2.23-.432 0-.86-.025-1.281-.074a13.94 13.94 0 007.548 2.186c9.056 0 14.01-7.21 14.01-13.456 0-.205-.005-.41-.015-.614a9.77 9.77 0 002.45-2.481 9.87 9.87 0 01-2.828.752 4.91 4.91 0 002.154-2.694 10.02 10.02 0 01-3.127 1.177z" />
                  </svg>
                  Share via WhatsApp
                </a>
              </div>
            </div>
            {isAdmin && (
              <div className="flex flex-col md:flex-row gap-3 md:items-center">
                <label className="text-sm flex items-center gap-2">
                  Decks
                  <input
                    type="number"
                    min={1}
                    max={16}
                    value={deckCount}
                    placeholder="1"
                    onChange={(e) => setDeckCount(e.target.value)}
                    className="w-20 rounded border px-2 py-1"
                  />
                  <span className="text-xs text-slate-500">leave blank to auto-size</span>
                </label>
                <button
                  className={clsx(
                    "group inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold tracking-wide shadow-sm transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
                    roundInProgress
                      ? "border-slate-300 bg-slate-100 text-slate-400 cursor-not-allowed"
                      : "border-ink text-ink hover:bg-ink hover:text-white focus-visible:outline-ink"
                  )}
                  disabled={roundInProgress}
                  aria-disabled={roundInProgress}
                  onClick={() => {
                    if (roundInProgress) return;
                    const parsedOverride = deckCount === "" ? undefined : Number(deckCount);
                    const parsedPreferred = preferredDecks === "" ? undefined : Number(preferredDecks);
                    const deckToUse = parsedOverride ?? parsedPreferred;
                    store.startRound(deckToUse);
                  }}
                >
                  <span
                    className={clsx(
                      "inline-flex h-5 w-5 items-center justify-center rounded-full transition-colors duration-200",
                      roundInProgress
                        ? "bg-slate-300 text-slate-500"
                        : "bg-ink text-white group-hover:bg-white group-hover:text-ink"
                    )}
                  >
                    <svg
                      className="h-3 w-3"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path d="M6 4l10 6-10 6V4z" />
                    </svg>
                  </span>
                  <span>Start round</span>
                </button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-3 text-slate-400 text-[10px] uppercase tracking-[0.3em]">
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-slate-300 to-transparent"></div>
            <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 shadow-sm">
              <svg
                className="h-3 w-3 text-blue-500"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M12 2l2.598 4.5H21l-2.598 4.5L21 15.5h-6.402L12 20l-2.598-4.5H3l2.598-4.5L3 6.5h6.402L12 2z" />
              </svg>
              <span className="font-bold text-slate-600">ROSTER</span>
              <svg
                className="h-3 w-3 text-blue-500"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M12 2l2.598 4.5H21l-2.598 4.5L21 15.5h-6.402L12 20l-2.598-4.5H3l2.598-4.5L3 6.5h6.402L12 2z" />
              </svg>
            </span>
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-slate-300 to-transparent"></div>
          </div>
          <div className="flex flex-wrap gap-2">
            {room.players.map((p) => (
              <WalletBadge
                key={p.id}
                player={p}
                amount={room.wallets[p.id]}
                turnPosition={
                  round && round.state !== "terminate"
                    ? p.id === activeTurnId
                      ? "active"
                      : p.id === nextTurnId
                      ? "next"
                      : undefined
                    : undefined
                }
                onClick={(id) => setStatsPlayerId(id)}
              />
            ))}
          </div>
            {isAdmin && room.players.some((p) => p.type !== "admin") && (
              <div className="w-full border-t border-slate-200 pt-3 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-ink">Player management</div>
                  <span className="text-[11px] uppercase tracking-wide text-slate-500">Adjust chips or remove</span>
                </div>
                <div className="grid md:grid-cols-2 gap-2">
                  {room.players
                    .filter((p) => p.type !== "admin")
                    .map((player) => {
                      const isOpen = walletAdjustTarget === player.id;
                      const wallet = room.wallets?.[player.id] ?? 0;
                      const name = fullName(player) || player.firstName;
                      return (
                        <div
                          key={`manage-${player.id}`}
                          className="border border-slate-200 rounded-lg bg-white p-3 flex flex-col gap-2 shadow-sm"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex flex-col">
                              <span className="font-semibold text-sm text-ink">{name || "Player"}</span>
                              <span className="text-xs text-slate-500">Wallet: ${wallet}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-semibold text-amber-700 shadow-sm transition-colors hover:bg-amber-100"
                                onClick={() => toggleWalletAdjust(player.id)}
                              >
                                <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                                  <path d="M3 10h14v2H3v-2zm0-4h14v2H3V6zm0 8h9v2H3v-2z" />
                                </svg>
                                {isOpen ? "Close adjust" : "Adjust chips"}
                              </button>
                              <button
                                type="button"
                                className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-[11px] font-semibold text-rose-700 shadow-sm transition-colors hover:bg-rose-100"
                                onClick={() => handleKick(player.id)}
                              >
                                <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                                  <path d="M6 4h8l1 12H5L6 4zm1-2a1 1 0 00-1 1v1h8V3a1 1 0 00-1-1H7z" />
                                </svg>
                                Kick
                              </button>
                            </div>
                          </div>
                          {isOpen && (
                            <form className="flex flex-col gap-2" onSubmit={submitWalletAdjust}>
                              <label className="text-xs text-slate-600">
                                Amount (negative removes chips)
                                <input
                                  className="mt-1 w-full rounded border border-slate-200 px-3 py-2 text-sm focus:border-amber-400 focus:outline-none focus:ring focus:ring-amber-100"
                                  type="number"
                                  step="1"
                                  inputMode="decimal"
                                  value={walletAdjustAmount}
                                  onChange={(event) => {
                                    setWalletAdjustAmount(event.target.value);
                                    if (walletAdjustError) setWalletAdjustError(undefined);
                                  }}
                                  required
                                />
                              </label>
                              <label className="text-xs text-slate-600">
                                Optional note
                                <input
                                  className="mt-1 w-full rounded border border-slate-200 px-3 py-2 text-sm focus:border-amber-400 focus:outline-none focus:ring focus:ring-amber-100"
                                  value={walletAdjustNote}
                                  onChange={(event) => setWalletAdjustNote(event.target.value)}
                                  placeholder="e.g. Cash payout"
                                />
                              </label>
                              {walletAdjustError && <div className="text-xs font-medium text-rose-600">{walletAdjustError}</div>}
                              <div className="flex gap-2">
                                <button
                                  type="submit"
                                  className="inline-flex flex-1 items-center justify-center rounded bg-amber-500 px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-amber-600"
                                >
                                  Apply
                                </button>
                                <button
                                  type="button"
                                  className="inline-flex items-center justify-center rounded border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-700"
                                  onClick={() => toggleWalletAdjust(player.id)}
                                >
                                  Cancel
                                </button>
                              </div>
                            </form>
                          )}
                        </div>
                      );
                    })}
                </div>
              </div>
            )}
          {round && waitingPlayers.length > 0 && (
            <div className="border border-blue-200 bg-blue-50 text-blue-800 px-3 py-2 rounded waiting-join-flash text-xs md:text-sm">
              <div className="font-semibold text-[11px] uppercase tracking-wide text-blue-600">Players queued for next round</div>
              <div>{waitingNamesForView ? `${waitingNamesForView} will join after this round ends.` : "A new player will join after this round ends."}</div>
              {isViewerWaiting && (
                <div className="text-[11px] mt-1 text-blue-700">Watch this round; you will be dealt in next.</div>
              )}
            </div>
          )}
          {!isAdmin && me && (
            <div className="border-t border-slate-200 pt-3 mt-3 flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-slate-500">Banker approval required for name changes.</span>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-full border border-accent text-accent px-3 py-1 text-[11px] font-semibold transition-colors hover:bg-accent hover:text-white"
                    onClick={() => setShowRenameForm((prev) => !prev)}
                  >
                    {showRenameForm ? "Hide rename form" : "Request name change"}
                  </button>
                </div>
                {myRenameRequest && (
                  <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                    Pending banker approval for {myRenameRequest.firstName}
                    {myRenameRequest.lastName ? ` ${myRenameRequest.lastName}` : ""}.
                  </div>
                )}
                {showRenameForm && (
                  <form
                    className="flex flex-col gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      store.requestRename(renameFirstName, renameLastName || undefined);
                    }}
                  >
                    <div className="flex flex-col md:flex-row gap-2">
                      <label className="text-xs flex-1">First name (required)
                        <input
                          className="mt-1 w-full rounded border px-3 py-2"
                          value={renameFirstName}
                          onChange={(e) => setRenameFirst(e.target.value)}
                          required
                        />
                      </label>
                      <label className="text-xs flex-1">Last name (optional)
                        <input
                          className="mt-1 w-full rounded border px-3 py-2"
                          value={renameLastName}
                          onChange={(e) => setRenameLast(e.target.value)}
                        />
                      </label>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="submit"
                        className="bg-accent text-white rounded px-3 py-2 text-sm font-semibold"
                      >
                        Submit rename request
                      </button>
                    </div>
                  </form>
                )}
              </div>
              <div className="border-t border-dashed border-slate-200 pt-3 flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-slate-500">Need more chips? Ask the Banker for a top-up.</span>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-full border border-accent text-accent px-3 py-1 text-[11px] font-semibold transition-colors hover:bg-accent hover:text-white"
                    onClick={() => setShowBuyInForm((prev) => !prev)}
                  >
                    {showBuyInForm ? "Hide chip request" : "Request more chips"}
                  </button>
                </div>
                {myBuyInRequest && (
                  <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                    Pending banker approval for ${myBuyInRequest.amount}
                    {myBuyInRequest.note ? ` · "${myBuyInRequest.note}"` : ""}.
                  </div>
                )}
                {showBuyInForm && (
                  <form
                    className="flex flex-col gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const parsed = Number(buyInAmount);
                      if (!Number.isFinite(parsed) || parsed <= 0) return;
                      store.requestBuyIn(parsed, buyInNote || undefined);
                      setBuyInNote("");
                      setShowBuyInForm(false);
                    }}
                  >
                    <div className="flex flex-col md:flex-row gap-2">
                      <label className="text-xs flex-1">Amount (required)
                        <input
                          className="mt-1 w-full rounded border px-3 py-2"
                          type="number"
                          min={1}
                          value={buyInAmount}
                          onChange={(e) => setBuyInAmount(e.target.value)}
                          required
                        />
                      </label>
                      <label className="text-xs flex-1">Note (optional)
                        <input
                          className="mt-1 w-full rounded border px-3 py-2"
                          value={buyInNote}
                          onChange={(e) => setBuyInNote(e.target.value)}
                          placeholder="e.g. Lost last round"
                        />
                      </label>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="submit"
                        className="bg-accent text-white rounded px-3 py-2 text-sm font-semibold"
                      >
                        Submit chip request
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>
          )}
          {isAdmin && pendingBankerTasks > 0 && (
            <div className="border-t border-slate-200 pt-3 mt-3 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold">Banker approvals needed</div>
                <span className="text-[11px] uppercase tracking-wide text-slate-500">{pendingBankerTasks} pending</span>
              </div>
              {buyInRequests.length > 0 && (
                <div className="flex flex-col gap-2">
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Chip top-ups</div>
                  <ul className="flex flex-col gap-2">
                    {buyInRequests.map((req) => {
                      const player = room.players.find((p) => p.id === req.playerId);
                      if (!player) return null;
                      return (
                        <li key={`buyin-${req.playerId}`} className="flex flex-col gap-2 border border-amber-200 rounded px-3 py-2 bg-amber-50 md:flex-row md:items-center md:justify-between">
                          <div className="text-sm">
                            <div className="font-semibold">
                              {[player.firstName, player.lastName].filter(Boolean).join(" ")}
                            </div>
                            <div className="text-xs text-amber-700">${req.amount}{req.note ? ` · "${req.note}"` : ""}</div>
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              className="bg-emerald-600 text-white text-xs font-semibold rounded px-3 py-2"
                              onClick={() => store.approveBuyIn(req.playerId)}
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              className="bg-rose-600 text-white text-xs font-semibold rounded px-3 py-2"
                              onClick={() => store.rejectBuyIn(req.playerId)}
                            >
                              Reject
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              {renameRequests.length > 0 && (
                <div className="flex flex-col gap-2">
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Rename requests</div>
                  <ul className="flex flex-col gap-2">
                    {renameRequests.map((req) => {
                      const player = room.players.find((p) => p.id === req.playerId);
                      if (!player) return null;
                      return (
                        <li key={`rename-${req.playerId}`} className="flex flex-col gap-2 border border-slate-200 rounded px-3 py-2 bg-slate-50 md:flex-row md:items-center md:justify-between">
                          <div className="text-sm">
                            <div className="font-semibold">
                              {[player.firstName, player.lastName].filter(Boolean).join(" ")}
                            </div>
                            <div className="text-xs text-slate-500">
                              Requested → {req.firstName}
                              {req.lastName ? ` ${req.lastName}` : ""}
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              className="bg-emerald-600 text-white text-xs font-semibold rounded px-3 py-2"
                              onClick={() => store.approveRename(req.playerId)}
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              className="bg-rose-600 text-white text-xs font-semibold rounded px-3 py-2"
                              onClick={() => store.rejectRename(req.playerId)}
                            >
                              Reject
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {round && (
        <section className="card-surface p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="font-semibold">
                Round {round?.roundNumber ?? 1}
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-500">
              <span className="uppercase tracking-wide">
                {round.state === "terminate" ? "Complete" : round.state === "final" ? "Final" : "Playing"}
              </span>
              <span>
                Total stakes: ${totalStakes.toLocaleString()}
                {typeof bankerWalletTotal === "number"
                  ? ` of $${bankerWalletTotal.toLocaleString()} available`
                  : ""}
              </span>
              <span>Decks in play: {round.deckCount ?? 1}</span>
              <span>Cards remaining: {cardsRemaining}</span>
            </div>
          </div>

          <div className="card-surface p-3 border border-slate-200 bg-slate-50">
            <div className="flex items-center justify-between mb-2 text-sm">
              <span className="font-semibold">Table Overview</span>
            </div>

            <div className="grid gap-3 md:grid-cols-2 text-xs text-slate-700 mt-1">
              {overviewTurns.map((t) => {
                const isActive = round?.state !== "terminate" && t.state === "pending" && activeTurnId === t.player.id;
                const isNext = round?.state !== "terminate" && t.state === "pending" && nextTurnId === t.player.id && !isActive;
                const statusInfo = statusDisplay(t);
                const shouldForceReveal = t.player.type === "admin" && round?.state === "terminate";
                const totalInfo = totalDisplay(t, playerId, round?.state, { forceBankerReveal: shouldForceReveal });
                const betInfo = betDisplay(t);
                const showStatusLabel = !isActive && Boolean(statusInfo.label);
                const walletAmount = room?.wallets?.[t.player.id];
                return (
                  <div
                    key={t.player.id}
                    className={clsx(
                      "flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3 shadow-sm",
                      isActive && "border-blue-400 bg-gradient-to-r from-blue-50 via-blue-100 to-blue-50 shadow-md",
                      isNext && !isActive && "border-amber-200 bg-amber-50/60",
                      t.player.type === "admin" && "border-amber-300 bg-amber-50/90"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-800">{[t.player.firstName, t.player.lastName].filter(Boolean).join(" ")}</span>
                        <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide px-2 py-0.5 rounded bg-slate-200 text-slate-700">
                          {t.player.type === "admin" && (
                            <svg
                              className="h-3 w-3 text-amber-600"
                              viewBox="0 0 20 20"
                              fill="currentColor"
                              aria-hidden="true"
                            >
                              <path d="M10 2l7 3v2h-1v8h1v2H3v-2h1V7H3V5l7-3zm-4 5v8h2V7H6zm4 0v8h2V7h-2zm4 0v8h2V7h-2z" />
                            </svg>
                          )}
                          {t.player.type !== "admin" && "Player"}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {showStatusLabel && (
                          <span className={clsx("text-[11px] uppercase tracking-wide", statusInfo.className)}>{statusInfo.label}</span>
                        )}
                        {isActive && (
                          <span className="text-[10px] font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded px-2 py-0.5 uppercase tracking-wide">Active</span>
                        )}
                        {isNext && (
                          <span className="text-[10px] font-semibold text-amber-700 bg-amber-100 border border-amber-200 rounded px-2 py-0.5 uppercase tracking-wide">Next</span>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-3 text-slate-600">
                      {typeof walletAmount === "number" && (
                        <span className="inline-flex items-center gap-1 text-slate-700">
                          <svg
                            className="h-4 w-4 text-emerald-500"
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            aria-hidden="true"
                          >
                            <path d="M2.25 7.5A2.25 2.25 0 014.5 5.25h15a.75.75 0 010 1.5H4.5a.75.75 0 00-.75.75v7.5c0 .414.336.75.75.75h15a.75.75 0 010 1.5h-15A2.25 2.25 0 012.25 15V7.5z" />
                            <path d="M18.75 9A2.25 2.25 0 0016.5 11.25v1.5A2.25 2.25 0 0018.75 15H21V9h-2.25z" />
                            <path d="M20.25 13.5a.75.75 0 100-1.5.75.75 0 000 1.5z" />
                          </svg>
                          <span className="text-sm font-semibold">${walletAmount.toLocaleString()}</span>
                        </span>
                      )}
                      {t.player.type !== "admin" && (
                        <span>
                          Bet: <span className={betInfo.className}>{betInfo.label}</span>
                        </span>
                      )}
                      <span>Cards: {t.cards.length}</span>
                      <span className={clsx(totalInfo.wrapperClassName ?? "text-slate-500")}> 
                        {totalInfo.prefix} <span className={clsx(totalInfo.valueClassName ?? totalInfo.wrapperClassName ?? "text-slate-500")}>{totalInfo.value}</span>
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {isAdmin && (connections?.length ?? 0) > 0 && (
            <div className="card-surface p-3 border border-blue-200 bg-blue-50/60">
              <div className="text-sm font-semibold mb-2 flex items-center justify-between">
                <span>Player connection info (banker only)</span>
              </div>
              <div className="grid gap-2 md:grid-cols-2 text-xs text-slate-800">
                {connections?.map((meta) => {
                  const player = room?.players.find((p) => p.id === meta.playerId);
                  const name = player ? [player.firstName, player.lastName].filter(Boolean).join(" ") || player.firstName : meta.playerId;
                  const lastSeen = meta.lastSeenAt ? new Date(meta.lastSeenAt).toLocaleString() : "";
                  return (
                    <div key={meta.playerId} className="rounded border border-slate-200 bg-white p-2 shadow-sm">
                      <div className="font-semibold text-ink">{name}</div>
                      <div className="text-[11px] text-slate-500 break-all">{meta.ip ?? "IP unknown"}</div>
                      <div className="text-[11px] text-slate-500 break-all">{meta.userAgent ?? "User agent unknown"}</div>
                      {lastSeen && <div className="text-[11px] text-slate-500">Last seen: {lastSeen}</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

            <div className="grid gap-3">
              <div>
                <div className="flex items-center gap-3 my-2">
                  <div className="flex-1 h-px bg-slate-200"></div>
                  <span className="inline-flex items-center justify-center px-4 py-1 text-[11px] uppercase tracking-[0.3em] text-ink bg-slate-100 rounded-full border border-slate-300 shadow-sm">Banker</span>
                  <div className="flex-1 h-px bg-slate-200"></div>
                  {isAdmin && round?.state !== "terminate" && (
                    <button
                      type="button"
                      className="ml-3 inline-flex items-center justify-center rounded-full border border-slate-300 bg-white px-3 py-1 text-[11px] font-semibold text-rose-700 shadow-sm hover:border-rose-300 hover:text-rose-800 disabled:opacity-50 disabled:cursor-not-allowed"
                      onClick={() => store.endRoundDueToBank()}
                      disabled={round?.bankLock?.stage !== "decision"}
                      title={round?.bankLock?.stage === "decision" ? "End round after bank decision" : "End round available when bank is exhausted"}
                    >
                      End round
                    </button>
                  )}
                </div>
                {bankerTurns.map((t) => (
                <TurnCard
                  key={t.player?.id ?? "banker"}
                  turn={t}
                  isAdmin={isAdmin}
                  viewerId={playerId}
                  isActiveTurn={activeTurnId === t.player.id}
                  isNextTurn={nextTurnId === t.player.id}
                  roundState={round?.state}
                  highlightBanker
                  walletAmount={room?.wallets?.[t.player.id]}
                    onHit={() => store.hit({ eleveroon: t.player.type === "admin" ? true : eleveroonSelected })}
                  onStand={() => store.stand()}
                    isCompact={bankerCompact && t.player.id !== playerId}
                    forceBankerReveal={round?.state === "terminate"}
                  firstBetCardIndex={firstBetCardIndex}
                  turnTimer={activeTurnTimer?.playerId === t.player.id ? activeTurnTimer : undefined}
                />
              ))}
            </div>
            <div>
              {myPlayerTurn && (
                <div className="mb-2">
                  <div className="text-xs uppercase text-slate-500 mb-1">Your hand</div>
                  <TurnCard
                    key={myPlayerTurn.player?.id ?? "me"}
                    turn={myPlayerTurn}
                    isAdmin={isAdmin}
                    viewerId={playerId}
                    isActiveTurn={activeTurnId === myPlayerTurn.player.id}
                    isNextTurn={nextTurnId === myPlayerTurn.player.id}
                    roundState={round?.state}
                    onSkipOther={isAdmin ? (pid) => store.skip(pid) : undefined}
                    walletAmount={room?.wallets?.[myPlayerTurn.player.id]}
                    betAmount={betAmount}
                    onBetChange={(v) => {
                      setBet(v);
                      if (bankBetSelected) setBankBetSelected(false);
                      setBetError(undefined);
                    }}
                    onBet={() => {
                      const parsed = Number(betAmount);
                      const amount = Number.isFinite(parsed) ? parsed : 0;
                      const wallet = room?.wallets?.[playerId ?? ""] ?? 0;
                      const existingBet = myPlayerTurn?.bet ?? 0;
                      const nextTotal = existingBet + amount;
                      if (nextTotal > wallet) {
                        setBetError("Insufficient chips for this wager.");
                        return;
                      }
                      store.bet(amount, { bank: bankBetSelected });
                      if (bankBetSelected) setBankBetSelected(false);
                      setBetError(undefined);
                      setBet("");
                    }}
                      onHit={() => store.hit({ eleveroon: isAdmin ? true : eleveroonSelected })}
                      onStand={() => store.stand()}
                    bankAvailable={bankInfo?.available}
                    bankAddAmount={bankIncrement}
                    bankSelected={bankBetSelected}
                    onToggleBank={handleToggleBank}
                    bankDisabled={!canBank}
                    bankDisabledReason={bankDisabledReason}
                    firstBetCardIndex={firstBetCardIndex}
                    betError={betError}
                      eleveroonSelected={eleveroonSelected}
                      onToggleEleveroon={(checked) => setEleveroonSelected(checked)}
                    turnTimer={activeTurnTimer?.playerId === myPlayerTurn.player.id ? activeTurnTimer : undefined}
                  />
                </div>
              )}
                <div className="flex items-center gap-3 my-2">
                  <div className="flex-1 h-px bg-slate-200"></div>
                  <span className="inline-flex items-center justify-center px-4 py-1 text-[11px] uppercase tracking-[0.3em] text-ink bg-slate-100 rounded-full border border-slate-300 shadow-sm">Other Players</span>
                  <div className="flex-1 h-px bg-slate-200"></div>
                </div>
              <div className="grid md:grid-cols-2 gap-3">
                {otherPlayerTurns.map((t) => (
                  <TurnCard
                    key={t.player?.id ?? Math.random().toString(36).slice(2)}
                    turn={t}
                    isAdmin={isAdmin}
                    viewerId={playerId}
                    isActiveTurn={activeTurnId === t.player.id}
                    isNextTurn={nextTurnId === t.player.id}
                    roundState={round?.state}
                    onSkipOther={isAdmin ? (pid) => store.skip(pid) : undefined}
                    walletAmount={room?.wallets?.[t.player.id]}
                    firstBetCardIndex={firstBetCardIndex}
                    turnTimer={activeTurnTimer?.playerId === t.player.id ? activeTurnTimer : undefined}
                  />
                ))}
              </div>
            </div>
          </div>

          {!canAct && myTurn && myTurn.state !== "pending" && round?.state !== "terminate" && (
            <div className="text-xs text-slate-500">
              {myTurn.state === "standby" || myTurn.state === "won" || myTurn.state === "lost" || myTurn.state === "skipped"
                ? "Waiting for other players and banker."
                : "Waiting for your turn..."}
            </div>
          )}
          {round.state === "terminate" && !isAdmin && (
            <div className="card-surface mx-auto max-w-md p-3 text-xs text-amber-800 flex items-center justify-center gap-2 text-center waiting-flash mt-3">
              <span className="h-2 w-2 rounded-full bg-amber-500"></span>
              <span className="font-semibold uppercase">Waiting for Banker to start the round</span>
              <span className="h-2 w-2 rounded-full bg-amber-500"></span>
            </div>
          )}
          {round.state === "terminate" && isAdmin && (
            <div className="mt-3 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-3 py-2 flex items-center justify-between gap-3 flex-wrap">
              <span>Round complete. Start a new round when ready.</span>
              <button
                className={clsx(
                  "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold tracking-wide shadow-sm transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
                  "border-ink text-ink hover:bg-ink hover:text-white focus-visible:outline-ink"
                )}
                onClick={() => {
                  const parsedOverride = deckCount === "" ? undefined : Number(deckCount);
                  const parsedPreferred = preferredDecks === "" ? undefined : Number(preferredDecks);
                  const deckToUse = parsedOverride ?? parsedPreferred;
                  store.startRound(deckToUse);
                }}
              >
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-ink text-white">
                  <svg
                    className="h-3 w-3"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d="M6 4l10 6-10 6V4z" />
                  </svg>
                </span>
                <span>Start round</span>
              </button>
            </div>
          )}
        </section>
      )}

      {room && (
        <section className="card-surface p-4 flex flex-col gap-3">
          <button
            type="button"
            className="flex items-center justify-between text-sm font-semibold text-ink"
            onClick={() => setShowHistory((prev) => !prev)}
          >
            <span className="text-base font-semibold text-ink">Round History ({roundHistory?.length ?? 0})</span>
            <span className="text-xs text-slate-500">{showHistory ? "Hide" : "Show"}</span>
          </button>
          {showHistory && (
            <div className="flex flex-col gap-3">
              {(roundHistory ?? []).length === 0 && (
                <div className="text-xs text-slate-500">No completed rounds yet.</div>
              )}
              {(roundHistory ?? []).map((summary) => (
                <div key={summary.roundId} className="border border-slate-200 rounded-lg p-3 bg-slate-50 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold text-sm">Round {summary.roundNumber}</div>
                    <div className="text-xs text-slate-500">{new Date(summary.completedAt).toLocaleString()}</div>
                  </div>
                  <div className="grid md:grid-cols-2 gap-2 text-xs">
                    {summary.turns.map((turn) => {
                      const statusInfo = statusDisplay(turn);
                      const betInfo = betDisplay(turn, true);
                      return (
                        <div key={`${summary.roundId}-${turn.player.id}`} className="flex justify-between items-center gap-3 border border-slate-200 bg-white rounded px-3 py-2">
                          <div className="flex flex-col">
                            <span className="font-semibold text-sm">{[turn.player.firstName, turn.player.lastName].filter(Boolean).join(" ")}</span>
                            <span className="text-[11px] text-slate-500">{turn.player.type === "admin" ? "Banker" : "Player"}</span>
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            <span className={statusInfo.className}>{statusInfo.label}</span>
                            {turn.player.type === "admin" ? (
                              <span className="text-xs text-slate-600">Net: <span className={betInfo.className}>{betInfo.label}</span></span>
                            ) : (
                              <span className="text-xs text-slate-600">Bet: <span className={betInfo.className}>{betInfo.label}</span></span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {showHowTo && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4"
          onClick={() => setShowHowTo(false)}
        >
          <div
            className="relative w-full max-w-xl max-h-[90vh] card-surface bg-amber-100 p-6 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-300 scrollbar-track-transparent"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="absolute top-3 right-3 text-xs font-semibold text-slate-500 underline"
              onClick={() => setShowHowTo(false)}
            >
              Close
            </button>
            <div className="space-y-3 text-sm text-slate-700">
              <h2 className="text-lg font-semibold">How To Play Kvitlach</h2>
              <div>
                <div className="font-semibold">Objective</div>
                <p>Reach 21 or the closest total without exceeding it.</p>
              </div>
                <div>
                  <div className="font-semibold">Deck & cards</div>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>Each deck has the numbers 1 through 12, with four copies of every card (48 cards total).</li>
                    <li>Tables can combine between one and six decks; larger games benefit from extra decks.</li>
                    <li>Card 2 and card 11 are Rosiers (also called Framed cards)—pairing them deals an automatic 21.</li>
                  </ul>
                </div>
              <div>
                <div className="font-semibold">Turn rules</div>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Each player receives one card, places a bet, and may draw additional cards one at a time.</li>
                  <li>Exact 21 is an instant win; going over 21 is an instant loss.</li>
                  <li>Standing keeps your current hand; the Banker plays last with their first card kept hidden.</li>
                  <li>If the Banker hits 21, all standing player bets are lost; if the Banker busts, all standing players win their bets.</li>
                  <li>Otherwise compare totals: the higher total (21 or under) wins; ties go to the Banker.</li>
                </ul>
              </div>
                <div>
                  <div className="font-semibold">Betting & bankroll</div>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>You can place multiple wagers during your turn; each bet stacks on your total stake.</li>
                    <li>Bets draw from your wallet balance—once you run out of chips you cannot raise further until the Banker pays out or you receive a buy-in.</li>
                    <li>The Banker should maintain enough bankroll to cover payouts; use the top-up tool if the bank runs low.</li>
                  </ul>
                </div>
                <div>
                  <div className="font-semibold">Blatt draws</div>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>Drawing without a wager is called taking a Blatt; it lets you reveal another card before committing chips.</li>
                    <li>Once you place any bet, further draws are regular hits and leave your wager on the table.</li>
                    <li>A Blatt total of 20 or more automatically puts you on standby—you keep that hand while the Banker plays.</li>
                  </ul>
                </div>
              <div>
                <div className="font-semibold">Special cards</div>
                <ul className="list-disc pl-5 space-y-1">
                  <li>#12 can count as 12, 10, or 9; two #12 as the first two cards result in an automatic 21.</li>
                    <li>Two Rosiers/Framed cards (2 or 11) as the first two draws also deliver an automatic 21.</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {pendingKick && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4"
          role="dialog"
          aria-modal="true"
          onClick={cancelKick}
        >
          <div
            className="relative w-full max-w-md card-surface p-5 flex flex-col gap-4"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="text-lg font-semibold text-ink">Remove player?</div>
            <p className="text-sm text-slate-600">Are you sure you want to remove {pendingKick.label} from the table?</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="rounded border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                onClick={cancelKick}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded bg-red-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-500"
                onClick={confirmKick}
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
      {showBankSummary && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4"
          role="dialog"
          aria-modal="true"
          onClick={dismissBankerSummary}
        >
          <div
            className="relative w-full max-w-3xl max-h-[90vh] overflow-y-auto card-surface p-6 flex flex-col gap-4"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="absolute top-3 right-3 text-xs font-semibold text-slate-500 underline"
              onClick={dismissBankerSummary}
            >
              Close
            </button>
            <div className="space-y-2">
              <div className="text-lg font-semibold text-ink">Bank showdown summary</div>
              <div className="text-xs text-slate-500">
                The banker ended the round after the bank was depleted. Review the results below or print/save for your records.
              </div>
            </div>
            {latestSummary ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>Round {latestSummary.roundNumber}</span>
                  <span>{new Date(latestSummary.completedAt).toLocaleString()}</span>
                </div>
                <div className="grid md:grid-cols-2 gap-3">
                  {latestSummary.turns.map((turn) => {
                    const statusInfo = statusDisplay(turn);
                    const betInfo = betDisplay(turn, true);
                    const name = [turn.player.firstName, turn.player.lastName].filter(Boolean).join(" ");
                    const roleLabel = turn.player.type === "admin" ? "Banker" : "Player";
                    return (
                      <div
                        key={`${latestSummary.roundId}-${turn.player.id}`}
                        className="flex justify-between items-start gap-3 border border-slate-200 bg-white rounded px-3 py-2"
                      >
                        <div className="flex flex-col">
                          <span className="font-semibold text-sm text-ink">{name || "Unnamed"}</span>
                          <span className="text-[11px] uppercase tracking-wide text-slate-500">{roleLabel}</span>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <span className={statusInfo.className}>{statusInfo.label}</span>
                          <span className={clsx("text-xs", betInfo.className)}>{betInfo.label}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="text-sm text-slate-600">Preparing summary…</div>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className="inline-flex items-center justify-center rounded border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition-colors hover:border-slate-400 hover:text-slate-700"
                onClick={() => window.print()}
              >
                Print / Save PDF
              </button>
              <button
                type="button"
                className="inline-flex items-center justify-center rounded bg-ink px-3 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-slate-900"
                onClick={dismissBankerSummary}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
      {notifications.length > 0 && (
        <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
          {notifications.map((note) => {
            const toneClass =
              note.tone === "success"
                ? "bg-emerald-50 border border-emerald-200 text-emerald-700"
                : note.tone === "error"
                ? "bg-rose-50 border border-rose-200 text-rose-700"
                : "bg-blue-50 border border-blue-200 text-blue-700";
            return (
              <div
                key={note.id}
                className={`rounded-lg px-4 py-3 shadow-md ${toneClass}`}
                role="alert"
                aria-live="assertive"
              >
                <div className="flex items-start gap-3">
                  <span className="flex-1 text-sm font-medium whitespace-pre-line">{note.message}</span>
                  <button
                    type="button"
                    className="text-xs uppercase tracking-wide"
                    onClick={() => dismissNotification(note.id)}
                  >
                    Close
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {showWhatIs && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4"
          onClick={() => setShowWhatIs(false)}
        >
          <div
            className="relative w-full max-w-xl max-h-[85vh] card-surface bg-amber-100 p-6 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-300 scrollbar-track-transparent"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="absolute top-3 right-3 text-xs font-semibold text-slate-500 underline"
              onClick={() => setShowWhatIs(false)}
            >
              Close
            </button>
            <div className="space-y-3 text-sm text-slate-700">
              <h2 className="text-lg font-semibold">What Is Kvitlach?</h2>
              <p>
                Kvitlech (Yiddish: קוויטלעך, lit. “notes” or “slips”) is a traditional card game similar to Twenty-One and modern Blackjack, commonly played in some Ashkenazi Jewish homes during the Chanuka season.
              </p>
              <p>
                Chasidish families have been playing Kvitlech for many years, using a distinctive deck created to avoid the use of standard playing cards that often featured crosses and other Christian symbols. A standard Kvitlech deck consists of 24 cards, arranged in identical pairs numbered from 1 to 12.
              </p>
              <p>
                These specially made decks are known by several traditional names, including kvitlech, lamed-alefniks (“thirty-oners”), klein Shas (“small Talmud”), or tilliml (“small Tehillim”). The cards are typically decorated with Hebrew numerals and simple, familiar objects, and in some cases with portraits of biblical figures.
              </p>
              <p>
                Over time, Kvitlech decks were produced both by hand and later by manufacturers, allowing the game to spread and remain a familiar Chanuka pastime in many Jewish homes.
              </p>
            </div>
          </div>
        </div>
      )}
      <footer className="mt-8 border-t border-slate-200 pt-4 text-xs text-slate-500 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="font-semibold text-slate-600">Kvitlach</span>
          <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-600">
            v1.5
            <span className="text-amber-700">Beta</span>
          </span>
          <span
            className={clsx(
              "inline-flex items-center gap-1 rounded-full px-2 py-1 border text-[11px]",
              status === "connected"
                ? "border-green-200 bg-green-50 text-green-700"
                : status === "connecting"
                ? "border-amber-200 bg-amber-50 text-amber-700"
                : "border-slate-200 bg-slate-50 text-slate-700"
            )}
            title={`WebSocket: ${status} (${wsUrl})`}
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: status === "connected" ? "#16a34a" : status === "connecting" ? "#f59e0b" : "#94a3b8" }}
              aria-hidden="true"
            />
            <span className="uppercase tracking-wide">WS</span>
            <span className="text-[10px]">{status === "connected" ? "ok" : status === "connecting" ? "wait" : "down"}</span>
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] uppercase tracking-wide text-slate-500">Sound</span>
          <label className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-1 shadow-sm">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
              checked={musicEnabled}
              onChange={(e) => {
                const next = e.target.checked;
                setMusicEnabled(next);
                setUserInteracted(true);
                audioManager.noteInteraction();
              }}
            />
            <span className="text-[11px] font-semibold text-ink">Music</span>
          </label>
          <label className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-1 shadow-sm">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              checked={sfxEnabled}
              onChange={(e) => {
                const next = e.target.checked;
                setSfxEnabled(next);
                setUserInteracted(true);
                audioManager.noteInteraction();
              }}
            />
            <span className="text-[11px] font-semibold text-ink">SFX</span>
          </label>
        </div>
        <nav className="flex items-center gap-4">
          <a href="/about" className="hover:text-ink underline-offset-4 hover:underline">About</a>
          <button
            type="button"
            onClick={() => setShowContact(true)}
            className="hover:text-ink underline-offset-4 hover:underline"
          >
            Contact
          </button>
        </nav>
        <span>© SWS 2026</span>
      </footer>

      {showContact && (
        <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center bg-black/30 px-4" onClick={() => setShowContact(false)}>
          <div
            className="w-full max-w-md rounded-lg bg-white shadow-xl border border-slate-200 p-4 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-2">
                <h2 className="text-base font-semibold text-ink">Contact the Kvitlach team</h2>
                <p className="text-sm text-slate-700">
                  Questions, concerns, bug reports, or feature ideas? Drop us a note at
                  {' '}<a className="text-amber-700 font-semibold hover:underline" href="mailto:kvitlach@swdhs.com">kvitlach@swdhs.com</a>.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowContact(false)}
                className="text-slate-500 hover:text-ink"
                aria-label="Close contact panel"
              >
                X
              </button>
            </div>
            <div className="flex flex-wrap gap-2 text-xs text-slate-600">
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 border border-amber-100">Support</span>
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-1 border border-blue-100">Bugs</span>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 border border-emerald-100">Feature ideas</span>
            </div>
            <div className="flex justify-end gap-2 text-sm">
              <button
                type="button"
                className="px-3 py-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-50"
                onClick={() => setShowContact(false)}
              >
                Dismiss
              </button>
              <a
                href="mailto:kvitlach@swdhs.com"
                className="px-3 py-1 rounded bg-amber-600 text-white hover:bg-amber-700"
              >
                Email us
              </a>
            </div>
          </div>
        </div>
      )}

      </div>
    </>
  );
}
