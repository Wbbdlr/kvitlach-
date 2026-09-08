import { useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import { Player, RoundPhase, Turn } from "../types";
import { totalDisplay, statusDisplay, fullName, tagVariant, winningCardIndices } from "./selectors";
import { CardView } from "./CardView";
import { BankPanel } from "./BankPanel";
import { Icon } from "./icons";
import { initialsOf } from "./Seat";
import { useHandFan } from "./handFan";
import { StageOverlay } from "./StageOverlay";

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
  /** Server timestamp of the last reshuffle. Only ever compared for CHANGE,
   *  never displayed -- a new value means a fresh shoe just arrived and the
   *  shoe should visibly say so (see the animation below). */
  deckReshuffledAt?: number;
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
  deckReshuffledAt,
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
  // A fresh shoe is otherwise completely silent on the felt -- the count
  // jumps and nothing else moves, which is why a banker who had just
  // reshuffled mid-round could not tell it had worked and reported the
  // dialog as stuck (2026-09-06; see ManageDrawer's own note). One shuffle
  // animation on the shoe answers "did that do anything?" without a toast
  // the felt has to make room for.
  //
  // Keyed off the SERVER's timestamp rather than a local click, so it fires
  // for everyone at the table -- a reshuffle is a table-wide event, and the
  // player who pressed the button is the one person who least needs telling.
  //
  // roundId is tracked alongside the timestamp, and that pairing is the whole
  // correctness argument. deckReshuffledAt is a PERSISTENT field on the round
  // (round.ts sets it at creation for a between-rounds reshuffle, and it then
  // stays set for that round's whole life), so "the value went from undefined
  // to a number" does NOT mean a shuffle just happened -- it also happens to
  // anyone who arrives mid-round, because this component mounts before the
  // first round:state lands and then receives a round carrying an old
  // timestamp. Seeding a ref on first render alone did not cover that: at
  // that point there is no round yet, so the seed is undefined and the
  // arriving round reads as a change. Refusing to animate until we have seen
  // a round at all (prev.roundId defined) is what actually distinguishes "a
  // shuffle happened while I was watching" from "I just got here".
  const [shuffling, setShuffling] = useState(false);
  const lastSeenRef = useRef<{ roundId?: string; at?: number }>({ roundId, at: deckReshuffledAt });
  useEffect(() => {
    const prev = lastSeenRef.current;
    lastSeenRef.current = { roundId, at: deckReshuffledAt };
    if (prev.roundId === undefined) return; // first round we have seen -- baseline only
    if (!deckReshuffledAt || deckReshuffledAt === prev.at) return;
    setShuffling(true);
    const id = window.setTimeout(() => setShuffling(false), 900);
    return () => window.clearTimeout(id);
  }, [deckReshuffledAt, roundId]);

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
  // See Seat.tsx's identical line -- one answer for the whole hand.
  const bankWinners = winningCardIndices(turn);
  const name = bankerPlayer ? fullName(bankerPlayer) || bankerPlayer.firstName : "Bank";
  const isOffline = bankerPlayer ? bankerPlayer.presence !== "online" : false;
  const isActive = turn.state === "pending" && roundState === "final";
  // See Seat.tsx -- same tap-to-fan-out treatment, same 4-card threshold.
  const canFan = turn.cards.length >= 4;
  const handRef = useRef<HTMLDivElement>(null);
  const { fanned, toggle } = useHandFan(handRef, roundId);

  // See Seat.tsx's own reactionAnchor effect -- identical bug, identical
  // fix, same root cause: this wrapper is `.k-seat` too (position + z-index:
  // 10/20, its own stacking context), so the bubble's LOCAL z-index never
  // competed against .table-fly-card (z-index: 80, appended straight to
  // document.body). Dealer.reaction.test.tsx pins that a seat and the bank
  // render reactions identically -- portal both or neither, not one.
  const dealerRef = useRef<HTMLDivElement>(null);
  const [reactionAnchor, setReactionAnchor] = useState<{ top: number; left: number } | null>(null);
  useEffect(() => {
    if (!reactionEmoji) {
      setReactionAnchor(null);
      return;
    }
    const rect = dealerRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Always the side anchor -- see the comment this replaces: the bank sits
    // at the top of the oval, so there is only one right answer here.
    setReactionAnchor({ top: rect.top + rect.height / 2, left: rect.right + 10 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reactionEmoji]);

  return (
    <>
      <div
        ref={dealerRef}
        // See Seat.tsx's hand-fanned comment -- same stacking-context reason.
        className={clsx("k-seat", canFan && fanned && "hand-fanned")}
        style={{ left: "640px", top: "calc(var(--play-top, 0px) + 160px * var(--vf, 1))", transform: "translate(-50%, -50%)" }}
      >
        {/* is-side, always: the bank sits at the TOP of the oval, so "above
            it" is the chrome row, not felt. Seat.tsx picks between the two
            anchors per seat; here there is only ever one right answer.
            No --k-rx term needed, portalled or not: the dealer is the one box
            on the felt that never rides seatScale (see layout.ts). */}
        {reactionEmoji && reactionAnchor && (
          <StageOverlay>
            <div
              className="k-reaction is-side"
              aria-label="Reaction"
              style={{ position: "fixed", top: reactionAnchor.top, left: reactionAnchor.left, margin: 0 }}
            >
              {reactionEmoji}
            </div>
          </StageOverlay>
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
            {/* The bank's total is NOT here. It spent a release on this
                sub-line -- 8px grey parchment text reading "Bank · 17" --
                and a tester reported it as simply GONE: "I don't see the
                banker's total tally any more, other players have it still."
                Fair. Every player seat renders its total as a .k-readout pill
                (dark, 11px counter-scaled, bold amber value); folding the
                banker's into the plate caption made it a different kind of
                thing, in a different place, at a third of the weight.
                It is a .k-readout on .k-bank-hud-row now, below the hand. */}
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
          {turn.cards.map((c, idx) => {
            const hidden = idx === 0 && !bankerReveal;
            return (
              <CardView
                // Round-scoped for the same reason as Seat.tsx -- otherwise
                // the bank's own opening card never re-animates past round 1.
                key={`${roundId ?? "r"}-${idx}`}
                card={c}
                hidden={hidden}
                // The bank deals to itself first, so no extra stagger delay.
                dealDelayMs={0}
                pastFirstPaint={pastFirstPaint}
                // The bank's 21 is already the loudest moment on the felt
                // (statusDisplay's own "BANK 21!"); this is the same event
                // said on the cards. Never while the hole card is still down.
                winning={!hidden && bankWinners.has(idx)}
              />
            );
          })}
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
            // Same pill, same classes, same concealed/bust encoding as every
            // player seat (Seat.tsx) -- deliberately NOT a bank-specific
            // variant, because "the banker's total looks like everyone
            // else's" is the whole point of it being back. Bust comes off
            // selectors' own rose classname rather than Seat's
            // `label === "FUTCHED!"`, which is a player-only label: the
            // banker's bust reads "BANK BUST"/"BEAT n - LOST n" instead.
            total={
              <div
                className={clsx(
                  "k-readout",
                  !/^\d/.test(totalInfo.value) && "is-muted",
                  totalInfo.valueClassName?.includes("rose") && "is-bust",
                )}
              >
                {totalInfo.prefix} <b>{totalInfo.value}</b>
              </div>
            }
            status={
              statusInfo.label ? (
                <div className={clsx("k-tag", tagVariant(statusInfo.label, isActive))}>
                  {isActive ? "Bank playing" : statusInfo.label}
                </div>
              ) : null
            }
          />
        )}

        {/* Not `sm`, and not on the felt's ordinary button sizing: see
            .k-bank-act in index.css. These sit on the SCALED stage, so they
            were the smallest targets in the whole app on a phone despite
            being the ones pressed every round. */}
        {canAct && (
          <div className="k-bank-act flex">
            <button className="k-btn hit" onClick={onHit}>
              Hit
            </button>
            <button className="k-btn stand" onClick={onStand}>
              Stand
            </button>
          </div>
        )}
      </div>

      <div
        className={clsx("k-shoe", shuffling && "is-shuffling")}
        title={`${deckCount ?? 0} cards left in the shoe`}
      >
        {/* Two extra backs, rendered only while shuffling, so the stack has
            something to riffle against -- the resting shoe is a single card
            back and one card cannot look like a shuffle on its own. */}
        {shuffling && <span className="k-cardback k-shoe-riffle a" aria-hidden="true" />}
        {shuffling && <span className="k-cardback k-shoe-riffle b" aria-hidden="true" />}
        <span className="k-cardback" />
        <span className="k-shoe-count">
          {shuffling ? "Shuffling…" : `${deckCount ?? 0} left`}
        </span>
      </div>
    </>
  );
}
