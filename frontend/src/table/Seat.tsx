import { clsx } from "clsx";
import { Player, RoundPhase, Turn } from "../types";
import { totalDisplay, statusDisplay, betDisplay } from "./selectors";
import { CardView } from "./CardView";
import { SeatPosition } from "./layout";
import { Icon } from "./icons";

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
  presence?: Player["presence"];
  position: SeatPosition;
  onSkipOther?: (playerId: string) => void;
}

export function initialsOf(player: { firstName?: string; lastName?: string }): string {
  const first = (player.firstName ?? "").trim();
  const last = (player.lastName ?? "").trim();
  const a = first.charAt(0);
  const b = last.charAt(0) || first.charAt(1) || "";
  return (a + b).toUpperCase() || "?";
}

// Maps the shared statusDisplay() label onto the mockup's pill variants.
// statusDisplay stays the single source of truth for WHAT the label says;
// this only decides how the pill is tinted.
function tagVariant(label: string, isCurrentTurn: boolean): string {
  if (isCurrentTurn) return "turn";
  if (label === "WON") return "won";
  if (label === "LOST" || label === "FUTCHED!") return "bust";
  if (label === "STANDING") return "stand";
  return "muted";
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
  presence,
  position,
  onSkipOther,
}: SeatProps) {
  const isMe = viewerId === turn.player.id;
  const isBanker = turn.player.type === "admin";
  const isCurrentTurn = Boolean(isActiveTurn && turn.state === "pending" && roundState !== "terminate");
  const isNextPlayer = Boolean(isNextTurn && !isCurrentTurn && turn.state === "pending" && roundState !== "terminate");
  // See Dealer.tsx: round.state === "final" means the banker's turn just
  // began, not that it's over -- don't treat it as a reveal signal.
  const shouldForceReveal = isBanker && (forceBankerReveal || roundState === "terminate");
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
  const isOffline = (presence ?? turn.player.presence) !== "online";

  const label = isNextPlayer ? "Up next" : isCurrentTurn ? (isMe ? "Your turn" : "Active") : statusInfo.label;
  const variant = isNextPlayer ? "muted" : tagVariant(statusInfo.label, isCurrentTurn);

  return (
    <div
      className={clsx("k-seat", isCurrentTurn && "is-active")}
      style={{ left: `${position.x}px`, top: `${position.y}px` }}
    >
      {reactionEmoji && (
        <div className="k-reaction" aria-label="Reaction">
          {reactionEmoji}
        </div>
      )}

      <div className={clsx("k-plate", isCurrentTurn && "is-active", isOffline && "is-offline")}>
        <span className="k-av">
          {initialsOf(turn.player)}
          {isBanker && (
            <span className="k-bankmark">
              <Icon name="bank" size={8} />
            </span>
          )}
        </span>
        <span className="flex flex-col items-start leading-tight min-w-0">
          <span className="k-plate-name">
            {displayName}
            {isMe && <span className="k-plate-sub"> (you)</span>}
          </span>
          <span className="k-plate-sub">
            {typeof walletAmount === "number" ? `$${walletAmount.toLocaleString()}` : ""}
            {!isBanker && betInfo.label !== "—" ? ` · bet ${betInfo.label}` : ""}
          </span>
        </span>
        <span
          className={clsx("h-2 w-2 rounded-full flex-none", isOffline ? "bg-slate-400" : "bg-emerald-500")}
          aria-label={isOffline ? "Offline" : "Online"}
          title={isOffline ? "Offline" : "Online"}
        />
      </div>

      {showTurnTimer && (
        <div className="turn-bar-track w-[110px] h-[3px]">
          <div
            className={clsx(
              "turn-bar-fill",
              timerTone === "urgent" ? "is-urgent" : timerTone === "warning" ? "is-warning" : ""
            )}
            style={{ width: `${turnTimer?.percent ?? 0}%` }}
          />
        </div>
      )}

      <div className={clsx("k-hand", isMe && "is-me")}>
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

          return <CardView key={idx} card={c} hidden={hide} />;
        })}
      </div>

      <div className="k-readout">
        {totalInfo.prefix} <b>{totalInfo.value}</b>
      </div>

      {label && <div className={clsx("k-tag", variant)}>{label}</div>}

      {canAdminSkip && (
        <button type="button" className="k-chip-btn" onClick={() => onSkipOther?.(turn.player.id)}>
          <Icon name="skip" size={10} />
          Skip
        </button>
      )}
    </div>
  );
}
