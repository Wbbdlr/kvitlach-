import { clsx } from "clsx";
import { Player, RoundPhase, Turn } from "../types";
import { totalDisplay, statusDisplay, fullName } from "./selectors";
import { CardView } from "./CardView";
import { Icon } from "./icons";

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
}

// The dealer's own hole card stays visible face-down near the deck at all
// times (per product direction — it should never look "missing"), and once
// the banker starts playing, its cards flip in real time as calcState
// resolves them; the shoe/deck sits just to the banker's right.
export function Dealer({ turn, bankerPlayer, viewerId, isViewerBanker, roundState, forceBankerReveal, canAct, onHit, onStand, deckCount }: DealerProps) {
  const shouldForceReveal = forceBankerReveal || roundState === "final" || roundState === "terminate";
  const totalInfo = totalDisplay(turn, viewerId, roundState, { forceBankerReveal: shouldForceReveal });
  const statusInfo = statusDisplay(turn);
  const bankerReveal = shouldForceReveal || turn.state !== "pending";
  const name = bankerPlayer ? fullName(bankerPlayer) || bankerPlayer.firstName : "Bank";

  return (
    <div className="absolute top-24 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1">
      <div className="rounded-xl bg-white/95 px-4 py-2 shadow-lg flex flex-col items-center gap-1 min-w-[140px] border border-amber-200">
        <div className="flex items-center gap-1 text-sm font-semibold text-slate-800">
          <Icon name="bank" size={14} className="text-amber-700" />
          {bankerPlayer && (
            <span
              className={clsx("h-2 w-2 rounded-full", bankerPlayer.presence === "online" ? "bg-emerald-500" : "bg-slate-300")}
              aria-label={bankerPlayer.presence === "online" ? "Online" : "Offline"}
              title={bankerPlayer.presence === "online" ? "Online" : "Offline"}
            />
          )}
          <span>{name}</span>
          {isViewerBanker && <span className="italic text-slate-500" aria-label="You">(Me)</span>}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {turn.cards.map((c, idx) => (
              <CardView key={idx} card={c} hidden={idx === 0 && !bankerReveal} size="lg" />
            ))}
          </div>
          <div className="flex flex-col items-center gap-0.5 text-slate-500" title={`${deckCount ?? 0} cards left in the shoe`}>
            <div className="w-8 h-11 rounded border border-slate-300 bg-slate-100 flex items-center justify-center">
              <Icon name="coins" size={14} />
            </div>
            <span className="text-[9px]">{deckCount ?? 0} left</span>
          </div>
        </div>

        <div className={clsx("text-[11px]", totalInfo.wrapperClassName ?? "text-slate-600")}>
          {totalInfo.prefix} <span className={totalInfo.valueClassName}>{totalInfo.value}</span>
        </div>
        {statusInfo.label && <div className={clsx("text-[10px] uppercase", statusInfo.className)}>{statusInfo.label}</div>}

        {canAct && (
          <div className="flex gap-2 mt-1">
            <button
              className="rounded px-3 py-1.5 text-xs font-semibold text-white"
              style={{ background: "var(--btn-hit)" }}
              onClick={onHit}
            >
              Hit
            </button>
            <button
              className="rounded px-3 py-1.5 text-xs font-semibold text-white"
              style={{ background: "var(--btn-stand)" }}
              onClick={onStand}
            >
              Stand
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
