import { useEffect, useMemo, useState } from "react";
import { Player, ReactionEvent, RoomState, RoundState, Turn } from "../types";
import { useFelt } from "../theme";
import { orderSeatsForViewer, seatPositions, seatScale, STAGE_HEIGHT, STAGE_WIDTH } from "./layout";
import { useStageScale } from "./stage";
import { Seat } from "./Seat";
import { Dealer } from "./Dealer";
import { PlayerDock } from "./PlayerDock";
import { BankPanel } from "./BankPanel";
import { ReactionLayer } from "./ReactionLayer";
import { FeltSwitcher } from "./FeltSwitcher";
import { ManageDrawer } from "./ManageDrawer";
import { Icon } from "./icons";
import { useFullscreen } from "./fullscreen";

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
  const { supported: fullscreenSupported, isFullscreen, toggleFullscreen } = useFullscreen();
  const { wrapRef, scale } = useStageScale();

  useEffect(() => {
    document.documentElement.style.setProperty("--wm", JSON.stringify(room.feltWatermark ?? ""));
  }, [room.feltWatermark]);

  const bankLockStage = round?.bankLock?.stage;

  // Seat the viewer at the bottom edge (standard card-game convention) while
  // preserving cyclic turn order around the table.
  const seatedTurns = useMemo(
    () => orderSeatsForViewer(playerTurns, (t) => t.player.id === playerId),
    [playerTurns, playerId]
  );
  const positions = seatPositions(seatedTurns.length);
  const seatShrink = seatScale(positions);

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
  const roundOver = round?.state === "terminate";

  return (
    <div className="k-fit" ref={wrapRef}>
      <div
        className="felt-table"
        style={{ transform: `scale(${scale})`, width: STAGE_WIDTH, height: STAGE_HEIGHT }}
      >
        <div className="k-oval" />
        <div className="k-ring" />

        {/* Decorative branding only -- scales with the table. The interactive
            chrome lives outside the stage (see .k-chrome-top below). */}
        <div className="k-topbar">
          <div className="flex items-end gap-3">
            <span className="k-logo-word">Kvitlach</span>
            <span className="k-logo-tag">Ah Heimishe Chanukah Shpil</span>
            <span className="k-beta">Beta</span>
          </div>
        </div>

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

        {seatedTurns.map((turn, idx) => (
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
            scale={seatShrink}
            onSkipOther={isAdmin ? onSkip : undefined}
          />
        ))}

        {bankerPlayer && <BankPanel bankerWallet={bankerWallet} bankAvailable={bankInfo?.available} />}

      </div>

      {/* ---- Chrome: outside the stage, so NOT scaled. Controls stay at
           true viewport size and remain readable/tappable on a phone. ---- */}
      <div className="k-chrome-top">
        <FeltSwitcher felt={felt} onChange={setFelt} />
        {fullscreenSupported && (
          <button
            type="button"
            className="k-chip-btn"
            onClick={toggleFullscreen}
            title={isFullscreen ? "Exit fullscreen" : "Fullscreen (best in landscape)"}
            aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          >
            <Icon name={isFullscreen ? "compress" : "expand"} size={13} />
          </button>
        )}
        {isAdmin && (
          <button type="button" className="k-chip-btn" onClick={() => setManageOpen(true)} title="Manage table">
            <Icon name="users" size={13} />
            Manage
          </button>
        )}
        <span className="k-room">{room.roomId}</span>
      </div>

      <div className="k-chrome-react">
        <ReactionLayer onReact={onReact} disabled={!room.players.some((p) => p.id === playerId)} />
      </div>

      {canPlayerAct && myPlayerTurn && !roundOver && (
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

      {roundOver && (
        <div className="k-dock">
          <span className="k-banktotal">Round complete</span>
          {isAdmin ? (
            <button type="button" className="k-btn bet" onClick={onStartNextRound}>
              Start next round
            </button>
          ) : (
            <span className="k-tag muted">Waiting for the banker to start the next round…</span>
          )}
        </div>
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
          bankerWallet={bankerWallet}
          feltWatermark={room.feltWatermark}
          onTopUp={onTopUp}
          onSetWatermark={onSetWatermark}
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
    </div>
  );
}
