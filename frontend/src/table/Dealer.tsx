import { clsx } from "clsx";
import { Player, RoundPhase, Turn } from "../types";
import { totalDisplay, statusDisplay, fullName } from "./selectors";
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
      <div className="k-seat" style={{ left: "640px", top: "160px", transform: "translate(-50%, -50%)" }}>
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

        <div className="k-hand is-dealer">
          {turn.cards.map((c, idx) => (
            <CardView key={idx} card={c} hidden={idx === 0 && !bankerReveal} />
          ))}
        </div>

        <div className={clsx("k-readout", !/^\d/.test(totalInfo.value) && "is-muted")}>
          {totalInfo.prefix} <b>{totalInfo.value}</b>
        </div>
        {statusInfo.label && (
          <div className={clsx("k-tag", isActive ? "turn" : statusInfo.label === "STANDING" ? "stand" : "muted")}>
            {isActive ? "Bank playing" : statusInfo.label}
          </div>
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
