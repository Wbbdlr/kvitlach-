import { useRef } from "react";
import { clsx } from "clsx";
import { Player, RoundPhase, Turn } from "../types";
import { totalDisplay, statusDisplay, fullName, tagVariant } from "./selectors";
import { CardView } from "./CardView";
import { BankPanel } from "./BankPanel";
import { Icon } from "./icons";
import { initialsOf } from "./Seat";
import { useHandFan } from "./handFan";

export interface DealerProps {
  turn: Turn;
  bankerPlayer?: Player;
  viewerId?: string;
  isViewerBanker: boolean;
  roundState?: RoundPhase;
  forceBankerReveal?: boolean;
  canAct?: boolean;
  onHit?: () => void;
  onStand?: () => void;
  deckCount?: number;
  onOpenStats?: (playerId: string) => void;
  // See Seat.tsx -- same round-scoped-key/first-paint-gate/shoe-flight
  // mechanism, applied to the bank's own hand.
  roundId?: string;
  pastFirstPaint?: boolean;
  dealDx?: number;
  dealDy?: number;
  // See Seat.tsx -- the mirror image of dealDx/dealDy, applied to the bank's
  // own hand for cardDiscardFly.
  discardDx?: number;
  discardDy?: number;
  // The bank's own money, rendered on the banker's own seat -- see the
  // BankPanel call below.
  bankerWallet?: number;
  reserved?: number;
  /**
   * The banker's own reaction bubble.
   *
   * ReactionLayer.tsx has always said these are "rendered by Seat.tsx/
   * Dealer.tsx directly" -- Seat.tsx did, this file never did, and the comment
   * described an intention rather than the code. So the banker could send a
   * reaction and be the only person at the table who never appeared to have
   * said anything. Found while chasing a tester report that the banker's
   * moments go unannounced; same silence, different cause.
   */
  reactionEmoji?: string;
}

// The Bank's own seat, fixed at the top of the oval, with the shoe sitting
// beside it. Both are absolutely positioned on the 1280x760 stage.
export function Dealer({
  turn,
  bankerPlayer,
  viewerId,
  isViewerBanker,
  roundState,
  forceBankerReveal,
  canAct,
  onHit,
  onStand,
  deckCount,
  onOpenStats,
  roundId,
  pastFirstPaint,
  dealDx = 0,
  dealDy = 0,
  discardDx = 0,
  discardDy = 0,
  bankerWallet,
  reserved = 0,
  reactionEmoji,
}: DealerProps) {
  // NOTE: round.state === "final" means the banker's turn has just BEGUN
  // (all other players are resolved), not that the banker is done -- see
  // getGameState in round.ts. Only an explicit forceBankerReveal or the
  // round fully ending should flip the hole card; the banker's own
  // turn.state !== "pending" (below) covers a bust/natural-21 resolving it.
  const shouldForceReveal = forceBankerReveal || roundState === "terminate";
  const totalInfo = totalDisplay(turn, viewerId, roundState, { forceBankerReveal: shouldForceReveal });
  const statusInfo = statusDisplay(turn);
  // The banker must always see their own hole card, same as totalDisplay
  // already reveals their own true total above -- only OTHER players' view
  // of the banker should stay concealed until bankerReveal.
  const isOwnerView = viewerId === turn.player.id;
  const bankerReveal = shouldForceReveal || turn.state !== "pending" || isOwnerView;
  const name = bankerPlayer ? fullName(bankerPlayer) || bankerPlayer.firstName : "Bank";
  const isOffline = bankerPlayer ? bankerPlayer.presence !== "online" : false;
  const isActive = turn.state === "pending" && roundState === "final";
  // See Seat.tsx -- same tap-to-fan-out treatment, same 4-card threshold.
  const canFan = turn.cards.length >= 4;
  const handRef = useRef<HTMLDivElement>(null);
  const { fanned, toggle } = useHandFan(handRef, roundId);

  return (
    <>
      <div
        // See Seat.tsx's hand-fanned comment -- same stacking-context reason.
        className={clsx("k-seat", canFan && fanned && "hand-fanned")}
        style={{ left: "640px", top: "calc(var(--play-top, 0px) + 160px * var(--vf, 1))", transform: "translate(-50%, -50%)" }}
      >
        {/* is-side, always: the bank sits at the TOP of the oval, so "above
            it" is the chrome row, not felt. Seat.tsx picks between the two
            anchors per seat; here there is only ever one right answer.
            No --k-rx is set on this element: the dealer is the one box on the
            felt that never rides seatScale (see layout.ts), so its bubble has
            nothing to counter-scale out of. */}
        {reactionEmoji && (
          <div className="k-reaction is-side" aria-label="Reaction">
            {reactionEmoji}
          </div>
        )}
        {/* The bank's money, on the banker's own seat -- LAST child, so it sits
            below the hand rather than above the plate.

            It was the first child, which put it directly above the plate it
            belongs to and was right about the association. What it got wrong is
            where that lands: the dealer's column is centred on its anchor, so
            hanging a panel off the top pushed the whole readout ABOVE the
            oval's rail and out onto the dark surround, where it read as chrome
            rather than as money on the table. Reported by a tester as the
            bank's total and the reserved/free line being too high up and
            wanting to be nearer the middle of the table. Same association,
            opposite end of the same column.

            It spent one step in the top chrome row, which was right about
            leaving the felt's centre column and wrong about where it landed:
            reported as making no sense off in a corner, and fairly. This is
            what docs/mobile-ui.md Part 2 rule 3 actually asks for -- per-entity
            state rides ON its entity. The bank IS the banker.

            Positioned by FLOW, not arithmetic: .k-seat is a flex column with a
            gap, so this is simply its first item and nothing measures anything.
            It costs the dealer's box ~24 stage px of height, budgeted for in
            stage.ts's DEALER_SEAT_OVERHANG_PX rather than absorbed silently --
            and step 2 hands ~39px straight back when the status row below folds
            into the plate. */}
        <button
          type="button"
          className={clsx("k-plate", isActive && "is-active", isOffline && "is-offline")}
          onClick={() => bankerPlayer && onOpenStats?.(bankerPlayer.id)}
          disabled={!bankerPlayer}
          title={`View ${name}'s stats`}
        >
          <span className="k-av">
            {bankerPlayer ? initialsOf(bankerPlayer) : "BK"}
            <span className="k-bankmark">
              <Icon name="bank" size={8} />
            </span>
          </span>
          <span className="flex flex-col items-start leading-tight min-w-0">
            <span className="k-plate-name">
              {name}
              {bankerPlayer?.isBot && (
                <span className="inline-block ml-1 align-middle" title="Computer player">
                  <Icon name="bot" size={11} />
                </span>
              )}
              {isViewerBanker && <span className="k-plate-sub"> (you)</span>}
            </span>
            {/* The bank's own total, on the sub-line rather than in a row of
                its own below the hand. A word and a number replacing a word
                costs the column nothing; a row cost it ~39px it did not have.
                is-muted carries the concealed case ("hidden", "--") the same
                way the old .k-readout did -- selectors.ts encodes that
                distinction in the value, and it has to survive the move. */}
            <span className={clsx("k-plate-sub", !/^\d/.test(totalInfo.value) && "is-muted")}>
              Bank · {totalInfo.value}
            </span>
          </span>
          {bankerPlayer && (
            <span
              className={clsx("h-2 w-2 rounded-full flex-none", isOffline ? "bg-slate-400" : "bg-emerald-500")}
              aria-label={isOffline ? "Offline" : "Online"}
              title={isOffline ? "Offline" : "Online"}
            />
          )}
        </button>

        <div
          ref={handRef}
          className={clsx("k-hand", "is-dealer", canFan && fanned && "is-fanned")}
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
          aria-label={canFan ? `${fanned ? "Collapse" : "Show"} all ${turn.cards.length} cards in the bank's hand` : undefined}
        >
          {turn.cards.map((c, idx) => (
            <CardView
              // Round-scoped for the same reason as Seat.tsx -- otherwise
              // the bank's own opening card never re-animates past round 1.
              key={`${roundId ?? "r"}-${idx}`}
              card={c}
              hidden={idx === 0 && !bankerReveal}
              // The bank deals to itself first, so no extra stagger delay.
              dealDelayMs={0}
              pastFirstPaint={pastFirstPaint}
            />
          ))}
        </div>

        {/* The dealer's total and status USED to be a row of their own, right
            here, below the hand -- the third thing stacked in a column that
            fits two. It went through two fixes in that position (share one row
            rather than stacking; then `is-flanking`, which moved it out beside
            the cards on a phone) and neither held, because both were arguments
            about where to put a row the column had no room for.
            It is not here any more. The total rides on the plate's own sub-line
            and the status tag rides in the header row above it -- both rows
            that already existed, so the column is a whole row shorter than it
            was. See docs/mobile-ui.md Part 2 rule 3. */}

        {bankerWallet !== undefined && (
          <BankPanel
            bankerWallet={bankerWallet}
            reserved={reserved}
            // The banker's turn status rides on the SAME line as their total.
            // That line is already allocated, so carrying the tag here costs
            // the column nothing -- which is the whole reason the status row
            // below the hand could be deleted rather than relocated again.
            status={
              statusInfo.label ? (
                <div className={clsx("k-tag", tagVariant(statusInfo.label, isActive))}>
                  {isActive ? "Bank playing" : statusInfo.label}
                </div>
              ) : null
            }
          />
        )}

        {canAct && (
          <div className="flex gap-2">
            <button className="k-btn hit sm" onClick={onHit}>
              Hit
            </button>
            <button className="k-btn stand sm" onClick={onStand}>
              Stand
            </button>
          </div>
        )}
      </div>

      <div className="k-shoe" title={`${deckCount ?? 0} cards left in the shoe`}>
        <span className="k-cardback" />
        <span className="k-shoe-count">{deckCount ?? 0} left</span>
      </div>
    </>
  );
}
