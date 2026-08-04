import { clsx } from "clsx";
import { Player, RoundPhase, Turn } from "../types";
import { totalDisplay, statusDisplay, fullName, tagVariant } from "./selectors";
import { CardView } from "./CardView";
import { Icon } from "./icons";
import { initialsOf } from "./Seat";

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

  return (
    <>
      <div
        className="k-seat"
        style={{ left: "640px", top: "calc(var(--play-top, 0px) + 160px * var(--vf, 1))", transform: "translate(-50%, -50%)" }}
      >
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
                <span className="inline-block ml-1 align-middle opacity-70" title="Computer player">
                  <Icon name="cpu" size={9} />
                </span>
              )}
              {isViewerBanker && <span className="k-plate-sub"> (you)</span>}
            </span>
            <span className="k-plate-sub">Bank</span>
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
          className="k-hand is-dealer"
          style={{ "--deal-dx": `${dealDx}px`, "--deal-dy": `${dealDy}px` } as React.CSSProperties}
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

        {/* Total and status share ONE row rather than stacking. The dealer sits
            at the top of the centre column and the bank panel just below it,
            and when the table flattens that column runs out of room: the
            status tag on its own line pushed the stack down onto the bank
            panel, which painted over it ("BANK PLAYING" half-hidden behind the
            bank total). Reclaiming the row fixes it where it starts, instead
            of shoving the panel down onto the seat below.
            Deliberately nowrap, not wrap: .k-seat is a fixed 168px column, and
            "Total: hidden" + "WAITING..." together need ~190px -- flex-wrap
            would fall back to two lines for exactly the worst case this exists
            to fix, silently undoing it. .k-seat has no overflow:hidden, so a
            wider row just overflows its column and stays centred on the
            dealer's own anchor point instead of clipping. */}
        <div className="flex items-center justify-center gap-1.5 flex-nowrap w-max max-w-none">
          <div className={clsx("k-readout", !/^\d/.test(totalInfo.value) && "is-muted")}>
            {totalInfo.prefix} <b>{totalInfo.value}</b>
          </div>
          {statusInfo.label && (
            <div className={clsx("k-tag", tagVariant(statusInfo.label, isActive))}>
              {isActive ? "Bank playing" : statusInfo.label}
            </div>
          )}
        </div>

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
