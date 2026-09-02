import { useEffect, useMemo, useRef, useState } from "react";
import { cardImages } from "./selectors";
import { clsx } from "clsx";
import { Player, ReactionEvent, RoomState, RoundState, Turn } from "../types";
import { UINotification } from "../state";
import { useChip, useFelt } from "../theme";
import { dealerClearanceScale, discardPilePosition, orderSeatsForViewer, orderTurnsBySeat, seatPositions, seatScale, shoePosition, spreadFactor, STAGE_WIDTH, viewerHandScale } from "./layout";
import { fullName, statusDisplay, reservedAgainst } from "./selectors";
import { useStageScale } from "./stage";
import { usePinchZoom } from "./pinchZoom";
import { useMediaQuery } from "../useMediaQuery";
import { installNudgeDue, snoozeInstallNudge, useInstallPrompt } from "../pwa";
import { Seat } from "./Seat";
import { Dealer } from "./Dealer";
import { PlayerDock } from "./PlayerDock";
import { BankPanel } from "./BankPanel";
import { BankReservations } from "./BankReservations";
import { ViewerHud } from "./ViewerHud";
import { ReactionLayer } from "./ReactionLayer";
import { ChromeMenu } from "./ChromeMenu";
import { AppearanceMenu } from "./AppearanceMenu";
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
import { StageOverlay } from "./StageOverlay";
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
  /** An operator who arrived by an admin-panel Watch link: subscribed to the
   *  room's broadcasts with no seat, no wallet and no Player record. Not the
   *  same as a spectator, who is seated and visible. */
  watching?: boolean;
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
  /** Pass a player id for a personal copy, nothing for the whole table. */
  onExportHistory: (focusPlayerId?: string) => void;
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
  watching = false,
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
  const [chip, setChip] = useChip(); // applies the viewer's .k-chip-btn accent color on mount
  const [manageOpen, setManageOpen] = useState(false);
  const [roomInfoOpen, setRoomInfoOpen] = useState(false);
  // Which self-service form the drawer should open on, if any -- see
  // RoomInfoDrawer's `focus`. Undefined means "just the drawer".
  const [roomInfoFocus, setRoomInfoFocus] = useState<"rename" | "chips" | undefined>();
  const openRoomInfo = (section?: "rename" | "chips") => {
    setRoomInfoFocus(section);
    setRoomInfoOpen(true);
  };
  const [waitingListOpen, setWaitingListOpen] = useState(false);
  const [discardPileOpen, setDiscardPileOpen] = useState(false);
  const { supported: fullscreenSupported, isFullscreen, toggleFullscreen } = useFullscreen();
  const { canInstall, promptInstall } = useInstallPrompt();
  // Two-finger zoom, applied on top of the fit-to-viewport scale rather than
  // instead of it -- see pinchZoom.ts. feltRef is only ever written to by that
  // hook (CSS custom properties, no React state per frame).
  const feltRef = useRef<HTMLDivElement>(null);
  // playerTurns.length, not room.players.length: it's exactly the count that
  // feeds seatPositions()/seatScale() below (the dealer never shrinks, see
  // dealDeltaFor's own comment), so computeFit's crowding correction shrinks
  // its reservation by the same amount the seats themselves actually shrink.
  const { wrapRef, dockRef, scale, stageHeight, vf, playTop, compact } = useStageScale(playerTurns.length);
  const { zoomed, reset: resetZoom } = usePinchZoom(wrapRef, feltRef, scale);
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

  // Must stay identical to index.css's own .k-rotate-hint rule. That banner
  // is position:fixed at the top-centre of the screen, and both one-time
  // nudges below hang off chrome-top in the very same strip -- on a fresh
  // portrait-phone visit all three rendered at once, overlapping each other
  // and the controls row (measured: 62x33px and 185x30px of overlap at
  // 375x812). Someone holding a phone upright should be told to turn it
  // before being offered anything cosmetic, so the rotate banner wins the
  // space outright and the other two wait until it's gone.
  // PREDICATE 2 OF 3. Owns exactly one question: "is this viewport too small to
  // render the table in portrait at all?" Measures the rendered VIEWPORT (in
  // portrait, width IS the short edge), not the device -- that's isHandheld()
  // in immersive.ts, predicate 1, which matches a 768px portrait tablet and so
  // must never be substituted here. 540 is the number that keeps that tablet
  // playing; it must not become 820. See docs/mobile-ui.md Part 4.
  //
  // This string is duplicated in index.css's .k-rotate-hint rule (line 1633)
  // with nothing enforcing the match -- the same silent-drift failure mode as
  // the measured constants that used to be in BankPanel.tsx.
  //
  // The fix is still owed: move it to a module owning both query strings and
  // delete the CSS rule outright, so there is nothing left to drift from. That
  // was written here as "step 4 of the refactor" and never done, and the design
  // doc then described it in the present tense for months. Until it exists,
  // grep for the literal before changing either copy.
  const rotateHintShowing = useMediaQuery("(orientation: portrait) and (max-width: 540px)");

  // The felt/chip swatches are the only chrome-top controls that carry no
  // shape-based icon of their own -- everything else there (music note,
  // speaker, expand arrows) suggests its function at a glance; a bare color
  // dot doesn't. Button titles cover desktop hover, but there's no hover on
  // a touchscreen at all, so give mobile visitors the same one-time nudge
  // pattern as the fullscreen hint below instead of leaving them to guess.
  const THEME_HINT_KEY = "kvitlach.themeHintSeen";
  const [showThemeHint, setShowThemeHint] = useState(() => {
    if (typeof window === "undefined" || !window.localStorage) return false;
    try {
      return window.localStorage.getItem(THEME_HINT_KEY) !== "1";
    } catch {
      return false;
    }
  });
  const dismissThemeHint = () => {
    setShowThemeHint(false);
    if (typeof window === "undefined" || !window.localStorage) return;
    try {
      window.localStorage.setItem(THEME_HINT_KEY, "1");
    } catch {
      /* ignore -- the hint just reappears next visit, not worth failing over */
    }
  };

  // iOS Safari can't enter fullscreen at all (fullscreenSupported is always
  // false there) -- the only real chrome-free path on an iPhone is adding the
  // page to the home screen, so give those visitors a different, one-time
  // nudge toward that instead of just silently having no fullscreen control.
  // Shares its snooze with the lobby banner (InstallPrompt.tsx) on purpose:
  // the two say the same thing from different places, and someone who has
  // declined one should not meet the other. Dismissal is a snooze with a
  // backoff rather than a permanent silence -- see pwa.ts.
  const IOS_HINT_KEY = "kvitlach.iosInstallHintSeen";
  const [showIOSInstallHint, setShowIOSInstallHint] = useState(
    () => isIOS() && !isStandaloneDisplay() && installNudgeDue(IOS_HINT_KEY)
  );
  const dismissIOSInstallHint = () => {
    setShowIOSInstallHint(false);
    snoozeInstallNudge(IOS_HINT_KEY);
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

  // The shoe has run dry. Nothing can be dealt and nothing can be drawn, so
  // the table simply stops -- and until now it stopped SILENTLY: the reshuffle
  // lives behind Manage -> Deck -> confirm for a real banker, and behind the
  // collapsed chrome menu in a practice room. Reported twice, from both sides:
  // a banker having to go looking for the button, and a solo player against the
  // computer with no idea why the game had stopped at all.
  //
  // Deliberately the same shape as the bank-depleted prompt above, because it
  // is the same situation: a blocking condition only one person can clear, so
  // the choice belongs on the felt rather than in a drawer. Whoever cannot
  // clear it gets told what is being waited on, for the same reason.
  //
  // `?? 1` so an absent round never reads as an empty shoe -- deckRemaining is
  // undefined before the first deal, and a prompt on the lobby-side of a fresh
  // table would be nonsense.
  const shoeEmpty = (round?.deckRemaining ?? 1) === 0;
  // Mirrors the server's own allowance (store.ts reshuffleDeck): the banker,
  // or the single human in a practice room, whose banker is a bot with no
  // session to authenticate as.
  const canReshuffle = isAdmin || room.practice === true;
  // One centred prompt at a time -- they share a position, and an empty bank
  // is the more urgent of the two because it is the one with money on it.
  const shoeDecisionPending = shoeEmpty && !bankDecisionPending;
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

  // Seat order is NOT turn order -- see layout.ts's orderTurnsBySeat for why
  // deriving one from the other made players visibly change chairs each round.
  const seatOrderedTurns = useMemo(
    () => orderTurnsBySeat(playerTurns, room.players, (t) => t.player.id),
    [playerTurns, room.players]
  );

  // Seat the viewer at the bottom edge (standard card-game convention).
  const seatedTurns = useMemo(
    () => orderSeatsForViewer(seatOrderedTurns, (t) => t.player.id === playerId),
    [seatOrderedTurns, playerId]
  );
  const positions = seatPositions(seatedTurns.length, vf, playTop);
  // Two independent collision rules, and the tighter one wins: seats against
  // each other (crowding, binds on a full table) and seats against the dealer
  // (binds on a short viewport, where vf has already bottomed out). The
  // second was missing entirely and is what made phone landscape unplayable.
  // Two independent collision rules, and the tighter one wins: seats against
  // each other (crowding, binds on a full table) and seats against the dealer
  // (binds on a short viewport, where vf has already bottomed out). The
  // second was missing entirely and is what made phone landscape unplayable.
  // The lowest point any seat is placed at -- layout.ts puts the viewer's
  // own seat exactly there (angle 180). Compared with a tolerance because the
  // ellipse yields floats.
  const bottomSeatY = Math.max(...positions.map((p) => p.y), 0) - 1;
  const seatShrink = Math.min(
    seatScale(positions),
    dealerClearanceScale(positions, playTop + 160 * vf)
  );

  // The viewer's own hand opts out of seatShrink, because seatShrink is about
  // nameplates and their seat has not rendered one since step 1 moved their
  // identity into the HUD. layout.ts viewerHandScale() carries the reasoning
  // and the measurements; -1 (viewer not seated -- spectating, or the banker,
  // who is not on the arc at all) simply means nobody's hand is exempt.
  const viewerSeatIndex = seatedTurns.findIndex((t) => t.player.id === playerId);
  const viewerHand =
    viewerSeatIndex >= 0 ? viewerHandScale(positions, viewerSeatIndex, seatShrink) : seatShrink;

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

  // The top chrome's controls, defined ONCE. On a landscape phone they render
  // inside ChromeMenu's panel; anywhere else, inline in the row. Same nodes,
  // same handlers, same order -- the only difference is what wraps them. This
  // was briefly written out in both arms of the ternary below, which is 131
  // lines of JSX kept in sync by hand and exactly the drift ChromeMenu takes
  // `children` to avoid.
  //
  // A fragment rather than an array: these are heterogeneous one-off controls,
  // not a list, so there is no honest key for each and no reordering to track.
  // ONE list, rendered inline in the chrome row on a desktop and inside the
  // ChromeMenu popover on a phone -- two renderings of one list is how they
  // drift. What differs between the two is presentation only, and it is CSS
  // that differs it: .k-ctl-label is hidden in the row (there is no space for
  // words, and hover titles carry it there) and shown in the popover (there is
  // space, and a column of unlabelled icons is not a menu).
  //
  // Reported by a tester: "the mobile menu for players is not intuitive on how
  // to request chips and name changes and change felt colours -- things are a
  // bit too nested". They were. Chips and name changes lived two levels down
  // behind a button whose only label was the room's NAME, and the felt colours
  // lived behind an unlabelled swatch icon inside an unlabelled "..." icon.
  const chromeControls = (
    <>
      <span className="relative inline-flex items-center gap-1">
        <AppearanceMenu
          felt={felt}
          chip={chip}
          // Inside the popover the swatches show as rows rather than behind
          // another button -- a menu opening a menu to reach a colour.
          inline={compact}
          onFeltChange={(name) => {
            setFelt(name);
            dismissThemeHint();
          }}
          onChipChange={(name) => {
            setChip(name);
            dismissThemeHint();
          }}
        />
        {/* The hint exists to say "the colours are behind this button". In the
            phone menu they are not behind anything any more -- they are the
            first two rows -- so it would be pointing at itself, and it was
            landing on top of the swatches while doing it. */}
        {showThemeHint && !compact && !rotateHintShowing && !showFullscreenHint && (
          <div className="k-fs-hint k-fs-hint--left">
            Table colors live here -- change your felt or chips, just for your view.
            <button type="button" onClick={dismissThemeHint}>
              Got it
            </button>
          </div>
        )}
      </span>
      <button
        type="button"
        className="k-chip-btn"
        onClick={onShowHowTo}
        title="How to play Kvitlach"
        aria-label="How to play Kvitlach"
      >
        ?
        <span className="k-ctl-label">How to play</span>
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
        <span className="k-ctl-label">Music {musicEnabled ? "on" : "off"}</span>
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
        <span className="k-ctl-label">Sound {sfxEnabled ? "on" : "off"}</span>
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
        <span className="k-ctl-label">Animations {motionEnabled ? "on" : "off"}</span>
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
            <span className="k-ctl-label">{isFullscreen ? "Exit fullscreen" : "Fullscreen"}</span>
          </button>
          {showFullscreenHint && !isFullscreen && !rotateHintShowing && (
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
      {/* Real bankers reach reshuffle through Manage -> Deck. A practice
          room's banker is a bot with no session (see store.ts's
          reshuffleDeck comment), so the ManageDrawer above stays isAdmin-
          gated and out of reach -- this gives the one human at a practice
          table the same direct, no-confirmation access onPracticeTopUp
          already gets, rather than exposing the entire admin drawer
          (kick/rename/close-room) just to reach one control. */}
      {room.practice && (
        <button
          type="button"
          className="k-chip-btn"
          onClick={onReshuffleDeck}
          title="Practice mode -- reshuffle the shoe instantly, no confirmation needed."
          aria-label="Reshuffle deck"
        >
          <Icon name="shuffle" size={13} />
          Reshuffle
        </button>
      )}
      {/* The two things a player actually needs mid-game, named. Both open the
          same drawer these already lived in -- the forms and the pending-
          request state are there and belong together -- but they now say
          which one they want instead of hiding behind the room's name.
          Banker-side equivalents live in Manage, hence !isAdmin. */}
      {!isAdmin && (
        <>
          <button
            type="button"
            className="k-chip-btn k-ctl-primary"
            onClick={() => openRoomInfo("chips")}
            title="Ask the banker for more chips"
          >
            <Icon name="coins" size={13} />
            <span className="k-ctl-label">Ask for chips</span>
          </button>
          <button
            type="button"
            className="k-chip-btn k-ctl-primary"
            onClick={() => openRoomInfo("rename")}
            title="Request a name change"
          >
            <Icon name="pencil" size={13} />
            <span className="k-ctl-label">Change my name</span>
          </button>
        </>
      )}
      {/* Only when the browser has actually offered one. Chrome fires
          beforeinstallprompt once and will not re-fire it, so pwa.ts parks the
          event at module scope and this row appears the moment it arrives --
          the lobby banner (InstallPrompt.tsx) is unreachable from in here, and
          a player who joined by tapping an invite link has never seen it. */}
      {canInstall && (
        <button
          type="button"
          className="k-chip-btn k-ctl-last"
          onClick={() => void promptInstall()}
          title="Install Kvitlach as an app"
        >
          <Icon name="share" size={13} />
          <span className="k-ctl-label">Install as an app</span>
        </button>
      )}
      <button
        type="button"
        className="k-room"
        onClick={() => openRoomInfo()}
        title="Table info and sharing"
      >
        <span className="k-room-name">{room.name || room.roomId}</span>
        <span className="k-ctl-label">Table info &amp; invite</span>
      </button>
    </>
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
      {/* Pure-CSS (see .k-rotate-hint) -- only .k-fit's own presence gates
          this to the table view; orientation/width gate it to a portrait
          phone. No JS orientation state to keep in sync, no dismiss button
          to wire up. */}
      <StageOverlay>
        <div className="k-rotate-hint">
          <Icon name="rotate" size={16} />
          Turn your phone sideways for the full table
        </div>
      </StageOverlay>
      <div
        ref={feltRef}
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
            // --user-zoom and --pan-x/y are the pinch gesture's, defaulted
            // here so the felt renders identically when nothing has touched
            // them. Multiplied, not replaced: `scale` is the size at which the
            // whole table fits, and is the floor a reset returns to.
            transform: `translate(var(--pan-x, 0px), var(--pan-y, 0px)) scale(calc(${scale} * var(--user-zoom, 1)))`,
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
                src={cardImages["11"]}
                alt=""
                aria-hidden="true"
                className="absolute h-9 w-auto -rotate-[24deg] -translate-x-[2px] drop-shadow-sm z-10"
                loading="lazy"
              />
              <img
                src={cardImages["12"]}
                alt=""
                aria-hidden="true"
                className="absolute h-9 w-auto rotate-[23deg] translate-x-[16px] drop-shadow-sm"
                loading="lazy"
              />
            </span>
            <span className="k-logo-word">Kvitlach</span>
            <span className="k-logo-tag">Ah Heimishe Chanukah Shpil</span>
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
            bankerWallet={bankerWallet}
            reserved={roundOver ? 0 : totalReserved}
            reactionEmoji={bankerTurn ? latestReactionByPlayer[bankerTurn.player.id]?.emoji : undefined}
          />
        )}

        {seatedTurns.map((turn, idx) => {
          // Divide by the scale the CARDS render at, not the seat's: these
          // offsets live on .k-hand, which no longer shares the seat's
          // transform for the viewer (see viewerHand above). Using seatShrink
          // here would leave their cards flying in from short of the shoe.
          const handAt = idx === viewerSeatIndex ? viewerHand : seatShrink;
          const seatDelta = positions[idx] ? dealDeltaFor(positions[idx], handAt) : { dx: 0, dy: 0 };
          const seatDiscardDelta = positions[idx] ? discardDeltaFor(positions[idx], handAt) : { dx: 0, dy: 0 };
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
              handScale={handAt}
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
              // Only the bottom-centre seat -- the viewer's own -- has the
              // dealer's row directly above it. Derived from the rendered
              // position rather than "is this me", because it is a fact about
              // WHERE the seat sits, and an 11-player arc puts other seats low
              // too; those still have empty felt above them.
              // Always to the side now, not just for the crowded bottom row.
              // The condition used to be "is the space above this seat somebody
              // else's" -- true only for the centre column, where a bubble rose
              // onto the banker's total. That space is now the seat's OWN: the
              // reserved chip sits above it and the timer row above the plate,
              // so a bubble anchored above any seat lands on one of them. The
              // overlap spec caught exactly that the first time it ran with
              // k-resv in its CHECKED set -- k-reaction X k-resv, 51%, at
              // 854x384 -- which is the collision this prop already existed to
              // prevent, generalised to every seat because the cause now is.
              sideReaction
              // "Is this me", not "is this the bottom seat": this is about whose
              // information it is, not where the seat sits. The viewer's plate,
              // total and status render in the bottom-left HUD instead; their
              // cards stay on the felt.
              identityInHud={turn.player.id === playerId}
            />
          );
        })}

        {!roundOver && (
          <BankReservations reservations={reservations} viewerId={playerId} scale={seatShrink} playTop={playTop} vf={vf} />
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
      {shoeDecisionPending && (
        <div className="k-bank-decision" role="status" aria-live="polite">
          <div className="headline">The shoe is empty</div>
          {canReshuffle ? (
            <>
              <div className="subline">
                There are no cards left to deal. Shuffle a fresh shoe to keep the table going.
              </div>
              <div className="flex gap-2">
                {/* No confirmation step. The drawer's Reshuffle asks first,
                    which is right when someone reaches for it mid-shoe and
                    might be discarding a known count -- there is nothing to
                    discard here, and an "are you sure" on the only available
                    action is just another tap between a stuck table and a
                    playable one. */}
                <button type="button" className="k-btn bet sm" onClick={onReshuffleDeck}>
                  Shuffle a fresh shoe
                </button>
              </div>
            </>
          ) : (
            <div className="subline">
              Waiting for the banker to shuffle a fresh shoe.
            </div>
          )}
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
      {/* ONE row, and it must stay one row. `flex-wrap: wrap` with nothing
          reserved below it meant every wrapped line landed lower over the
          felt -- at 640x360 Reshuffle / Practice Table / Leave sat on the
          dealer's plate and a seat (ledger #2). stage.ts budgets exactly one
          row for this (TOP_CHROME_PX); the row just never honoured it.

          On a landscape phone -- which is every phone here, since the table
          locks landscape -- the controls nobody touches mid-hand collapse
          behind one button. What stays inline is what you must see or reach
          without thinking: warnings, and Leave. The room name goes in the
          menu because tapping it opens a drawer, not because it is unimportant.

          The SAME JSX renders inline on a desktop and inside the panel on a
          phone -- see ChromeMenu, which takes children for exactly this
          reason. Two renderings of one list is how they drift. */}
      <div className="k-chrome-top">
        {compact ? <ChromeMenu>{chromeControls}</ChromeMenu> : chromeControls}
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
        <button type="button" className="k-chip-btn" onClick={onLeave} title="Leave this game and return to the join screen">
          <Icon name="door" size={13} />
          Leave
        </button>
      </div>

      {/* The bottom band: the viewer's own HUD column, then the controls tray,
          in ONE bottom-anchored flow column. Nothing here knows anything else's
          height -- the HUD used to clear the dock by a hardcoded 84px
          `--controls-band`, which is a guessed sibling height (rule 2) and was
          under the dock's tallest measured state. See docs/mobile-ui.md Part 2
          rule 2 and .k-bottom-band. */}
      <div className="k-bottom-band">
        {/* Both bottom corners on one row. The persistent readout keeps the
            left; transient toasts take the right, which was empty felt.
            They used to share the left column, so every announcement pushed
            the one panel a player checks mid-hand up the screen and then
            dropped it again -- reported by a tester, who was also the one who
            pointed out the other corner was going spare. */}
        <div className="k-hud-row">
          <div className="k-hud-bottom-right">
            {/* The only way back to the fitted view. A gesture that can be
                entered but not left is a trap, and "pinch back out to exactly
                1.00" is not something anyone manages on a phone -- the
                zoomed-in table is missing the seats you would need to see to
                know you had. */}
            {zoomed && (
              <button type="button" className="k-chip-btn k-zoom-reset" onClick={resetZoom}>
                <Icon name="compress" size={13} />
                Reset zoom
              </button>
            )}
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
          </div>
        </div>

        <div className="k-controls" ref={dockRef}>
        {/* One box holding the dock, so the readout below can be anchored to
            the DOCK's own left edge rather than to the viewport's. .k-controls
            is full-width and centres this stack; the stack's width is its
            content, so `left: 0` on the readout is the same x the dock starts
            at, at every viewport, with nothing measured. */}
        <div className="k-dock-stack">
          {/* The viewer's own readout, out of flow (position: absolute) so it
              cannot widen the stack it is aligning itself to. */}
          {myPlayerTurn && (
            <ViewerHud
              turn={myPlayerTurn}
              viewerId={playerId}
              roundState={round?.state}
              walletAmount={myWallet}
              // Flat 1 now, not max(1, scale). It used to counter-scale against
              // the stage because it sat alone in a corner outside it, where a
              // flat 12px read as tiny beside a felt rendering everything a
              // third bigger. It now sits directly on top of the dock, which is
              // flat-px chrome, so it takes the dock's treatment -- and a
              // counter-scale here would be actively harmful: at --stage-scale 2
              // a 169px readout becomes 338px and reaches from the dock's left
              // edge into the viewer's own cards.
              hostScale={1}
            />
          )}
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
            {/* A watcher must fall through both branches. room.practice hands
                its button to "the one human here", which is true of a player at
                a practice table and false of an operator watching one -- they
                would have been able to deal a hand into someone else's game. */}
            {watching ? (
              <span className="k-tag muted">Watching &middot; the table can&rsquo;t see you</span>
            ) : isAdmin || room.practice ? (
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
        focus={roomInfoFocus}
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
        onExportHistory={onExportHistory}
        completedRounds={roundHistoryCount}
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
