import { useEffect, useMemo, useState } from "react";
import { Player, ReactionEvent, RoomState, RoundState, Turn } from "../types";
import { UINotification } from "../state";
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
import { StatsModal } from "./StatsModal";
import { StatsData } from "./useTableData";
import { Icon } from "./icons";
import { useFullscreen } from "./fullscreen";
import { useWakeLock } from "./wakeLock";
import { isIOS, isStandaloneDisplay } from "./platform";

// Shown on the felt until a banker sets their own watermark via Manage ->
// table settings -- a fixed default rather than the room's own (randomly
// assigned) name, per the family this app was originally built for.
const DEFAULT_WATERMARK = "משפחת שלזינגר קוויטלאך";

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
  waitingInfo?: { count: number; isViewerWaiting: boolean; namesLabel: string };
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
  onLeave: () => void;
  onReshuffleDeck: () => void;
  notifications: UINotification[];
  onDismissNotification: (id: string) => void;
  statsData?: StatsData;
  onOpenStats: (playerId: string) => void;
  onCloseStats: () => void;
  musicEnabled: boolean;
  sfxEnabled: boolean;
  onToggleMusic: () => void;
  onToggleSfx: () => void;
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
  waitingInfo,
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
  onLeave,
  onReshuffleDeck,
  notifications,
  onDismissNotification,
  statsData,
  onOpenStats,
  onCloseStats,
  musicEnabled,
  sfxEnabled,
  onToggleMusic,
  onToggleSfx,
}: TableRootProps) {
  const [felt, setFelt] = useFelt(); // applies the viewer's felt color + matching button accents on mount
  const [manageOpen, setManageOpen] = useState(false);
  const { supported: fullscreenSupported, isFullscreen, toggleFullscreen } = useFullscreen();
  const { wrapRef, scale } = useStageScale();
  useWakeLock(true); // the felt table only ever mounts while a room+round is active

  // The Fullscreen API can only be entered from a real tap (see
  // fullscreen.ts), so it can never auto-start -- nudge new visitors to tap
  // it themselves instead, once, and never again once they've either done
  // so or dismissed the hint.
  const FULLSCREEN_HINT_KEY = "kvitlach.fullscreenHintSeen";
  const [showFullscreenHint, setShowFullscreenHint] = useState(() => {
    if (typeof window === "undefined" || !window.localStorage) return false;
    try {
      return window.localStorage.getItem(FULLSCREEN_HINT_KEY) !== "1";
    } catch {
      return false;
    }
  });
  const dismissFullscreenHint = () => {
    setShowFullscreenHint(false);
    if (typeof window === "undefined" || !window.localStorage) return;
    try {
      window.localStorage.setItem(FULLSCREEN_HINT_KEY, "1");
    } catch {
      /* ignore -- the hint just reappears next visit, not worth failing over */
    }
  };
  useEffect(() => {
    if (isFullscreen) dismissFullscreenHint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFullscreen]);

  // iOS Safari can't enter fullscreen at all (fullscreenSupported is always
  // false there) -- the only real chrome-free path on an iPhone is adding the
  // page to the home screen, so give those visitors a different, one-time
  // nudge toward that instead of just silently having no fullscreen control.
  const IOS_HINT_KEY = "kvitlach.iosInstallHintSeen";
  const [showIOSInstallHint, setShowIOSInstallHint] = useState(() => {
    if (typeof window === "undefined" || !window.localStorage) return false;
    if (!isIOS() || isStandaloneDisplay()) return false;
    try {
      return window.localStorage.getItem(IOS_HINT_KEY) !== "1";
    } catch {
      return false;
    }
  });
  const dismissIOSInstallHint = () => {
    setShowIOSInstallHint(false);
    if (typeof window === "undefined" || !window.localStorage) return;
    try {
      window.localStorage.setItem(IOS_HINT_KEY, "1");
    } catch {
      /* ignore -- the hint just reappears next visit, not worth failing over */
    }
  };

  useEffect(() => {
    // Every table should show SOME branding by default, not just once a
    // banker bothers to set one.
    const watermark = room.feltWatermark || DEFAULT_WATERMARK;
    document.documentElement.style.setProperty("--wm", JSON.stringify(watermark));
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
            onOpenStats={onOpenStats}
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
            onOpenStats={onOpenStats}
          />
        ))}

        {bankerPlayer && <BankPanel bankerWallet={bankerWallet} bankAvailable={bankInfo?.available} />}

      </div>

      {/* ---- Chrome: outside the stage, so NOT scaled. Controls stay at
           true viewport size and remain readable/tappable on a phone. ---- */}
      <div className="k-chrome-top">
        <FeltSwitcher felt={felt} onChange={setFelt} />
        <button
          type="button"
          className="k-chip-btn"
          onClick={onToggleMusic}
          aria-pressed={musicEnabled}
          style={!musicEnabled ? { opacity: 0.45 } : undefined}
          title={musicEnabled ? "Mute background music" : "Play background music"}
        >
          <Icon name="music" size={13} />
        </button>
        <button
          type="button"
          className="k-chip-btn"
          onClick={onToggleSfx}
          aria-pressed={sfxEnabled}
          style={!sfxEnabled ? { opacity: 0.45 } : undefined}
          title={sfxEnabled ? "Mute sound effects" : "Enable sound effects"}
        >
          <Icon name="speaker" size={13} />
        </button>
        {fullscreenSupported && (
          <span className="relative inline-flex">
            <button
              type="button"
              className="k-chip-btn"
              onClick={toggleFullscreen}
              title={isFullscreen ? "Exit fullscreen" : "Fullscreen (best in landscape)"}
              aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            >
              <Icon name={isFullscreen ? "compress" : "expand"} size={13} />
            </button>
            {showFullscreenHint && !isFullscreen && (
              <div className="k-fs-hint">
                Tap for fullscreen -- best in landscape.
                <button type="button" onClick={dismissFullscreenHint}>
                  Got it
                </button>
              </div>
            )}
          </span>
        )}
        {showIOSInstallHint && (
          <span className="relative inline-flex">
            <span className="k-chip-btn" style={{ cursor: "default" }}>
              <Icon name="share" size={13} />
            </span>
            <div className="k-fs-hint">
              Add to Home Screen (tap Share, then "Add to Home Screen") for a full-screen table.
              <button type="button" onClick={dismissIOSInstallHint}>
                Got it
              </button>
            </div>
          </span>
        )}
        {isAdmin && (
          <button type="button" className="k-chip-btn" onClick={() => setManageOpen(true)} title="Manage table">
            <Icon name="users" size={13} />
            Manage
          </button>
        )}
        {waitingInfo && (
          <span className="k-tag muted" title={`${waitingInfo.namesLabel} will join after this round ends.`}>
            {waitingInfo.isViewerWaiting
              ? waitingInfo.count > 1
                ? `You + ${waitingInfo.count - 1} queued`
                : "You're queued — next round"
              : `${waitingInfo.count} queued for next round`}
          </span>
        )}
        <span className="k-room">{room.roomId}</span>
        <button type="button" className="k-chip-btn" onClick={onLeave} title="Leave this game and return to the join screen">
          <Icon name="door" size={13} />
          Leave
        </button>
      </div>

      <div className="k-chrome-react">
        <ReactionLayer onReact={onReact} disabled={!room.players.some((p) => p.id === playerId)} />
      </div>

      {notifications.length > 0 && (
        <div className="k-toast-stack">
          {notifications.map((note) => (
            <div key={note.id} className={`k-toast ${note.tone}`} role="alert" aria-live="assertive">
              <span>{note.message}</span>
              <button type="button" onClick={() => onDismissNotification(note.id)}>
                Dismiss
              </button>
            </div>
          ))}
        </div>
      )}

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
          canReshuffle={roundOver}
          onReshuffleDeck={onReshuffleDeck}
        />
      )}

      {statsData && <StatsModal data={statsData} onClose={onCloseStats} />}
    </div>
  );
}
