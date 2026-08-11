import { useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import { Player, ReactionEvent, RoomState, RoundState, Turn } from "../types";
import { UINotification } from "../state";
import { useFelt } from "../theme";
import { discardPilePosition, orderSeatsForViewer, seatPositions, seatScale, shoePosition, spreadFactor, STAGE_WIDTH } from "./layout";
import { fullName, statusDisplay, reservedAgainst } from "./selectors";
import { useStageScale } from "./stage";
import { Seat } from "./Seat";
import { Dealer } from "./Dealer";
import { PlayerDock } from "./PlayerDock";
import { BankPanel } from "./BankPanel";
import { BankReservations } from "./BankReservations";
import { ReactionLayer } from "./ReactionLayer";
import { FeltSwitcher } from "./FeltSwitcher";
import { ManageDrawer } from "./ManageDrawer";
import { RoomInfoDrawer } from "./RoomInfoDrawer";
import { WaitingListDrawer, WaitingListEntry } from "./WaitingListDrawer";
import { StatsModal } from "./StatsModal";
import { DiscardEntry, DiscardPile, discardedEntries } from "./DiscardPile";
import { DiscardPileModal } from "./DiscardPileModal";
import { BankSummaryModal } from "./BankSummaryModal";
import { CompletedRoundSummary } from "../state";
import { StatsData } from "./useTableData";
import { Icon } from "./icons";
import { useFullscreen } from "./fullscreen";
import { useWakeLock } from "./wakeLock";
import { isIOS, isStandaloneDisplay } from "./platform";

// Shown on the felt until a banker sets their own watermark via Manage ->
// table settings -- a fixed default rather than the room's own (randomly
// assigned) name, per the family this app was originally built for.
const DEFAULT_WATERMARK = "משפחת שלעזינגער קוויטלעך";

// Mirrors backend/src/store.ts's PRACTICE_TOPUP_AMOUNT -- display-only value,
// the actual amount credited is always server-authoritative.
const PRACTICE_TOPUP_DISPLAY = 100;

// Below this the whole stage is squeezed so far down that in-felt annotations
// stop being readable at all: a phone held in PORTRAIT lands around 0.30, so a
// 12px badge paints at under 4px. Landscape -- which the table actively asks
// people to use -- sits near 0.71, where the same badge is perfectly legible
// once it counter-scales (see .k-resv in index.css). Judged on the rendered
// scale rather than a viewport breakpoint, because scale is the thing that
// actually decides whether a person can read it.
const TINY_STAGE_SCALE = 0.45;

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
  // Every resolved hand's cards from EARLIER rounds on the current shoe --
  // this round's own are still derived live from bankerTurn/playerTurns
  // below, merged with this at the point DiscardPile/DiscardPileModal are
  // rendered. See state.ts's advanceShoeDiscards for how it accumulates and
  // when it resets.
  shoeDiscards: DiscardEntry[];
  myPlayerTurn?: Turn;
  activeTurnId?: string;
  nextTurnId?: string;
  activeTurnTimer?: { playerId: string; remainingMs: number; percent: number; durationMs: number };
  bankerPlayer?: Player;
  bankInfo?: BankInfo;
  bankIncrement: number;
  bankDisabledReason?: string;
  canBank: boolean;
  waitingInfo?: { count: number; isViewerWaiting: boolean; namesLabel: string; players: WaitingListEntry[] };
  abandonedBanker?: { name: string; since: number; eligibleAt: number; canVoid: boolean; secondsLeft: number };
  firstBetCardIndex?: Record<string, number>;
  latestReactionByPlayer: Record<string, ReactionEvent>;
  onBet: (amount: number, options: { bank: boolean; eleveroon: boolean }) => void;
  onHit: (options: { eleveroon: boolean }) => void;
  onStand: () => void;
  onSkip: (playerId?: string) => void;
  onReact: (emoji: string) => void;
  onTopUp: (amount: number, note?: string) => void;
  onSetWatermark: (text: string) => void;
  roundHistoryCount: number;
  onApproveRename: (playerId: string) => void;
  onRejectRename: (playerId: string) => void;
  onRequestRename: (firstName: string, lastName?: string) => void;
  onApproveBuyIn: (playerId: string) => void;
  onRejectBuyIn: (playerId: string) => void;
  onRequestBuyIn: (amount: number, note?: string) => void;
  onPracticeTopUp: () => void;
  onShowHowTo: () => void;
  onEndRoundDueToBank: () => void;
  onVoidAbandonedRound: () => void;
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
  bankSummaryOpen: boolean;
  bankSummary?: CompletedRoundSummary;
  onDismissBankSummary: () => void;
  musicEnabled: boolean;
  sfxEnabled: boolean;
  onToggleMusic: () => void;
  onToggleSfx: () => void;
  motionEnabled: boolean;
  onToggleMotion: () => void;
  wsStatus: "disconnected" | "connecting" | "connected";
}

export function TableRoot({
  room,
  round,
  playerId,
  isAdmin,
  bankerTurn,
  playerTurns,
  shoeDiscards,
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
  abandonedBanker,
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
  onRequestRename,
  onApproveBuyIn,
  onRejectBuyIn,
  onRequestBuyIn,
  onPracticeTopUp,
  onShowHowTo,
  onEndRoundDueToBank,
  onVoidAbandonedRound,
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
  bankSummaryOpen,
  bankSummary,
  onDismissBankSummary,
  musicEnabled,
  sfxEnabled,
  onToggleMusic,
  onToggleSfx,
  motionEnabled,
  onToggleMotion,
  wsStatus,
}: TableRootProps) {
  const [felt, setFelt] = useFelt(); // applies the viewer's felt color + matching button accents on mount
  const [manageOpen, setManageOpen] = useState(false);
  const [roomInfoOpen, setRoomInfoOpen] = useState(false);
  const [waitingListOpen, setWaitingListOpen] = useState(false);
  const [discardPileOpen, setDiscardPileOpen] = useState(false);
  const { supported: fullscreenSupported, isFullscreen, toggleFullscreen } = useFullscreen();
  // playerTurns.length, not room.players.length: it's exactly the count that
  // feeds seatPositions()/seatScale() below (the dealer never shrinks, see
  // dealDeltaFor's own comment), so computeFit's crowding correction shrinks
  // its reservation by the same amount the seats themselves actually shrink.
  const { wrapRef, dockRef, scale, stageHeight, vf, playTop } = useStageScale(playerTurns.length);
  useWakeLock(true); // the felt table is the only in-room view, so it's mounted for the whole session

  // Shoe-scoped discard tally: earlier rounds' resolved cards (shoeDiscards,
  // folded in by state.ts as each round gets replaced) plus THIS round's own
  // as they resolve live -- discardedEntries() only ever sees the round it's
  // handed, so the live half still has to be computed here every render.
  const discardEntries = useMemo(
    () => [...shoeDiscards, ...discardedEntries(bankerTurn ? [bankerTurn, ...playerTurns] : playerTurns)],
    [shoeDiscards, bankerTurn, playerTurns]
  );

  // Flips true once, right after this table's very first paint. Cards
  // already on the felt at that paint (a fresh join, or a reload mid-round)
  // must NOT animate as if freshly dealt -- see CardView.tsx's pastFirstPaint
  // prop, which each card freezes at its own mount time.
  const [pastFirstPaint, setPastFirstPaint] = useState(false);
  useEffect(() => {
    setPastFirstPaint(true);
  }, []);

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

  const bankLock = round?.bankLock;
  const bankLockStage = bankLock?.stage;
  const bankActor = bankLock ? room.players.find((p) => p.id === bankLock.playerId) : undefined;
  const bankActorName = bankActor ? fullName(bankActor) || bankActor.firstName : "A player";
  const bankBannerText =
    bankLockStage === "banker"
      ? `The bank is playing out ${bankActorName}'s BANK! wager…`
      : `${bankActorName} bets BANK! — $${(bankLock?.exposure ?? 0).toLocaleString()}`;

  // The bank busting is the biggest possible moment for the table -- every
  // player still in the hand wins at once. bankLock always clears well
  // before the round reaches "terminate" (see store.ts's processBankLock),
  // so this and the BANK! banner above never need to compete for the same
  // moment, but the bankLock guard is kept anyway as a defensive belt.
  const bankBusted = Boolean(bankerTurn && !bankLock && statusDisplay(bankerTurn).label === "FUTCHED!");

  // A BANK! wager can empty the bank outright, which parks the round in a
  // "decision" stage until the banker either adds chips or calls it. Nobody
  // can act until they do, so the choice has to be on the felt itself.
  //
  // The server leaves the lock in place even when the same wager also ended
  // the round (a futched bank resolves every remaining hand), so gate on the
  // round still being live -- there's nothing left to decide once the results
  // are already on the table.
  const bankDecisionPending = bankLockStage === "decision" && round?.state !== "terminate";
  const bankerDecisionRequired = Boolean(isAdmin && bankDecisionPending);
  const waitingOnBankDecision = Boolean(!isAdmin && bankDecisionPending);

  // An empty bank stops the whole table -- players see "Bank is empty" on
  // their own bet controls, but the banker is the only one who can fix it and
  // had nothing telling them so. Mirrors the players' own out-of-chips CTA.
  const bankIsEmpty = Boolean(
    isAdmin && bankerPlayer && (room.wallets?.[bankerPlayer.id] ?? 0) === 0 && !bankerDecisionRequired
  );

  // A seated (non-banker, non-spectator) player at exactly $0 can't cover
  // even a $1 bet -- surface a clear, actionable prompt rather than leaving
  // them to discover Table Info's request-chips form on their own. Practice
  // rooms have no human banker to approve a request, so they get an instant
  // self-serve top-up instead (see GameStore.selfTopUpWallet).
  const myWallet = playerId ? room.wallets?.[playerId] : undefined;
  const isSeatedPlayer = Boolean(playerId && room.players.some((p) => p.id === playerId && p.type === "player"));
  const showOutOfChips = Boolean(!isAdmin && isSeatedPlayer && myWallet === 0);
  const myBuyInRequest = playerId ? (room.buyInRequests ?? []).find((r) => r.playerId === playerId) : undefined;

  // Seat the viewer at the bottom edge (standard card-game convention) while
  // preserving cyclic turn order around the table.
  const seatedTurns = useMemo(
    () => orderSeatsForViewer(playerTurns, (t) => t.player.id === playerId),
    [playerTurns, playerId]
  );
  const positions = seatPositions(seatedTurns.length, vf, playTop);
  const seatShrink = seatScale(positions);

  // Origin for the card-deal-in flight animation (see Seat.tsx/Dealer.tsx) --
  // nominal stage-px from the shoe to a given seat, divided by seatShrink so
  // a shrunk seat's cards still travel the true on-screen distance instead of
  // a fraction of it (the seat's own transform: scale() would otherwise
  // shrink the raw offset a second time). The dealer is never shrunk (no
  // scale in Dealer.tsx's own transform), so its own delta skips that
  // division -- dividing it too would over-correct for a scale that was
  // never applied in the first place.
  const shoe = shoePosition(playTop, vf);
  const dealDeltaFor = (position: { x: number; y: number }, scaleFactor: number) => ({
    dx: (shoe.x - position.x) / scaleFactor,
    dy: (shoe.y - position.y) / scaleFactor,
  });
  // Mirrors Dealer.tsx's own anchor: left:640, top:play-top+160px*vf.
  const dealerDealDelta = dealDeltaFor({ x: STAGE_WIDTH / 2, y: playTop + 160 * vf }, 1);

  // Destination for a rejected card's fly-out (CardView.tsx's
  // cardDiscardFly) -- the same maths as dealDeltaFor above, aimed at the
  // discard pile instead of the shoe.
  const discardPile = discardPilePosition(playTop, vf);
  const discardDeltaFor = (position: { x: number; y: number }, scaleFactor: number) => ({
    dx: (discardPile.x - position.x) / scaleFactor,
    dy: (discardPile.y - position.y) / scaleFactor,
  });
  const dealerDiscardDelta = discardDeltaFor({ x: STAGE_WIDTH / 2, y: playTop + 160 * vf }, 1);

  // Chips the bank currently has committed, per seat -- drawn on the felt so
  // a shrinking bet limit has a visible cause (see BankReservations).
  const reservations = useMemo(
    () =>
      seatedTurns
        .map((turn, idx) => ({
          playerId: turn.player.id,
          amount: reservedAgainst(turn),
          position: positions[idx],
        }))
        .filter((r) => r.amount > 0 && r.position),
    [seatedTurns, positions]
  );
  const totalReserved = reservations.reduce((sum, r) => sum + r.amount, 0);

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
  // No round object at all means nothing has been dealt yet -- seats are
  // built from round.turns, so the felt would otherwise be an empty oval
  // while everyone waits on the banker.
  const preRound = !round;
  // A reload between rounds comes back with no round object, so "pre-round"
  // isn't the same as "nothing has been played yet" -- don't call round 5 the
  // first one.
  const firstDeal = (room.completedRounds ?? 0) === 0;
  const rosterPlayers = useMemo(
    () => room.players.filter((p) => p.type !== "spectator"),
    [room.players]
  );

  return (
    <div
      className="k-fit"
      ref={wrapRef}
      style={
        {
          "--stage-scale": scale,
          "--stage-h-px": `${stageHeight}px`,
        } as React.CSSProperties
      }
    >
      <div
        className="felt-table"
        // Whether the in-felt reservation chips are legible depends on how far
        // the stage is scaled down, which is not the same question as how wide
        // the viewport is -- and the CSS breakpoint that used to gate them got
        // it wrong: `(max-height: 440px)` matches a phone in LANDSCAPE, the
        // very orientation the game asks people to play in, so the chips were
        // hidden in both orientations rather than just the unreadable one.
        data-stage={scale < TINY_STAGE_SCALE ? "tiny" : undefined}
        style={
          {
            transform: `scale(${scale})`,
            width: STAGE_WIDTH,
            height: stageHeight,
            "--vf": vf,
            "--hf": spreadFactor(vf),
            "--play-top": `${playTop}px`,
          } as React.CSSProperties
        }
      >
        <div className="k-oval" />
        <div className="k-ring" />

        {/* Decorative branding only -- scales with the table. The interactive
            chrome lives outside the stage (see .k-chrome-top below). */}
        <div className="k-topbar">
          <div className="flex items-end gap-3">
            <span className="relative inline-flex h-9 w-10 items-center justify-center pointer-events-none">
              <img
                src="/11.png"
                alt=""
                aria-hidden="true"
                className="absolute h-9 w-auto -rotate-[24deg] -translate-x-[2px] drop-shadow-sm z-10"
                loading="lazy"
              />
              <img
                src="/12.png"
                alt=""
                aria-hidden="true"
                className="absolute h-9 w-auto rotate-[23deg] translate-x-[16px] drop-shadow-sm"
                loading="lazy"
              />
            </span>
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
            deckCount={round?.deckRemaining ?? 0}
            onOpenStats={onOpenStats}
            roundId={round?.roundId}
            pastFirstPaint={pastFirstPaint}
            dealDx={dealerDealDelta.dx}
            dealDy={dealerDealDelta.dy}
            discardDx={dealerDiscardDelta.dx}
            discardDy={dealerDiscardDelta.dy}
          />
        )}

        {seatedTurns.map((turn, idx) => {
          const seatDelta = positions[idx] ? dealDeltaFor(positions[idx], seatShrink) : { dx: 0, dy: 0 };
          const seatDiscardDelta = positions[idx] ? discardDeltaFor(positions[idx], seatShrink) : { dx: 0, dy: 0 };
          return (
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
              isBankActor={bankLock?.playerId === turn.player.id}
              onSkipOther={isAdmin ? onSkip : undefined}
              onOpenStats={onOpenStats}
              roundId={round?.roundId}
              pastFirstPaint={pastFirstPaint}
              dealOrder={idx}
              dealDx={seatDelta.dx}
              dealDy={seatDelta.dy}
              discardDx={seatDiscardDelta.dx}
              discardDy={seatDiscardDelta.dy}
            />
          );
        })}

        {!roundOver && <BankReservations reservations={reservations} scale={seatShrink} playTop={playTop} vf={vf} />}

        {bankerPlayer && (
          <BankPanel bankerWallet={bankerWallet} reserved={roundOver ? 0 : totalReserved} playTop={playTop} vf={vf} />
        )}

        {round && <DiscardPile entries={discardEntries} onOpen={() => setDiscardPileOpen(true)} />}

      </div>

      {/* ---- Chrome: outside the stage, so NOT scaled. Controls stay at
           true viewport size and remain readable/tappable on a phone. ---- */}
      {/* Pre-round this is the only thing on the felt, and it's the first
          screen a new player sees -- so it lives in the chrome layer rather
          than on the ~0.3x-scaled stage a portrait phone renders. */}
      {preRound && (
        <div className="k-preround">
          <div className="k-preround-title">Table ready</div>
          <div className="k-preround-sub">
            {rosterPlayers.length <= 1
              ? "Waiting for players to take a seat…"
              : `${rosterPlayers.length} at the table`}
          </div>
          <div className="k-preround-roster">
            {rosterPlayers.map((p) => (
              <span key={p.id} className={clsx("k-preround-chip", p.presence !== "online" && "is-offline")}>
                {p.type === "admin" && <Icon name="bank" size={9} />}
                <span className="k-preround-name">
                  {fullName(p) || p.firstName}
                  {p.id === playerId && " (you)"}
                </span>
                <span className="k-preround-amt">${(room.wallets?.[p.id] ?? 0).toLocaleString()}</span>
              </span>
            ))}
          </div>
        </div>
      )}
      {bankLock && (
        <div className="k-bank-banner" role="status" aria-live="polite">
          <Icon name="bank" size={14} />
          <span>{bankBannerText}</span>
        </div>
      )}
      {(bankerDecisionRequired || waitingOnBankDecision) && (
        <div className="k-bank-decision" role="status" aria-live="polite">
          <div className="headline">Bank depleted</div>
          {bankerDecisionRequired ? (
            <>
              <div className="subline">
                {bankActorName}&apos;s BANK! wager emptied the bank. Add chips to play it out, or end the round here.
              </div>
              <div className="flex gap-2">
                <button type="button" className="k-btn bet sm" onClick={() => setManageOpen(true)}>
                  Replenish bank
                </button>
                <button type="button" className="k-btn stand sm" onClick={onEndRoundDueToBank}>
                  End round now
                </button>
              </div>
            </>
          ) : (
            <div className="subline">
              Waiting for the banker to replenish the bank or end the round after {bankActorName}&apos;s BANK! wager.
            </div>
          )}
        </div>
      )}
      <div className="k-chrome-top">
        <FeltSwitcher felt={felt} onChange={setFelt} />
        <button
          type="button"
          className="k-chip-btn"
          onClick={onShowHowTo}
          title="How to play Kvitlach"
          aria-label="How to play Kvitlach"
        >
          ?
        </button>
        <button
          type="button"
          className="k-chip-btn"
          onClick={onToggleMusic}
          aria-pressed={musicEnabled}
          style={!musicEnabled ? { opacity: 0.45 } : undefined}
          title={musicEnabled ? "Mute background music" : "Play background music"}
          aria-label={musicEnabled ? "Mute background music" : "Play background music"}
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
          aria-label={sfxEnabled ? "Mute sound effects" : "Enable sound effects"}
        >
          <Icon name="speaker" size={13} />
        </button>
        <button
          type="button"
          className="k-chip-btn"
          onClick={onToggleMotion}
          aria-pressed={motionEnabled}
          style={!motionEnabled ? { opacity: 0.45 } : undefined}
          title={motionEnabled ? "Turn off card/table animations" : "Turn on card/table animations"}
          aria-label={motionEnabled ? "Turn off card/table animations" : "Turn on card/table animations"}
        >
          <Icon name="motion" size={13} />
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
        {bankIsEmpty && (
          <button
            type="button"
            className="k-tag warn"
            onClick={() => setManageOpen(true)}
            title="Nobody can wager against an empty bank -- add chips to keep the table going."
          >
            Bank is empty — tap to add chips
          </button>
        )}
        {showOutOfChips &&
          (room.practice ? (
            <button
              type="button"
              className="k-tag warn"
              onClick={onPracticeTopUp}
              title="Practice mode -- add play chips instantly, no approval needed."
            >
              Out of chips — tap to add ${PRACTICE_TOPUP_DISPLAY}
            </button>
          ) : (
            <button
              type="button"
              className="k-tag warn"
              onClick={() => setRoomInfoOpen(true)}
              title="Ask the banker for more chips."
            >
              {myBuyInRequest ? "Chip request pending…" : "Out of chips — tap to request more"}
            </button>
          ))}
        {wsStatus !== "connected" && (
          // The only place a viewer's OWN connection state was visible used
          // to be the lobby footer -- which this view replaces entirely (see
          // App.tsx's room ? <TableRoot/> : <lobby+footer/> branch), so once
          // seated there was no signal at all that a lost/reconnecting socket
          // was why Bet/Hit/Deal had gone quiet. Reusing the footer's own
          // wording here rather than inventing new copy.
          <span
            className={clsx("k-tag", wsStatus === "disconnected" ? "warn" : "muted")}
            role="status"
            aria-live="polite"
            title="Your connection to the table"
          >
            {wsStatus === "disconnected" ? "Connection lost — reconnecting…" : "Connecting…"}
          </span>
        )}
        {waitingInfo && (
          <button
            type="button"
            className="k-tag muted"
            onClick={() => setWaitingListOpen(true)}
            title={`${waitingInfo.namesLabel} will join after this round ends -- tap to see the full list.`}
          >
            {waitingInfo.isViewerWaiting
              ? waitingInfo.count > 1
                ? `You + ${waitingInfo.count - 1} queued`
                : "You're queued — next round"
              : `${waitingInfo.count} queued for next round`}
          </button>
        )}
        <button
          type="button"
          className="k-room"
          onClick={() => setRoomInfoOpen(true)}
          title="Table info and sharing"
        >
          {room.name || room.roomId}
        </button>
        <button type="button" className="k-chip-btn" onClick={onLeave} title="Leave this game and return to the join screen">
          <Icon name="door" size={13} />
          Leave
        </button>
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

      <div className="k-controls" ref={dockRef}>
      {/* The banker has dropped and the table is waiting on them. Nothing else
          can move this round: the banker is the dealer, not a seat, so no turn
          timer covers them, and every other action is theirs to take. Rather
          than settle on the half-played hand they left behind -- letting a
          dead phone decide who won money -- any player can throw the round
          away and get every wager back. */}
      {abandonedBanker && !roundOver && (
        <div className="k-dock">
          <span className="k-tag muted">{abandonedBanker.name} has dropped out.</span>
          {abandonedBanker.canVoid ? (
            <button
              type="button"
              className="k-btn stand sm"
              onClick={onVoidAbandonedRound}
              title="End this round with no winners or losers -- every wager is returned"
            >
              Void the round, refund all bets
            </button>
          ) : (
            <span className="k-tag muted k-pulse-attn">
              Waiting {abandonedBanker.secondsLeft}s for them to reconnect…
            </span>
          )}
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

      {(roundOver || preRound) && (
        <div className="k-dock">
          {/* A busted banker always terminates the round (getGameState: the
              banker acts last, so their turn resolving leaves nothing
              pending), so this dock is guaranteed to be on screen whenever
              bankBusted is true -- which is what lets the celebration live
              here instead of floating over the felt. It replaces the
              "Round complete" label rather than joining it, so the dock
              gains no extra row on a phone. */}
          {bankBusted ? (
            <span className="k-futch-flash" role="status" aria-live="polite">
              <Icon name="bank" size={15} />
              <b>THE BANK FUTCHED!</b>
              <span>everyone still in the hand wins</span>
            </span>
          ) : (
            <span className="k-banktotal">{preRound ? "Table ready" : "Round complete"}</span>
          )}
          {/* A practice room's banker is a bot, so isAdmin never fires for its one
              human -- they used to just get outrun by a fixed 4s auto-restart
              timer instead, which cut into reading the round they just played.
              room.practice hands them this exact button (there is only ever
              one human at that table, so it can't reach anyone else's game),
              same as a real banker choosing their own moment. */}
          {isAdmin || room.practice ? (
            <button type="button" className="k-btn bet k-pulse-attn" onClick={onStartNextRound}>
              {!preRound ? "Start next round" : firstDeal ? "Deal the first round" : "Deal the next round"}
            </button>
          ) : (
            <span className="k-tag muted k-pulse-attn">
              Waiting for the banker to {preRound ? "deal" : "start the next round"}…
            </span>
          )}
        </div>
      )}
        <div className="k-chrome-react">
          <ReactionLayer onReact={onReact} disabled={!room.players.some((p) => p.id === playerId)} />
        </div>
      </div>

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
          roundActive={!roundOver && !preRound}
          onReshuffleDeck={onReshuffleDeck}
        />
      )}

      {statsData && <StatsModal data={statsData} onClose={onCloseStats} />}

      {discardPileOpen && <DiscardPileModal entries={discardEntries} onClose={() => setDiscardPileOpen(false)} />}

      {bankSummaryOpen && <BankSummaryModal summary={bankSummary} onClose={onDismissBankSummary} />}

      <RoomInfoDrawer
        open={roomInfoOpen}
        onClose={() => setRoomInfoOpen(false)}
        roomName={room.name}
        roomId={room.roomId}
        roomPassword={room.password}
        buyIn={room.buyIn}
        isAdmin={isAdmin}
        playerId={playerId}
        renameRequests={room.renameRequests ?? []}
        buyInRequests={room.buyInRequests ?? []}
        onRequestRename={onRequestRename}
        onRequestBuyIn={onRequestBuyIn}
      />

      {waitingInfo && (
        <WaitingListDrawer
          open={waitingListOpen}
          onClose={() => setWaitingListOpen(false)}
          players={waitingInfo.players}
        />
      )}
    </div>
  );
}
