import { useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import { Player, RoundPhase, Turn } from "../types";
import { totalDisplay, statusDisplay, betDisplay, tagVariant } from "./selectors";
import { CardView } from "./CardView";
import { SeatPosition } from "./layout";
import { Icon } from "./icons";
import { useClickOutside } from "./clickOutside";
import { FAN_OUT_MS, useHandFan } from "./handFan";
import { StageOverlay } from "./StageOverlay";

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
  /**
   * The scale this seat's CARDS render at, which is not the same number as
   * `scale`. That one is a nameplate-collision result (layout.ts seatScale);
   * the hand was only ever riding it. See layout.ts viewerHandScale() for why
   * the viewer's hand gets its own, and what was measured.
   * Absolute, not a multiplier -- Seat divides it by `scale` itself, so a
   * caller never has to know the seat's transform to reason about card size.
   */
  handScale?: number;
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
  // The mirror image of dealDx/dealDy: nominal stage-px from THIS seat to
  // the discard pile, for cardDiscardFly (CardView.tsx/index.css) to fly a
  // rejected card out to the pile's actual on-screen position.
  discardDx?: number;
  discardDy?: number;
  /**
   * Anchor this seat's reaction bubble to its SIDE rather than above it.
   *
   * Set for the seats in the table's centre column, where the space above a
   * seat belongs to somebody else: the viewer sits at bottom-centre, directly
   * under the dealer's own row, so its bubble rose straight onto the banker's
   * total and sat there for the ten seconds a reaction lives.
   */
  sideReaction?: boolean;
  /**
   * Suppress this seat's plate, total and status tag -- they are being rendered
   * in the bottom-left HUD instead (ViewerHud.tsx). Set for the viewer's own
   * seat only; their cards stay here on the felt, because only the cards are
   * play. See docs/mobile-ui.md Part 1.
   */
  identityInHud?: boolean;
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
  handScale,
  isBankActor,
  onSkipOther,
  onOpenStats,
  roundId,
  pastFirstPaint,
  dealOrder = 0,
  dealDx = 0,
  dealDy = 0,
  discardDx = 0,
  discardDy = 0,
  sideReaction = false,
  identityInHud = false,
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
  // turn is still live -- once it resolves the card flies off to the shared
  // discard pile (DiscardPile.tsx), which is the record of what actually
  // happened from then on, not a ring left sitting in the hand.
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

  // The reaction bubble portals to document.body -- see the anchor effect
  // and the render below for why. seatRef is what that effect measures.
  const seatRef = useRef<HTMLDivElement>(null);
  const [reactionAnchor, setReactionAnchor] = useState<{ top?: number; bottom?: number; left: number } | null>(null);

  // Real-pixel measurement, the same technique ReactionLayer.tsx's own
  // picker already uses, and for the same reason: .k-seat is
  // position + z-index (10, fanned 20) -- its own stacking context -- so
  // .k-reaction's LOCAL z-index (45) never actually competed against
  // anything outside the seat. A dealt card (.table-fly-card, z-index: 80,
  // appended straight to document.body, outside every seat) always won.
  // Reported as reaction emoji "eventually getting covered by cards."
  //
  // Keyed on reactionEmoji, not on scale/handScale, which change on every
  // render as cards animate: a seat does not itself move during the 10s a
  // reaction lives, so re-measuring on those would only risk a mid-flight
  // jitter for no visual gain, not fix anything.
  useEffect(() => {
    if (!reactionEmoji) {
      setReactionAnchor(null);
      return;
    }
    const rect = seatRef.current?.getBoundingClientRect();
    if (!rect) return;
    setReactionAnchor(
      sideReaction
        ? { top: rect.top + rect.height / 2, left: rect.right + 10 }
        : { bottom: window.innerHeight - rect.top + 8, left: rect.left + rect.width / 2 }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reactionEmoji, sideReaction]);

  return (
    <div
      ref={seatRef}
      // hand-fanned bumps THIS seat's own z-index, not just .k-hand's --
      // .k-seat is a stacking context (position + z-index + transform), so a
      // fanned hand wide enough to reach a neighbour needs its whole seat
      // raised, not just the hand inside it, or it would fan out UNDER them.
      className={clsx("k-seat", isCurrentTurn && "is-active", canFan && fanned && "hand-fanned")}
      style={
        {
          left: `${position.x}px`,
          top: `${position.y}px`,
          transform: `translate(-50%, -50%) scale(${scale})`,
          // Both of these undo part of the seat's own scale for one child that
          // should never have been shrinking with it (index.css .k-hand).
          // .k-reaction used to be the other one -- it's portalled out now
          // (see reactionAnchor above), so --k-rx has no reader left inside
          // this seat, but stays here as a documented no-op rather than a
          // silent behaviour change bundled into an unrelated edit: deleting
          // it is a real cleanup, worth its own look at index.css's
          // reactionLife/reactionLifeSide keyframes rather than a side effect
          // of this fix.
          "--k-hand-scale": (handScale ?? scale) / scale,
          "--k-rx": 1 / scale,
        } as React.CSSProperties
      }
    >
      {reactionEmoji && reactionAnchor && (
        // Real viewport px via StageOverlay, same portal every other overlay
        // in this codebase uses and for the same reason: it needs to escape
        // an ancestor's stacking context, not just look like it has. Once
        // portalled there's no ambient --stage-scale left to counter, so no
        // scale() term here -- unlike the in-seat version this replaces,
        // which had to keep the bubble legible against the felt's own zoom.
        <StageOverlay>
          <div
            className={clsx("k-reaction", sideReaction && "is-side")}
            aria-label="Reaction"
            style={{
              position: "fixed",
              top: reactionAnchor.top,
              bottom: reactionAnchor.bottom,
              left: reactionAnchor.left,
              margin: 0,
            }}
          >
            {reactionEmoji}
          </div>
        </StageOverlay>
      )}

      {/* The turn timer's own row, ALWAYS rendered for a player seat and never
          only while it is running.

          It used to be mounted only when showTurnTimer was true. That made its
          space conditional, so the seat column was one height with a timer and
          another without -- and a card dealt into the shorter column had
          nothing holding the bar's place. Reserving it unconditionally is what
          makes "a card can never land on the timer" a property of the layout
          rather than something re-checked every time the column changes.

          First in the column, so it sits ABOVE the nameplate rather than
          between the plate and the cards. The hand is the only thing here that
          grows -- it scales by --k-hand-scale, and a transform is invisible to
          layout -- so the further the bar is from the hand, the less there is
          to reason about. Above the plate it is separated from the hand by the
          whole plate, at every seat count.

          The banker never takes a timed turn (showTurnTimer excludes them), so
          they get no row and no reserved space for one. */}
      {!isBanker && (
        <div
          className={clsx(
            "k-turnbar w-[110px] h-[3px]",
            showTurnTimer && "is-live",
            showTurnTimer && timerTone === "urgent" && "is-urgent"
          )}
          aria-hidden={!showTurnTimer}
        >
          {showTurnTimer && (
            <div
              className={clsx(
                "k-turnbar-fill",
                timerTone === "urgent" ? "is-urgent" : timerTone === "warning" ? "is-warning" : ""
              )}
              style={{ width: `${turnTimer?.percent ?? 0}%` }}
            />
          )}
        </div>
      )}

      {/* The viewer's own identity is not rendered here -- it lives in the
          bottom-left HUD instead (ViewerHud.tsx, rendered by TableRoot). Only
          their CARDS stay on the felt, because only the cards are play.
          This is what finally makes the centre column solvable: this plate was
          the bottom wall of the corridor everything else was trying to fit
          inside. See docs/mobile-ui.md Part 1. */}
      {!identityInHud && (
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
              <Icon name="magen" size={8} />
            </span>
          )}
        </span>
        <span className="flex flex-col items-start leading-tight min-w-0">
          <span className="k-plate-name">
            {displayName}
            {turn.player.isBot && (
              // 11px and undimmed. At the old 9px/70% this was reported as an
              // unidentifiable "circle star" -- see the `bot` icon's own note.
              <span className="inline-block ml-1 align-middle" title="Computer player">
                <Icon name="bot" size={11} />
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
      )}

      <div
        ref={handRef}
        className={clsx("k-hand", isMe && "is-me", canFan && fanned && "is-fanned")}
        style={
          {
            "--deal-dx": `${dealDx}px`,
            "--deal-dy": `${dealDy}px`,
            "--discard-dx": `${discardDx}px`,
            "--discard-dy": `${discardDy}px`,
          } as React.CSSProperties
        }
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

      {!identityInHud && (
        <div className={clsx("k-readout", totalIsConcealed && "is-muted", totalIsBust && "is-bust")}>
          {totalInfo.prefix} <b>{totalInfo.value}</b>
        </div>
      )}

      {!identityInHud && label && <div className={clsx("k-tag", variant)}>{label}</div>}

      {canAdminSkip && (
        <button type="button" className="k-chip-btn" onClick={() => onSkipOther?.(turn.player.id)}>
          <Icon name="skip" size={10} />
          Skip
        </button>
      )}
    </div>
  );
}
