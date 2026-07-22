import { useEffect, useMemo, useState } from "react";
import { Player, ReactionEvent, RoomState, RoundState, Turn } from "../types";
import { useFelt } from "../theme";
import { seatPositions } from "./layout";
import { Seat } from "./Seat";
import { Dealer } from "./Dealer";
import { PlayerDock } from "./PlayerDock";
import { BankPanel } from "./BankPanel";
import { ReactionLayer } from "./ReactionLayer";
import { FeltSwitcher } from "./FeltSwitcher";
import { ManageDrawer } from "./ManageDrawer";

export interface BankInfo {
  available: number;
  outstanding: number;
  bankerWallet: number;
  playerIndex: number;
}

export interface TableRootProps {
  room: RoomState;
  round?: RoundState;
  playerId?: string;
  isAdmin: boolean;
  bankerTurn?: Turn;
  playerTurns: Turn[];
  myPlayerTurn?: Turn;
  activeTurnId?: string;
  nextTurnId?: string;
  activeTurnTimer?: { playerId: string; remainingMs: number; percent: number; durationMs: number };
  bankerPlayer?: Player;
  bankInfo?: BankInfo;
  bankIncrement: number;
  bankDisabledReason?: string;
  canBank: boolean;
  firstBetCardIndex?: Record<string, number>;
  latestReactionByPlayer: Record<string, ReactionEvent>;
  onBet: (amount: number, options: { bank: boolean }) => void;
  onHit: (options: { eleveroon: boolean }) => void;
  onStand: () => void;
  onSkip: (playerId?: string) => void;
  onReact: (emoji: string) => void;
  onTopUp: (amount: number, note?: string) => void;
  onSetWatermark: (text: string) => void;
  roundHistoryCount: number;
  onApproveRename: (playerId: string) => void;
  onRejectRename: (playerId: string) => void;
  onApproveBuyIn: (playerId: string) => void;
  onRejectBuyIn: (playerId: string) => void;
  onAdjustChips: (playerId: string, amount: number, note?: string) => void;
  onKick: (playerId: string) => void;
  onExportHistory: () => void;
  onCloseRoom: () => void;
  onStartNextRound: () => void;
}

export function TableRoot({
  room,
  round,
  playerId,
  isAdmin,
  bankerTurn,
  playerTurns,
  myPlayerTurn,
  activeTurnId,
  nextTurnId,
  activeTurnTimer,
  bankerPlayer,
  bankInfo,
  bankIncrement,
  bankDisabledReason,
  canBank,
  firstBetCardIndex,
  latestReactionByPlayer,
  onBet,
  onHit,
  onStand,
  onSkip,
  onReact,
  onTopUp,
  onSetWatermark,
  roundHistoryCount,
  onApproveRename,
  onRejectRename,
  onApproveBuyIn,
  onRejectBuyIn,
  onAdjustChips,
  onKick,
  onExportHistory,
  onCloseRoom,
  onStartNextRound,
}: TableRootProps) {
  const [felt, setFelt] = useFelt(); // applies the viewer's felt color + matching button accents on mount
  const [manageOpen, setManageOpen] = useState(false);

  useEffect(() => {
    document.documentElement.style.setProperty("--wm", JSON.stringify(room.feltWatermark ?? ""));
  }, [room.feltWatermark]);

  const bankLockStage = round?.bankLock?.stage;
  const positions = seatPositions(playerTurns.length);

  // turn.player is a snapshot taken at round-init time and never updated in
  // place (see store.ts's setPresence, which only mutates room.players) --
  // so presence must be read live from room.players, not off the turn, or a
  // player who disconnects mid-round shows a stale "online" dot until the
  // next unrelated round:state broadcast happens to refresh it.
  const presenceByPlayerId = useMemo(() => {
    const map: Record<string, Player["presence"]> = {};
    room.players.forEach((p) => {
      map[p.id] = p.presence;
    });
    return map;
  }, [room.players]);

  const canPlayerAct = Boolean(
    myPlayerTurn &&
      myPlayerTurn.state === "pending" &&
      activeTurnId === playerId &&
      bankLockStage !== "decision"
  );
  const canBankerAct = Boolean(
    isAdmin &&
      bankerTurn &&
      bankerTurn.state === "pending" &&
      activeTurnId === bankerTurn.player.id &&
      bankLockStage !== "decision"
  );

  const bankerWallet = bankerPlayer ? room.wallets?.[bankerPlayer.id] ?? 0 : 0;

  return (
    <div className="felt-table relative w-full rounded-2xl">
      <FeltSwitcher felt={felt} onChange={setFelt} />

      {bankerTurn && (
        <Dealer
          turn={bankerTurn}
          bankerPlayer={bankerPlayer}
          viewerId={playerId}
          isViewerBanker={isAdmin}
          roundState={round?.state}
          canAct={canBankerAct}
          onHit={() => onHit({ eleveroon: true })}
          onStand={onStand}
          deckCount={round?.deck?.length ?? 0}
        />
      )}

      {playerTurns.map((turn, idx) => (
        <Seat
          key={turn.player.id}
          turn={turn}
          viewerId={playerId}
          isAdmin={isAdmin}
          isActiveTurn={activeTurnId === turn.player.id}
          isNextTurn={nextTurnId === turn.player.id}
          roundState={round?.state}
          firstBetCardIndex={firstBetCardIndex}
          turnTimer={activeTurnTimer?.playerId === turn.player.id ? activeTurnTimer : undefined}
          reactionEmoji={latestReactionByPlayer[turn.player.id]?.emoji}
          walletAmount={room.wallets?.[turn.player.id]}
          presence={presenceByPlayerId[turn.player.id]}
          position={positions[idx]}
          onSkipOther={isAdmin ? onSkip : undefined}
        />
      ))}

      {bankerPlayer && (
        <BankPanel
          bankerName={bankerPlayer.firstName}
          bankerWallet={bankerWallet}
          isBanker={isAdmin}
          feltWatermark={room.feltWatermark}
          onTopUp={onTopUp}
          onSetWatermark={onSetWatermark}
          onOpenManage={isAdmin ? () => setManageOpen(true) : undefined}
        />
      )}

      {isAdmin && (
        <ManageDrawer
          open={manageOpen}
          onClose={() => setManageOpen(false)}
          players={room.players}
          wallets={room.wallets ?? {}}
          renameRequests={room.renameRequests ?? []}
          buyInRequests={room.buyInRequests ?? []}
          roundHistoryCount={roundHistoryCount}
          onApproveRename={onApproveRename}
          onRejectRename={onRejectRename}
          onApproveBuyIn={onApproveBuyIn}
          onRejectBuyIn={onRejectBuyIn}
          onAdjustChips={onAdjustChips}
          onKick={onKick}
          onExportHistory={onExportHistory}
          onCloseRoom={onCloseRoom}
        />
      )}

      <ReactionLayer onReact={onReact} disabled={!room.players.some((p) => p.id === playerId)} />

      {canPlayerAct && myPlayerTurn && (
        <PlayerDock
          turn={myPlayerTurn}
          wallet={room.wallets?.[playerId ?? ""] ?? 0}
          bankAvailable={bankInfo?.available}
          bankIncrement={bankIncrement}
          canBank={canBank}
          bankDisabledReason={bankDisabledReason}
          onBet={onBet}
          onHit={onHit}
          onStand={onStand}
        />
      )}

      {round?.state === "terminate" && (
        <div className="fixed bottom-0 left-0 right-0 z-30 flex flex-col items-center gap-2 bg-white/95 px-4 py-3 shadow-[0_-2px_8px_rgba(0,0,0,0.08)]">
          <div className="text-sm font-semibold text-slate-800">Round complete</div>
          {isAdmin ? (
            <button
              type="button"
              className="rounded-full px-5 py-2 text-sm font-semibold text-white shadow"
              style={{ background: "var(--btn-bet)" }}
              onClick={onStartNextRound}
            >
              Start next round
            </button>
          ) : (
            <div className="text-xs text-slate-500">Waiting for the banker to start the next round…</div>
          )}
        </div>
      )}
    </div>
  );
}
