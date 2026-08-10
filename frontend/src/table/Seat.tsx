import { useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import { Player, RoundPhase, Turn } from "../types";
import { totalDisplay, statusDisplay, betDisplay, tagVariant } from "./selectors";
import { CardView } from "./CardView";
import { SeatPosition } from "./layout";
import { Icon } from "./icons";
import { useClickOutside } from "./clickOutside";
import { FAN_OUT_MS, useHandFan } from "./handFan";

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
  scale?: number;
  isBankActor?: boolean;
  onSkipOther?: (playerId: string) => void;
  onOpenStats?: (playerId: string) => void;
  // Round-scopes CardView's key (see CardView.tsx) so a fresh round's cards
  // mount as genuinely new DOM nodes instead of reusing last round's -- see
  // TableRoot.tsx for why that reuse silently killed the deal animation
  // past round 1.
  roundId?: string;
  pastFirstPaint?: boolean;
  // This seat's position in deal order (TableRoot's seatedTurns index),
  // staggering the opening deal's animation-delay so it visibly goes around
  // the table rather than every seat's card 1 landing at once.
  dealOrder?: number;
  // Nominal stage-px from the shoe to THIS seat, already divided by `scale`
  // (see TableRoot.tsx) -- set as CSS vars on .k-hand so cardDealIn can fly
  // every card in from the shoe's actual on-screen position.
  dealDx?: number;
  dealDy?: number;
}

export function initialsOf(player: { firstName?: string; lastName?: string }): string {
  const first = (player.firstName ?? "").trim();
  const last = (player.lastName ?? "").trim();
  const a = first.charAt(0);
  const b = last.charAt(0) || first.charAt(1) || "";
  return (a + b).toUpperCase() || "?";
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
  scale = 1,
  isBankActor,
  onSkipOther,
  onOpenStats,
  roundId,
  pastFirstPaint,
  dealOrder = 0,
  dealDx = 0,
  dealDy = 0,
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
  // Matches index.css's own overlap threshold (:nth-last-child(n+4)) -- a
  // shorter hand never overlaps in the first place, so there's nothing to
  // fan out and no reason to make it tappable.
  const canFan = turn.cards.length >= 4;
  const handRef = useRef<HTMLDivElement>(null);
  const { fanned, toggle } = useHandFan(handRef, roundId);
  const resolved = turn.state === "lost" || turn.state === "won";
  const isPublicStandby = turn.state === "standby";
  const hasBet = typeof betStart === "number";
  const isOffline = (presence ?? turn.player.presence) !== "online";

  // The real-table "I'm calling Eleveroon!" moment -- announced the instant
  // they act, regardless of whether their bet/hit cards are themselves still
  // hidden from the rest of the table (see the `hide` logic above). Never
  // true for the banker (round.ts only sets this from the raw checkbox
  // request, not their always-on protection), and only shown while their
  // turn is still live -- once it resolves the card's own permanent ring/
  // badge (CardView.tsx) is the record of what actually happened.
  const showEleveroonCall = Boolean(!isBanker && turn.eleveroonCalled && turn.state === "pending");
  const label = isNextPlayer ? "Up next" : isCurrentTurn ? (isMe ? "Your turn" : "Active") : statusInfo.label;
  const variant = isNextPlayer ? "muted" : tagVariant(statusInfo.label, isCurrentTurn);
  const showBet = !isBanker && betInfo.label !== "—";
  // selectors.ts distinguishes a real number from a concealed one ("hidden",
  // "--") and flags a bust; both distinctions have to survive here or every
  // total reads alike. Derived from the data rather than string-matching the
  // light-theme Tailwind classes selectors returns, which are unreadable on
  // this dark pill anyway.
  const totalIsConcealed = !/^\d/.test(totalInfo.value);
  const totalIsBust = statusInfo.label === "FUTCHED!";

  return (
    <div
      // hand-fanned bumps THIS seat's own z-index, not just .k-hand's --
      // .k-seat is a stacking context (position + z-index + transform), so a
      // fanned hand wide enough to reach a neighbour needs its whole seat
      // raised, not just the hand inside it, or it would fan out UNDER them.
      className={clsx("k-seat", isCurrentTurn && "is-active", canFan && fanned && "hand-fanned")}
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        transform: `translate(-50%, -50%) scale(${scale})`,
      }}
    >
      {reactionEmoji && (
        <div className="k-reaction" aria-label="Reaction">
          {reactionEmoji}
        </div>
      )}

      <button
        type="button"
        className={clsx("k-plate", isCurrentTurn && "is-active", isOffline && "is-offline", isBankActor && "is-bank-actor")}
        onClick={() => onOpenStats?.(turn.player.id)}
        title={`View ${displayName}'s stats`}
      >
        <span className="k-av">
          {initialsOf(turn.player)}
          {isBanker && (
            <span className="k-bankmark">
              <Icon name="bank" size={8} />
            </span>
          )}
          {showEleveroonCall && (
            <span className="k-elev-mark" title={`${displayName} is calling Eleveroon`} aria-label="Calling Eleveroon">
              <Icon name="star" size={8} />
            </span>
          )}
        </span>
        <span className="flex flex-col items-start leading-tight min-w-0">
          <span className="k-plate-name">
            {displayName}
            {turn.player.isBot && (
              <span className="inline-block ml-1 align-middle opacity-70" title="Computer player">
                <Icon name="cpu" size={9} />
              </span>
            )}
            {isMe && <span className="k-plate-sub"> (you)</span>}
          </span>
          <span className="k-plate-sub">
            {typeof walletAmount === "number" && <>${walletAmount.toLocaleString()}</>}
            {showBet && (
              <>
                {typeof walletAmount === "number" ? " · " : ""}
                {/* betDisplay encodes the settled outcome in colour (green
                    won / red lost / grey push) -- keep it, it's the only
                    per-seat signal of who took chips off the table. */}
                <span className={betInfo.className}>{betInfo.label}</span>
              </>
            )}
          </span>
        </span>
        <span
          className={clsx("h-2 w-2 rounded-full flex-none", isOffline ? "bg-slate-400" : "bg-emerald-500")}
          aria-label={isOffline ? "Offline" : "Online"}
          title={isOffline ? "Offline" : "Online"}
        />
      </button>

      {showTurnTimer && (
        <div className={clsx("turn-bar-track w-[110px] h-[3px]", timerTone === "urgent" && "is-urgent")}>
          <div
            className={clsx(
              "turn-bar-fill",
              timerTone === "urgent" ? "is-urgent" : timerTone === "warning" ? "is-warning" : ""
            )}
            style={{ width: `${turnTimer?.percent ?? 0}%` }}
          />
        </div>
      )}

      <div
        ref={handRef}
        className={clsx("k-hand", isMe && "is-me", canFan && fanned && "is-fanned")}
        style={{ "--deal-dx": `${dealDx}px`, "--deal-dy": `${dealDy}px` } as React.CSSProperties}
        onClick={canFan ? toggle : undefined}
        onKeyDown={
          canFan
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggle();
                }
              }
            : undefined
        }
        role={canFan ? "button" : undefined}
        tabIndex={canFan ? 0 : undefined}
        aria-expanded={canFan ? fanned : undefined}
        aria-label={canFan ? `${fanned ? "Collapse" : "Show"} all ${turn.cards.length} cards in this hand` : undefined}
      >
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

          return (
            <CardView
              // Round-scoped: a fresh round's index 0 must mount as a new
              // DOM node, not reuse the previous round's (see TableRoot.tsx).
              key={`${roundId ?? "r"}-${idx}`}
              card={c}
              hidden={hide}
              // idx 0 is only ever a fresh round's opening card (every later
              // card is a hit/bet appended at idx>=1) -- stagger it by this
              // seat's place in deal order; +1 leaves room 0 for the dealer.
              dealDelayMs={isInitialCard ? (dealOrder + 1) * 90 : 0}
              pastFirstPaint={pastFirstPaint}
            />
          );
        })}
      </div>

      <div className={clsx("k-readout", totalIsConcealed && "is-muted", totalIsBust && "is-bust")}>
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
