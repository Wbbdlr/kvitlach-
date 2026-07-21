import { useEffect } from "react";
import { Player, ReactionEvent, RoomState, RoundState, Turn } from "../types";
import { useFelt } from "../theme";
import { seatPositions } from "./layout";
import { Seat } from "./Seat";
import { Dealer } from "./Dealer";
import { PlayerDock } from "./PlayerDock";
import { BankPanel } from "./BankPanel";
import { ReactionLayer } from "./ReactionLayer";

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
}: TableRootProps) {
  useFelt(); // applies the viewer's felt color + matching button accents on mount

  useEffect(() => {
    document.documentElement.style.setProperty("--wm", JSON.stringify(room.feltWatermark ?? ""));
  }, [room.feltWatermark]);

  const bankLockStage = round?.bankLock?.stage;
  const positions = seatPositions(playerTurns.length);

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
    <div className="felt-table relative w-full min-h-[520px] rounded-2xl">
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
    </div>
  );
}
