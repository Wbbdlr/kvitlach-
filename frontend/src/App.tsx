import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { clsx } from "clsx";
import { useGameStore, loadLastRoomId } from "./state";
import { Player, RoundState } from "./types";
import { AudioManager } from "./audio";
import { buzz } from "./table/haptics";

import { enterImmersive, exitImmersive } from "./table/immersive";
import { buildHistoryText, downloadText, historyFilename } from "./exportHistory";
import { bestTotal, isPushTurn, statusDisplay } from "./table/selectors";
import { useTableData } from "./table/useTableData";
import { TableRoot } from "./table/TableRoot";
import { RulesModals } from "./RulesModals";
import InstallPrompt from "./InstallPrompt";
import SiteHeader from "./SiteHeader";
import SiteFooter from "./SiteFooter";

export default function App() {
  const store = useGameStore();
  const {
    room,
    round,
    balances,
    playerId,
    message,
    status,
    roundHistory,
    notifications,
    bankerSummaryAt,
    reactions,
  } = store;
  const [statsPlayerId, setStatsPlayerId] = useState<string | undefined>(undefined);
  const [bankerFirstName, setBankerFirst] = useState("");
  const [bankerLastName, setBankerLast] = useState("");
  const [joinFirstName, setJoinFirst] = useState("");
  const [joinLastName, setJoinLast] = useState("");
  const [practiceBotCount, setPracticeBotCount] = useState(2);
  const [practiceFirstName, setPracticeFirst] = useState("");
  const [practiceDecks, setPracticeDecks] = useState(4);
  const [practiceBuyIn, setPracticeBuyIn] = useState(100);
  const [practiceBankBuyIn, setPracticeBankBuyIn] = useState(400);
  const [practiceBankBuyInManuallySet, setPracticeBankBuyInManuallySet] = useState(false);
  const [practiceExpanded, setPracticeExpanded] = useState(false);
  const [roomIdInput, setRoomId] = useState("");
  const [roomName, setRoomName] = useState("");
  const [customRoomId, setCustomRoomId] = useState("");
  const [roomPassword, setRoomPassword] = useState("");
  const [joinPassword, setJoinPassword] = useState("");
  const [buyIn, setBuyIn] = useState(100);
  const [bankerBankroll, setBankerBankroll] = useState(100);
  const [bankerBankrollManuallySet, setBankerBankrollManuallySet] = useState(false);
  const [preferredDecks, setPreferredDecks] = useState<string>("");
  const [showHowTo, setShowHowTo] = useState(false);
  const [showWhatIs, setShowWhatIs] = useState(false);
  const [bankerFormExpanded, setBankerFormExpanded] = useState(false);
  const [buyInAmount, setBuyInAmount] = useState("");
  const [firstBetCardIndex, setFirstBetCardIndex] = useState<Record<string, number>>({});
  const [nowTs, setNowTs] = useState(() => Date.now());
  const [musicEnabled, setMusicEnabled] = useState(false);
  const [sfxEnabled, setSfxEnabled] = useState(true);
  const [motionEnabled, setMotionEnabled] = useState(true);
  const [userInteracted, setUserInteracted] = useState(false);
  const audioManager = useMemo(() => new AudioManager(), []);
  const prevRoundRef = useRef<RoundState | undefined>(undefined);
  const prevActiveTurnIdRef = useRef<string | undefined>(undefined);
  const prefilledRoomIdRef = useRef(false);
  const formErrors = store.formErrors ?? {};
  const accessCodeRequired = store.accessCodeRequired;
  const accessCode = store.accessCode;
  const setAccessCode = store.setAccessCode;
  const dismissNotification = store.dismissNotification;
  const dismissBankerSummary = store.dismissBankerSummary;
  const sendReaction = store.sendReaction;

  // Normalize turns early so hooks below can safely depend on this array.
  const turns = round?.turns?.filter(Boolean) ?? [];
  const {
    latestReactionByPlayer,
    activeTurnId,
    nextTurnId,
    activeTurnTimer,
    bankerPlayer,
    bankInfo,
    bankIncrement,
    bankDisabledReason,
    statsData,
    waitingInfo,
    abandonedBanker,
  } = useTableData({ room, round, playerId, reactions, nowTs, statsPlayerId, roundHistory });

  useEffect(() => {
    if (prefilledRoomIdRef.current) return;
    if (typeof window === "undefined") return;
    // /table/:roomId (a stale bookmark/link to a room we're not actually
    // seated in -- state.ts's onOpen handler folds this back into ?room=
    // once the WS connects, but that's contingent on the connection
    // succeeding; this covers the same case immediately on mount, and is
    // the only path for a room id that's already stale by the time this
    // runs) is treated exactly like an invite link's ?room= hint here.
    const fromPath = window.location.pathname.match(/^\/table\/([^/]+)\/?$/)?.[1];
    const params = new URLSearchParams(window.location.search);
    const fromQuery = fromPath ? decodeURIComponent(fromPath) : params.get("room");
    if (fromQuery) {
      setRoomId(fromQuery);
      prefilledRoomIdRef.current = true;
      return;
    }
    const lastRoom = loadLastRoomId();
    if (lastRoom) {
      setRoomId(lastRoom);
      prefilledRoomIdRef.current = true;
    }
  }, []);

  useEffect(() => {
    if (formErrors.create) setBankerFormExpanded(true);
  }, [formErrors.create]);

  useEffect(() => {
    const markInteraction = () => {
      if (!userInteracted) setUserInteracted(true);
      audioManager.noteInteraction();
    };
    const handlePointerDown = (event: PointerEvent) => {
      markInteraction();
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable], [role='textbox']")) return;
      const active = document.activeElement as HTMLElement | null;
      if (active && active.blur && active !== document.body && active.matches("input, textarea, select")) {
        active.blur();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [audioManager, userInteracted]);

  useEffect(() => {
    // Reset bet tracking and collapse other-players view when the round changes
    setFirstBetCardIndex({});
  }, [round?.roundId]);

  useEffect(() => {
    // Record the index of the first card drawn with a wager so we can keep earlier Blatt cards visible to others.
    if (!round) return;
    const next: Record<string, number> = { ...firstBetCardIndex };
    let changed = false;
    turns.forEach((t) => {
      if ((t.bet ?? 0) > 0 && next[t.player.id] === undefined && t.cards.length > 0) {
        next[t.player.id] = Math.max(1, t.cards.length - 1);
        changed = true;
      }
    });
    if (changed) setFirstBetCardIndex(next);
  }, [turns, round, firstBetCardIndex]);

  useEffect(() => {
    // Keep manager flags in sync with UI toggles.
    audioManager.setSfxEnabled(sfxEnabled);
  }, [audioManager, sfxEnabled]);

  useEffect(() => {
    audioManager.setMusicEnabled(musicEnabled && userInteracted);
    return () => audioManager.setMusicEnabled(false);
  }, [audioManager, musicEnabled, userInteracted]);

  // A single root class, not a per-animation flag: index.css's .motion-off
  // rule blanket-kills every animation/transition site-wide, present and
  // future, rather than requiring each new animation to remember to opt in
  // (exactly the kind of per-path drift that let the Eleveroon bug ship --
  // see round.ts's applyEleveroonRule comment). Independent of the OS's
  // prefers-reduced-motion, which the deal animation deliberately no longer
  // defers to (see index.css's .k-card-in comment) -- this is the explicit,
  // in-game way to turn everything off regardless of that system setting.
  useEffect(() => {
    document.documentElement.classList.toggle("motion-off", !motionEnabled);
    return () => document.documentElement.classList.remove("motion-off");
  }, [motionEnabled]);

  useEffect(() => {
    if (!round) {
      prevRoundRef.current = undefined;
      return;
    }
    const prev = prevRoundRef.current;

    // Mirrors state.ts's deckReshuffleNotification diff exactly (same field,
    // same "only on an actual change" semantics) -- duplicated rather than
    // shared because AudioManager is owned here, not by the store. This has
    // to run even when the round just changed: a reshuffle-between-rounds
    // sets deckReshuffledAt on the very first state of the NEW round, which
    // is exactly the case the "same round" guard below skips.
    if (round.deckReshuffledAt && round.deckReshuffledAt !== prev?.deckReshuffledAt) {
      audioManager.playSfx("shuffle");
    }

    if (!prev || prev.roundId !== round.roundId) {
      prevRoundRef.current = round;
      return;
    }

    round.turns.forEach((turn) => {
      const prevTurn = prev.turns.find((t) => t.player.id === turn.player.id);
      if (!prevTurn) return;
      // Sound is ambient (the whole table hears every bet/deal/win), but a
      // buzz is felt by one person -- vibrating everyone's phone because
      // someone else two seats over placed a bet would be obnoxious, so
      // haptics.ts's cues are scoped to the local player's own turn only.
      const isMine = turn.player.id === playerId;
      // The banker is excluded because they never place a wager: calculateEndState
      // (round.ts) repurposes the admin turn's `bet` to carry the round's net
      // balance once resolved, so a bank that finished ahead read here as
      // 0 -> +N and clinked a chip for a bet nobody made -- on every round the
      // bank came out ahead. Same field-overload that hid a busted bank's
      // total (see selectors.ts's totalDisplay).
      if (turn.player.type !== "admin" && (turn.bet ?? 0) > (prevTurn.bet ?? 0)) {
        audioManager.playSfx("chip");
        if (isMine) buzz("chip");
      }
      if ((turn.cards?.length ?? 0) > (prevTurn.cards?.length ?? 0)) {
        audioManager.playSfx("deal");
        if (isMine) buzz("deal");
        if (turn.cards[turn.cards.length - 1]?.attributes?.eleveroonIgnored) {
          audioManager.playSfx("eleveroon");
        }
      }
      if (turn.state !== prevTurn.state) {
        // A push returns the wager, not a win -- it shouldn't sound like one.
        // The banker is exempt from that check rather than subject to it: a
        // push is a returned wager, and the bank never wagers. isPushTurn reads
        // bet === 0, which for a resolved admin turn means "broke even on the
        // round" -- so a bank that hit 21 on a round it happened to net $0 on
        // had its fanfare silently swallowed. The bank's state only ever reads
        // "won" for a real 21 (calculateEndState), so nothing else slips in.
        if (turn.state === "won" && (turn.player.type === "admin" || !isPushTurn(turn))) {
          // calcState (backend/src/turn.ts) flips a hand straight to "won" the
          // instant 21 becomes reachable -- during the player's OWN turn, well
          // before the banker resolves anything. A showdown win (the banker's
          // hand was simply worse) can only ever arrive LATER, as a "standby"
          // turn flipping to "won" once the round settles. Those are different
          // moments for the player -- one is "I just hit it," the other is
          // "turns out I was ahead" -- so, same as bust already gets its own
          // horn instead of sharing "lose", a natural 21 gets its own sound
          // instead of sharing the generic showdown "win".
          const justHit21 = prevTurn.state === "pending" && bestTotal(turn.cards).total === 21;
          if (justHit21) {
            // audio.ts's natural21 is a real fanfare (see its own comment),
            // not the old card-slide sample -- it no longer needs "win"
            // layered underneath to read as its own moment.
            audioManager.playSfx("natural21");
          } else {
            audioManager.playSfx("win");
          }
          if (isMine) buzz("win");
        }
        // The futch horn is for going over 21, not for losing. Keying it off
        // state === "lost" got this backwards at both ends: the BANKER's state
        // also reads "lost" when they merely finish the round down on money
        // (see calculateEndState), so a bank with a fine hand blew the horn,
        // while a genuine bank futch that ended up ahead on money didn't.
        // statusDisplay is the one place that already knows the difference.
        if (turn.state === "lost") {
          const busted = statusDisplay(turn).label === "FUTCHED!";
          audioManager.playSfx(busted ? "bust" : "lose");
          if (isMine) buzz(busted ? "bust" : "lose");
        }
      }
    });

    prevRoundRef.current = round;
  }, [audioManager, round, playerId]);

  // "It's your turn" -- the one haptic cue that isn't a round-diff echo of an
  // existing sound. Keyed off activeTurnId (useTableData's own notion of
  // whose turn is live, including turn-timer/skip edge cases) rather than
  // re-deriving it here, and only fires on the OFF->this-player edge so
  // reconnecting mid-turn or the timer just ticking doesn't re-buzz.
  useEffect(() => {
    if (activeTurnId === playerId && prevActiveTurnIdRef.current !== playerId) {
      buzz("turn");
    }
    prevActiveTurnIdRef.current = activeTurnId;
  }, [activeTurnId, playerId]);

  useEffect(() => {
    const interval = window.setInterval(() => setNowTs(Date.now()), 100);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!bankerBankrollManuallySet) {
      setBankerBankroll(buyIn);
    }
  }, [buyIn, bankerBankrollManuallySet]);

  useEffect(() => {
    if (bankerBankrollManuallySet && bankerBankroll === buyIn) {
      setBankerBankrollManuallySet(false);
    }
  }, [bankerBankroll, buyIn, bankerBankrollManuallySet]);

  useEffect(() => {
    store.init();
  }, []);
  const bankerTurns = turns.filter((t) => t.player?.type === "admin");
  const playerTurns = turns.filter((t) => t.player?.type !== "admin");
  const myPlayerTurn = playerTurns.find((t) => t.player?.id === playerId);
  const isAdmin = room?.players.find((p) => p.id === playerId)?.type === "admin";
  const bankLock = round?.bankLock;
  const primaryBankerTurn = bankerTurns[0];
  const turnTimerDurationMs = round?.turnTimerDurationMs ?? 90_000;
  // Deliberately NOT gated on bankAffordable: a seat that can't cover the
  // bank's window should still be able to press BANK! and be told so by the
  // confirm dialog's shortfall branch, which is the moment the number is
  // worth reading. Gating it here instead meant the only way to explain a
  // permanently greyed-out button was a permanent line of text under the
  // dock. The three conditions left are ones where there is nothing to
  // wager at all.
  const canBank = Boolean(bankInfo && bankInfo.available > 0 && bankIncrement > 0);

  const waitingPlayerIds = room?.waitingPlayerIds ?? [];
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  useEffect(() => {
    if (room?.buyIn && !buyInAmount) {
      setBuyInAmount(String(room.buyIn));
    }
  }, [room?.buyIn, buyInAmount]);

  // Release the landscape lock and fullscreen on the way out. This watches
  // `room` disappearing rather than hanging off the Leave button, because
  // Leave is only one of the ways out -- being kicked, the banker closing the
  // table, and the room being voided all land here too, and every one of them
  // would otherwise strand the player locked landscape on the portrait lobby.
  const wasInRoom = useRef(false);
  useEffect(() => {
    const inRoom = Boolean(room);
    if (wasInRoom.current && !inRoom) exitImmersive();
    wasInRoom.current = inRoom;
  }, [room]);

  // enterImmersive() runs first in each of these, and from the handler itself
  // rather than from an effect on `room` arriving: the fullscreen request only
  // counts while the browser still considers itself inside the tap that
  // triggered it, and the room does not arrive until a WS round-trip later.
  // See table/immersive.ts.
  const onCreate = (e: FormEvent) => {
    e.preventDefault();
    enterImmersive();
    const bankerBankrollPayload = bankerBankrollManuallySet ? bankerBankroll : undefined;
    store.createRoom(
      bankerFirstName,
      bankerLastName,
      roomName,
      roomPassword || undefined,
      buyIn,
      customRoomId || undefined,
      bankerBankrollPayload
    );
  };

  const onJoin = (e: FormEvent) => {
    e.preventDefault();
    enterImmersive();
    store.setFormError("join", undefined);
    store.joinRoom(roomIdInput, joinFirstName, joinLastName, joinPassword || undefined, false);
  };

  const onWatch = (e: React.MouseEvent) => {
    e.preventDefault();
    store.setFormError("join", undefined);
    // The two validation bail-outs below come BEFORE enterImmersive(): a
    // watcher who left the room ID blank stays on the lobby, and taking them
    // fullscreen to read a form error would be nonsense.
    if (!roomIdInput) { store.setFormError("join", "Enter a room ID to watch."); return; }
    if (!joinFirstName) { store.setFormError("join", "Enter your name so others know you're watching."); return; }
    enterImmersive();
    store.joinRoom(roomIdInput, joinFirstName, joinLastName, joinPassword || undefined, true);
  };

  // Both entry points build the same file; the player-facing one is written
  // from that player's point of view. See exportHistory.ts -- this used to be
  // 60 lines here, reachable only from the banker's drawer.
  const exportRoundHistoryTxt = (focusPlayerId?: string) => {
    const rounds = roundHistory ?? [];
    if (!rounds.length) return;
    downloadText(
      historyFilename(room?.roomId, Boolean(focusPlayerId)),
      buildHistoryText({ rounds, roomId: room?.roomId, roomName: room?.name, focusPlayerId })
    );
  };











  const rulesModals = (
    <RulesModals
      showHowTo={showHowTo}
      showWhatIs={showWhatIs}
      onCloseHowTo={() => setShowHowTo(false)}
      onCloseWhatIs={() => setShowWhatIs(false)}
    />
  );

  // The felt table is the only in-room view -- it covers the whole session,
  // including before the first round is dealt (see TableRoot's preRound).
  return room ? (
    <>
      <TableRoot
        room={room}
        round={round}
        playerId={playerId}
        isAdmin={isAdmin}
        bankerTurn={primaryBankerTurn}
        playerTurns={playerTurns}
        shoeDiscards={store.shoeDiscards}
        myPlayerTurn={myPlayerTurn}
        activeTurnId={activeTurnId}
        nextTurnId={nextTurnId}
        activeTurnTimer={activeTurnTimer}
        bankerPlayer={bankerPlayer}
        bankInfo={bankInfo}
        bankIncrement={bankIncrement}
        bankDisabledReason={bankDisabledReason}
        canBank={canBank}
        waitingInfo={waitingInfo}
        abandonedBanker={abandonedBanker}
        firstBetCardIndex={firstBetCardIndex}
        latestReactionByPlayer={latestReactionByPlayer}
        onBet={(amount, options) => store.bet(amount, options)}
        onHit={(options) => store.hit(options)}
        onStand={() => store.stand()}
        onSkip={(pid) => store.skip(pid)}
        onReact={(emoji) => sendReaction(emoji)}
        onTopUp={(amount, note) => store.topUpBanker(amount, note)}
        onSetWatermark={(text) => store.setFeltWatermark(text)}
        roundHistoryCount={roundHistory?.length ?? 0}
        onApproveRename={(id) => store.approveRename(id)}
        onRejectRename={(id) => store.rejectRename(id)}
        onRequestRename={(firstName, lastName) => store.requestRename(firstName, lastName)}
        onApproveBuyIn={(id) => store.approveBuyIn(id)}
        onRejectBuyIn={(id) => store.rejectBuyIn(id)}
        onRequestBuyIn={(amount, note) => store.requestBuyIn(amount, note)}
        onPracticeTopUp={() => store.practiceTopUp()}
        onShowHowTo={() => {
          setShowWhatIs(false);
          setShowHowTo(true);
        }}
        onEndRoundDueToBank={() => store.endRoundDueToBank()}
        onVoidAbandonedRound={() => store.voidAbandonedRound()}
        onAdjustChips={(id, amount, note) => store.adjustPlayerBankroll(id, amount, note)}
        onKick={(id) => store.kickPlayer(id)}
        onExportHistory={() => exportRoundHistoryTxt()}
        onCloseRoom={() => store.closeRoom()}
        onLeave={() => store.leaveGame()}
        onReshuffleDeck={() => store.reshuffleDeck()}
        onStartNextRound={() => {
          store.startRound(preferredDecks === "" ? undefined : Number(preferredDecks));
        }}
        notifications={notifications}
        onDismissNotification={dismissNotification}
        statsData={statsData}
        onOpenStats={(id) => setStatsPlayerId(id)}
        onCloseStats={() => setStatsPlayerId(undefined)}
        bankSummaryOpen={Boolean(bankerSummaryAt)}
        bankSummary={roundHistory?.[0]}
        onDismissBankSummary={dismissBankerSummary}
        musicEnabled={musicEnabled}
        sfxEnabled={sfxEnabled}
        onToggleMusic={() => {
          setMusicEnabled((prev) => !prev);
          setUserInteracted(true);
          audioManager.noteInteraction();
        }}
        onToggleSfx={() => {
          setSfxEnabled((prev) => !prev);
          setUserInteracted(true);
          audioManager.noteInteraction();
        }}
        motionEnabled={motionEnabled}
        onToggleMotion={() => setMotionEnabled((prev) => !prev)}
        wsStatus={status}
      />
      {rulesModals}
    </>
  ) : (
    <>
      {notifications.length > 0 && (
        <div className="fixed top-4 left-3 right-3 sm:left-auto sm:right-4 sm:max-w-sm z-50 flex flex-col gap-2">
          {notifications.map((note) => {
            const toneClass =
              note.tone === "success"
                ? "bg-emerald-50 border border-emerald-200 text-emerald-700"
                : note.tone === "error"
                ? "bg-rose-50 border border-rose-200 text-rose-700"
                : "bg-blue-50 border border-blue-200 text-blue-700";
            return (
              <div
                key={note.id}
                className={`rounded-lg px-4 py-3 shadow-md ${toneClass}`}
                role="alert"
                aria-live="assertive"
              >
                <div className="flex items-start gap-3">
                  <span className="flex-1 text-sm font-medium whitespace-pre-line">{note.message}</span>
                  <button
                    type="button"
                    className="text-xs uppercase tracking-wide"
                    onClick={() => dismissNotification(note.id)}
                  >
                    Close
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div className="max-w-6xl mx-auto px-3 sm:px-4 py-4 sm:py-8 flex flex-col gap-4 sm:gap-6">
        {message && !formErrors.join && (
        <div className="card-surface border border-red-200 bg-red-50 text-red-700 px-4 py-2 text-sm">
          {message}
        </div>
      )}
      <SiteHeader />
        {/* One field for all three lobby forms. It only appears once the
            server has actually refused for want of a code (see state.ts's
            accessCodeRequired) -- the mode is not published to unauthenticated
            clients, so an always-visible "access code (if you have one)" box
            would be asking every ordinary visitor about a lock that is not
            there. */}
        {!room && accessCodeRequired && (
          <section className="rounded-xl border border-amber-300 bg-amber-50 p-4 flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-amber-900">This table is invite-only right now</h2>
            <p className="text-xs text-amber-800">
              Enter the access code you were given, then try again. It is remembered on this device.
            </p>
            <label className="text-sm text-amber-900">
              Access code
              <input
                className="mt-1 w-full rounded border border-amber-300 px-3 py-2"
                value={accessCode}
                onChange={(e) => setAccessCode(e.target.value)}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
              />
            </label>
          </section>
        )}
        {!room && (
          <section className="rounded-xl shadow-md bg-blue-50/70 border border-blue-200 p-4 flex flex-col gap-2">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-3 max-w-xl">
                <h1 className="text-xl font-bold text-blue-800">Welcome to Kvitlach</h1>
                <div className="text-xs text-slate-600">
                  Join an existing table with the room code your Banker shared, or host one if you are running the game.
                </div>
                <div className="space-y-1 text-xs text-slate-600">
                  <p>Banker manages the bankroll and payouts; everyone else plays against them.</p>
                  <p>Most visitors only need the Join form—create a table only if you are the Banker.</p>
                </div>
              </div>
              <div className="flex flex-col items-end gap-2">
                <button
                  type="button"
                  className="group inline-flex items-center gap-2 rounded-full border border-accent text-accent px-4 py-2 text-xs font-semibold tracking-wide shadow-sm transition-colors duration-200 hover:bg-accent hover:text-white"
                  onClick={() => {
                    setShowWhatIs(false);
                    setShowHowTo(true);
                  }}
                >
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-accent text-white text-[10px] font-bold transition-colors duration-200 group-hover:bg-white group-hover:text-accent">
                    ?
                  </span>
                  <span>How to play</span>
                </button>
                <button
                  type="button"
                  className="group inline-flex items-center gap-2 rounded-full border border-blue-300 text-blue-700 px-4 py-2 text-xs font-semibold tracking-wide shadow-sm transition-colors duration-200 hover:bg-blue-600 hover:text-white"
                  onClick={() => {
                    setShowHowTo(false);
                    setShowWhatIs(true);
                  }}
                >
                  <span className="inline-flex h-5 w-5 items-center justify-center overflow-hidden rounded border border-blue-300 bg-white shadow-sm transition-colors duration-200 group-hover:border-blue-600 p-[1px]">
                    <img
                      src="/blank.png"
                      alt=""
                      aria-hidden="true"
                      className="h-full w-full object-contain"
                      loading="lazy"
                    />
                  </span>
                  <span>What is Kvitlach?</span>
                </button>
              </div>
            </div>
          </section>
        )}

        {!room && <InstallPrompt />}

        {!room && (
          <section className="grid md:grid-cols-2 gap-4 items-start">
          <form className="card-surface p-4 flex flex-col gap-3" onSubmit={onJoin}>
            <header className="flex flex-col gap-1 pb-3 border-b border-slate-200">
              <h2 className="text-lg font-semibold text-ink flex items-center gap-2">
                Join Game
                <span className="inline-flex items-center gap-1 text-[11px] uppercase tracking-[0.3em] text-slate-600">
                  <svg
                    className="h-3 w-3 text-blue-500"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d="M10 2a4 4 0 110 8 4 4 0 010-8zm0 10c-3.314 0-6 1.79-6 4v1h12v-1c0-2.21-2.686-4-6-4z" />
                  </svg>
                  (Player)
                </span>
              </h2>
              <p className="text-xs text-slate-500">Enter the code you received from the Banker to take a seat.</p>
            </header>
            <label className="text-sm">Game ID
                {/* Room IDs are server-normalized to uppercase either way (store.ts
                    trims + uppercases on join) -- mirroring that as you type, same
                    as the Custom Game ID field below already does, means what's on
                    screen matches what a banker actually shared, and autoCorrect/
                    spellCheck off stops a phone "fixing" a code into a dictionary
                    word or flagging it as a typo. */}
                <input
                  required
                  className="mt-1 w-full rounded border px-3 py-2 uppercase"
                  value={roomIdInput}
                  onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                  autoCapitalize="characters"
                  autoCorrect="off"
                  autoComplete="off"
                  spellCheck={false}
                />
            </label>
              <label className="text-sm">First name (required)
                <input
                  required
                  className="mt-1 w-full rounded border px-3 py-2"
                  value={joinFirstName}
                  onChange={(e) => setJoinFirst(e.target.value)}
                  autoComplete="given-name"
                  autoCapitalize="words"
                />
            </label>
              <label className="text-sm">Last name (optional)
                <input
                  className="mt-1 w-full rounded border px-3 py-2"
                  value={joinLastName}
                  onChange={(e) => setJoinLast(e.target.value)}
                  autoComplete="family-name"
                  autoCapitalize="words"
                />
            </label>
            <label className="text-sm">Password (if required)
              <input
                type="password"
                className={clsx(
                  "mt-1 w-full rounded border px-3 py-2",
                  formErrors.join ? "border-red-300 focus:border-red-400 focus:ring-red-200" : ""
                )}
                value={joinPassword}
                onChange={(e) => setJoinPassword(e.target.value)}
                autoComplete="current-password"
              />
            </label>
            {formErrors.join && (
              <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
                {formErrors.join}
              </div>
            )}
              <div className="flex gap-2">
                <button
                  type="submit"
                  className="flex-1 bg-accent text-white rounded px-4 py-2 font-semibold shadow-sm transition-colors duration-200 hover:bg-accent/85"
                >
                  Join
                </button>
                <button
                  type="button"
                  onClick={onWatch}
                  className="flex-1 rounded border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-600 shadow-sm transition-colors hover:bg-slate-50"
                  title="Watch the game without being dealt in"
                >
                  Watch
                </button>
              </div>
          </form>
          <form
            className={clsx("card-surface p-4 flex flex-col", bankerFormExpanded ? "gap-3" : "gap-2")}
            onSubmit={onCreate}
          >
          <header className={clsx("transition-all", bankerFormExpanded ? "pb-3 border-b border-slate-200" : "pb-0")}
          >
            <button
              type="button"
              className={clsx(
                "w-full rounded-lg border px-4 py-3 text-sm font-semibold transition-colors flex items-center justify-between gap-3",
                bankerFormExpanded ? "bg-ink text-white border-ink" : "border-slate-300 text-slate-700 hover:bg-slate-100"
              )}
              onClick={() => setBankerFormExpanded((v) => !v)}
              aria-expanded={bankerFormExpanded}
              aria-controls="banker-create-fields"
            >
              <span className="inline-flex items-center gap-2">
                <svg className="h-4 w-4 text-blue-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path d="M10 2l7 3v2h-1v8h1v2H3v-2h1V7H3V5l7-3zm-4 5v8h2V7H6zm4 0v8h2V7h-2zm4 0v8h2V7h-2z" />
                </svg>
                <span>Banker: Host the table, set wagers, etc.</span>
              </span>
              <svg
                className={clsx("h-4 w-4 transition-transform", bankerFormExpanded ? "rotate-180" : "rotate-0")}
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M5.23 7.21a.75.75 0 011.06.02L10 10.44l3.71-3.21a.75.75 0 111.04 1.08l-4.24 3.67a.75.75 0 01-1.02 0L5.21 8.31a.75.75 0 01.02-1.1z" />
              </svg>
            </button>
          </header>
          {formErrors.create && (
            <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
              {formErrors.create}
            </div>
          )}
          {bankerFormExpanded && (
            <div className="flex flex-col gap-3" id="banker-create-fields">
              <label className="text-sm">Game Name
                <input
                  className="mt-1 w-full rounded border px-3 py-2"
                  value={roomName}
                  onChange={(e) => setRoomName(e.target.value)}
                  autoCapitalize="words"
                />
              </label>
              <label className="text-sm">Custom Game ID (optional)
                <input
                  className="mt-1 w-full rounded border px-3 py-2 uppercase"
                  value={customRoomId}
                  onChange={(e) => setCustomRoomId(e.target.value.toUpperCase())}
                  placeholder="e.g. CHOLENT-613"
                  maxLength={20}
                  autoCapitalize="characters"
                  autoCorrect="off"
                  autoComplete="off"
                  spellCheck={false}
                />
                <span className="text-xs text-slate-500">Use 4-20 characters with letters, numbers, or hyphen.</span>
              </label>
              <label className="text-sm">First name (required)
                <input
                  required
                  className="mt-1 w-full rounded border px-3 py-2"
                  value={bankerFirstName}
                  onChange={(e) => setBankerFirst(e.target.value)}
                  autoComplete="given-name"
                  autoCapitalize="words"
                />
              </label>
              <label className="text-sm">Last name (optional)
                <input
                  className="mt-1 w-full rounded border px-3 py-2"
                  value={bankerLastName}
                  onChange={(e) => setBankerLast(e.target.value)}
                  autoComplete="family-name"
                  autoCapitalize="words"
                />
              </label>
              <label className="text-sm">Password (optional for joining)
                <input
                  type="password"
                  className="mt-1 w-full rounded border px-3 py-2"
                  value={roomPassword}
                  onChange={(e) => setRoomPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </label>
              <label className="text-sm">Buy-in per player
                <input className="mt-1 w-full rounded border px-3 py-2" type="number" min={1} value={buyIn} onChange={(e) => setBuyIn(Number(e.target.value))} />
              </label>
              <label className="text-sm">Banker starting bankroll
                <input
                  className="mt-1 w-full rounded border px-3 py-2"
                  type="number"
                  min={1}
                  value={bankerBankroll}
                  onChange={(e) => {
                    if (e.target.value === "") {
                      setBankerBankroll(buyIn);
                      setBankerBankrollManuallySet(false);
                      return;
                    }
                    const next = Number(e.target.value);
                    if (Number.isNaN(next)) return;
                    setBankerBankroll(next);
                    setBankerBankrollManuallySet(next !== buyIn);
                  }}
                />
              </label>
              <div className="flex items-center justify-between text-xs text-slate-500 -mt-1">
                <span>Defaults to the player buy-in amount.</span>
                {bankerBankrollManuallySet && (
                  <button
                    type="button"
                    className="text-blue-700 font-semibold"
                    onClick={() => {
                      setBankerBankroll(buyIn);
                      setBankerBankrollManuallySet(false);
                    }}
                  >
                    Match buy-in
                  </button>
                )}
              </div>
              <label className="text-sm">Decks to use (optional)
                <input className="mt-1 w-full rounded border px-3 py-2" type="number" min={1} max={16} placeholder="auto" value={preferredDecks} onChange={(e) => setPreferredDecks(e.target.value)} />
                <span className="text-xs text-slate-500">Set this before starting the first round; leave blank to auto-size by players (supports large tables).</span>
              </label>
                <button
                  type="submit"
                  className="bg-accent text-white rounded px-4 py-2 font-semibold shadow-sm transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent hover:bg-accent/90"
                >
                  Create
                </button>
            </div>
          )}
        </form>

        </section>
      )}

        {/* Deliberately its own card, not a row in the grid above: this is a
            solo sandbox (no other humans, no real stakes), and burying it
            inside the Join form made it easy to miss and easy to confuse
            with actually joining someone's table. Dashed border + a blue
            tint reads as "not a real table" without leaving the app's
            existing color language. */}
        {!room && (
          <section className="card-surface p-4 flex flex-col gap-3 border-2 border-dashed border-blue-300 bg-blue-50/60">
            <header className="flex flex-col gap-1 pb-3 border-b border-blue-200">
              <h2 className="text-lg font-semibold text-ink flex items-center gap-2">
                Practice Against the Computer
                <span className="inline-flex items-center gap-1 text-[11px] uppercase tracking-[0.3em] text-slate-600">
                  Solo
                </span>
              </h2>
              <p className="text-xs text-slate-500">
                Learn the flow against computer players -- nobody else needs to be online, and nothing here touches a
                real table.
              </p>
            </header>

            <label className="text-sm">First name (optional)
              <input
                className="mt-1 w-full rounded border px-3 py-2"
                value={practiceFirstName}
                onChange={(e) => setPracticeFirst(e.target.value)}
                placeholder="Guest"
                autoComplete="given-name"
                autoCapitalize="words"
              />
            </label>

            {formErrors.practice && (
              <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
                {formErrors.practice}
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                enterImmersive();
                store.createPracticeRoom(practiceFirstName.trim() || "Guest", {
                  botCount: practiceBotCount,
                  deckCount: practiceDecks,
                  buyIn: practiceBuyIn,
                  bankBuyIn: practiceBankBuyIn,
                });
              }}
              className="w-full rounded bg-accent px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors duration-200 hover:bg-accent/85"
              title="Start a solo table against computer players -- no code needed"
            >
              Practice Against the Computer
            </button>

            <button
              type="button"
              className="self-start text-xs font-semibold text-blue-700 hover:text-blue-800"
              onClick={() => setPracticeExpanded((v) => !v)}
              aria-expanded={practiceExpanded}
              aria-controls="practice-settings"
            >
              {practiceExpanded ? "Hide table settings" : "Customize table settings"}
            </button>

            {practiceExpanded && (
              <div className="flex flex-col gap-4 pt-1" id="practice-settings">
                <label className="text-sm flex flex-col gap-1">
                  <span className="flex items-center justify-between">
                    <span>Computer players</span>
                    <span className="font-semibold text-ink">{practiceBotCount}</span>
                  </span>
                  <input
                    type="range"
                    min={2}
                    max={10}
                    step={1}
                    value={practiceBotCount}
                    onChange={(e) => setPracticeBotCount(Number(e.target.value))}
                    className="w-full accent-blue-600"
                    aria-label="Number of computer players"
                  />
                </label>

                <label className="text-sm flex flex-col gap-1">
                  <span className="flex items-center justify-between">
                    <span>Decks</span>
                    <span className="font-semibold text-ink">{practiceDecks}</span>
                  </span>
                  <input
                    type="range"
                    min={1}
                    max={8}
                    step={1}
                    value={practiceDecks}
                    onChange={(e) => setPracticeDecks(Number(e.target.value))}
                    className="w-full accent-blue-600"
                    aria-label="Number of decks"
                  />
                </label>

                <label className="text-sm flex flex-col gap-1">
                  <span className="flex items-center justify-between">
                    <span>Your starting money</span>
                    <span className="font-semibold text-ink">${practiceBuyIn.toLocaleString()}</span>
                  </span>
                  <input
                    type="range"
                    min={20}
                    max={1000}
                    step={10}
                    value={practiceBuyIn}
                    onChange={(e) => {
                      const next = Number(e.target.value);
                      setPracticeBuyIn(next);
                      // Tracks 4x buy-in automatically, same as the Host
                      // form's bankerBankroll -- but if the bank amount was
                      // hand-set, re-clamp it into the new [buyIn, 10x] range
                      // instead of silently overriding it, so a big manual
                      // bank value survives a small buy-in tweak intact.
                      if (!practiceBankBuyInManuallySet) {
                        setPracticeBankBuyIn(next * 4);
                      } else {
                        setPracticeBankBuyIn((prev) => Math.min(Math.max(prev, next), next * 10));
                      }
                    }}
                    className="w-full accent-blue-600"
                    aria-label="Your starting money"
                  />
                </label>

                <div className="flex flex-col gap-1">
                  <label className="text-sm flex flex-col gap-1">
                    <span className="flex items-center justify-between">
                      <span>Bank's starting money</span>
                      <span className="font-semibold text-ink">${practiceBankBuyIn.toLocaleString()}</span>
                    </span>
                    <input
                      type="range"
                      min={practiceBuyIn}
                      max={practiceBuyIn * 10}
                      step={10}
                      value={practiceBankBuyIn}
                      onChange={(e) => {
                        const next = Number(e.target.value);
                        setPracticeBankBuyIn(next);
                        setPracticeBankBuyInManuallySet(next !== practiceBuyIn * 4);
                      }}
                      className="w-full accent-blue-600"
                      aria-label="Bank's starting money"
                    />
                  </label>
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>Defaults to 4x your starting money.</span>
                    {practiceBankBuyInManuallySet && (
                      <button
                        type="button"
                        className="text-blue-700 font-semibold"
                        onClick={() => {
                          setPracticeBankBuyIn(practiceBuyIn * 4);
                          setPracticeBankBuyInManuallySet(false);
                        }}
                      >
                        Reset to 4x
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </section>
        )}



      <SiteFooter>
        <div className="flex items-center gap-3">
          {/* The raw "WS ok/wait/down" pill used to live here, permanently
              visible even when perfectly healthy -- pure engineering jargon
              on the public lobby, and it didn't gate Join/Create or drive
              any inline error, so it wasn't load-bearing. Removed rather
              than kept as always-on chrome; TableRoot.tsx's own connection
              tag (`wsStatus !== "connected"`) is the pattern worth
              following if this needs to come back -- silent while healthy,
              a plain-English warning only when something's actually
              wrong. */}
          <span className="text-[11px] uppercase tracking-wide text-slate-500">Sound</span>
          <label className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-1 shadow-sm">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              checked={musicEnabled}
              onChange={(e) => {
                const next = e.target.checked;
                setMusicEnabled(next);
                setUserInteracted(true);
                audioManager.noteInteraction();
              }}
            />
            <span className="text-[11px] font-semibold text-ink">Music</span>
          </label>
          <label className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-1 shadow-sm">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              checked={sfxEnabled}
              onChange={(e) => {
                const next = e.target.checked;
                setSfxEnabled(next);
                setUserInteracted(true);
                audioManager.noteInteraction();
              }}
            />
            <span className="text-[11px] font-semibold text-ink">SFX</span>
          </label>
          <label className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-1 shadow-sm">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              checked={motionEnabled}
              onChange={(e) => setMotionEnabled(e.target.checked)}
            />
            <span className="text-[11px] font-semibold text-ink">Motion</span>
          </label>
        </div>
      </SiteFooter>


      </div>
      {rulesModals}
    </>
  );
}
