import { clsx } from "clsx";
import { RoundPhase, Turn } from "../types";
import { totalDisplay, statusDisplay, betDisplay } from "./selectors";
import { CardView } from "./CardView";
import { SeatPosition } from "./layout";

export interface SeatProps {
  turn: Turn;
  viewerId?: string;
  isAdmin: boolean;
  isActiveTurn?: boolean;
  isNextTurn?: boolean;
  roundState?: RoundPhase;
  firstBetCardIndex?: Record<string, number>;
  forceBankerReveal?: boolean;
  turnTimer?: { playerId: string; remainingMs: number; percent: number; durationMs: number };
  reactionEmoji?: string;
  walletAmount?: number;
  position: SeatPosition;
  onSkipOther?: (playerId: string) => void;
}

export function Seat({
  turn,
  viewerId,
  isAdmin,
  isActiveTurn,
  isNextTurn,
  roundState,
  firstBetCardIndex,
  forceBankerReveal,
  turnTimer,
  reactionEmoji,
  walletAmount,
  position,
  onSkipOther,
}: SeatProps) {
  const isMe = viewerId === turn.player.id;
  const isBanker = turn.player.type === "admin";
  const isCurrentTurn = Boolean(isActiveTurn && turn.state === "pending" && roundState !== "terminate");
  const isNextPlayer = Boolean(isNextTurn && !isCurrentTurn && turn.state === "pending" && roundState !== "terminate");
  const shouldForceReveal = isBanker && (forceBankerReveal || roundState === "final" || roundState === "terminate");
  const totalInfo = totalDisplay(turn, viewerId, roundState, { forceBankerReveal: shouldForceReveal });
  const statusInfo = statusDisplay(turn);
  const betInfo = betDisplay(turn);
  const displayName = [turn.player.firstName, turn.player.lastName].filter(Boolean).join(" ") || turn.player.firstName;
  const canAdminSkip = Boolean(isAdmin && !isBanker && turn.state === "pending" && onSkipOther);

  const showTurnTimer = Boolean(
    turnTimer && turnTimer.playerId === turn.player.id && !isBanker && turn.state === "pending" && roundState !== "terminate"
  );
  const timerMsLeft = Math.max(0, turnTimer?.remainingMs ?? 0);
  const timerTone = timerMsLeft <= 20000 ? "urgent" : timerMsLeft <= 45000 ? "warning" : "normal";

  const betStart = firstBetCardIndex?.[turn.player.id];
  const isOwnerView = viewerId === turn.player.id;
  const isBlattPhase = (turn.bet ?? 0) === 0;
  const bankerReveal = !isBanker || shouldForceReveal || turn.state !== "pending";
  const roundFinished = roundState === "terminate" || shouldForceReveal;
  const resolved = turn.state === "lost" || turn.state === "won";
  const isPublicStandby = turn.state === "standby";
  const hasBet = typeof betStart === "number";

  return (
    <div
      className="absolute flex flex-col items-center gap-1 -translate-x-1/2 -translate-y-1/2"
      style={{ left: `${position.xPercent}%`, top: `${position.yPercent}%` }}
    >
      {reactionEmoji && (
        <div className="absolute -top-6 rounded-full bg-white/90 px-2 py-0.5 text-sm shadow" aria-label="Reaction">
          {reactionEmoji}
        </div>
      )}
      <div
        className={clsx(
          "rounded-xl bg-white/95 px-3 py-2 shadow-md flex flex-col items-center gap-1 min-w-[104px]",
          isCurrentTurn && "ring-2 ring-amber-400"
        )}
      >
        <div className="flex items-center gap-1 text-xs font-semibold text-slate-800">
          <span className={clsx(isMe && "text-blue-700")}>{displayName}</span>
          {isMe && <span className="italic text-slate-500" aria-label="You">(Me)</span>}
        </div>
        {isNextPlayer && <span className="text-[10px] font-semibold text-amber-700">Up next</span>}
        {isCurrentTurn && <span className="text-[10px] font-semibold text-blue-600">{isMe ? "Your turn" : "Active"}</span>}

        {showTurnTimer && (
          <div className="w-full h-1 rounded-full bg-slate-200 overflow-hidden">
            <div
              className={clsx(
                "h-full transition-[width] duration-100 ease-linear",
                timerTone === "urgent" ? "bg-rose-500" : timerTone === "warning" ? "bg-amber-500" : "bg-blue-500"
              )}
              style={{ width: `${turnTimer?.percent ?? 0}%` }}
            />
          </div>
        )}

        <div className="flex gap-1 flex-wrap justify-center">
          {turn.cards.map((c, idx) => {
            const isInitialCard = idx === 0;
            const isBlattCard = hasBet ? idx > 0 && idx < (betStart as number) : isBlattPhase && idx > 0;
            const isBetOrHitCard = hasBet ? idx >= (betStart as number) : false;

            let hide = true;
            if (isOwnerView) hide = false;
            else if (isBanker) hide = idx === 0 && !bankerReveal;
            else if (resolved || roundFinished) hide = false;
            else if (isPublicStandby) hide = !(isBlattCard && !isInitialCard);
            else if (isBlattPhase) hide = idx === 0;
            else if (hasBet) hide = isInitialCard || isBetOrHitCard ? true : !isBlattCard;

            return <CardView key={idx} card={c} hidden={hide} size="md" />;
          })}
        </div>

        <div className={clsx("text-[11px]", totalInfo.wrapperClassName ?? "text-slate-600")}>
          {totalInfo.prefix} <span className={totalInfo.valueClassName}>{totalInfo.value}</span>
        </div>
        {!isBanker && (
          <div className="text-[11px] text-slate-600">
            Bet: <span className={betInfo.className}>{betInfo.label}</span>
          </div>
        )}
        {statusInfo.label && <div className={clsx("text-[10px] uppercase", statusInfo.className)}>{statusInfo.label}</div>}
        {isMe && typeof walletAmount === "number" && (
          <div className="text-[10px] font-semibold text-emerald-700">Cash ${walletAmount}</div>
        )}
        {canAdminSkip && (
          <button
            className="text-[10px] font-semibold text-rose-700 underline"
            onClick={() => onSkipOther?.(turn.player.id)}
          >
            Skip player
          </button>
        )}
      </div>
    </div>
  );
}
