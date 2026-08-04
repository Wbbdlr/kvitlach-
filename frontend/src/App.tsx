import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { clsx } from "clsx";
import { useGameStore } from "./state";
import { Player, RoundState } from "./types";
import { AudioManager } from "./audio";

import { isPushTurn, statusDisplay } from "./table/selectors";
import { useTableData } from "./table/useTableData";
import { TableRoot } from "./table/TableRoot";
import { RulesModals } from "./RulesModals";
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
    wsUrl,
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
  const [userInteracted, setUserInteracted] = useState(false);
  const audioManager = useMemo(() => new AudioManager(), []);
  const prevRoundRef = useRef<RoundState | undefined>(undefined);
  const prefilledRoomIdRef = useRef(false);
  const formErrors = store.formErrors ?? {};
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
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get("room");
    if (fromQuery) {
      setRoomId(fromQuery);
      prefilledRoomIdRef.current = true;
      return;
    }
    const lastRoom = window.localStorage.getItem("kvitlach.lastRoomId");
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
      if ((turn.bet ?? 0) > (prevTurn.bet ?? 0)) {
        audioManager.playSfx("chip");
      }
      if ((turn.cards?.length ?? 0) > (prevTurn.cards?.length ?? 0)) {
        audioManager.playSfx("deal");
        if (turn.cards[turn.cards.length - 1]?.attributes?.eleveroonIgnored) {
          audioManager.playSfx("eleveroon");
        }
      }
      if (turn.state !== prevTurn.state) {
        // A push returns the wager, not a win -- it shouldn't sound like one.
        if (turn.state === "won" && !isPushTurn(turn)) audioManager.playSfx("win");
        // The futch horn is for going over 21, not for losing. Keying it off
        // state === "lost" got this backwards at both ends: the BANKER's state
        // also reads "lost" when they merely finish the round down on money
        // (see calculateEndState), so a bank with a fine hand blew the horn,
        // while a genuine bank futch that ended up ahead on money didn't.
        // statusDisplay is the one place that already knows the difference.
        if (turn.state === "lost") {
          const busted = statusDisplay(turn).label === "FUTCHED!";
          audioManager.playSfx(busted ? "bust" : "lose");
        }
      }
    });

    prevRoundRef.current = round;
  }, [audioManager, round]);

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
  const canBank = Boolean(bankInfo && bankInfo.available > 0 && bankIncrement > 0);

  const waitingPlayerIds = room?.waitingPlayerIds ?? [];
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  useEffect(() => {
    if (room?.buyIn && !buyInAmount) {
      setBuyInAmount(String(room.buyIn));
    }
  }, [room?.buyIn, buyInAmount]);

  const onCreate = (e: FormEvent) => {
    e.preventDefault();
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
    store.setFormError("join", undefined);
    store.joinRoom(roomIdInput, joinFirstName, joinLastName, joinPassword || undefined, false);
  };

  const onWatch = (e: React.MouseEvent) => {
    e.preventDefault();
    store.setFormError("join", undefined);
    if (!roomIdInput) { store.setFormError("join", "Enter a room ID to watch."); return; }
    if (!joinFirstName) { store.setFormError("join", "Enter your name so others know you're watching."); return; }
    store.joinRoom(roomIdInput, joinFirstName, joinLastName, joinPassword || undefined, true);
  };

  const exportRoundHistoryTxt = () => {
    const rounds = roundHistory ?? [];
    if (!rounds.length) return;
    if (typeof window === "undefined") return;

    const header = [
      "Kvitlach Round History",
      room?.roomId ? `Room: ${room.roomId}` : undefined,
      `Exported: ${new Date().toLocaleString()}`,
      "",
    ]
      .filter(Boolean)
      .join("\n");

    const body = rounds
      .map((r, idx) => {
        const roundLines: string[] = [];
        roundLines.push(`Round ${r.roundNumber ?? idx + 1}`);
        roundLines.push(`Completed: ${new Date(r.completedAt).toLocaleString()}`);
        roundLines.push(`Players: ${r.turns?.length ?? 0}`);
        (r.turns ?? []).forEach((turn) => {
          const name = [turn.player.firstName, turn.player.lastName].filter(Boolean).join(" ") || turn.player.firstName || "Player";
          const role = turn.player.type === "admin" ? "Banker" : "Player";
          const bet = typeof turn.bet === "number" ? `$${turn.bet}` : "--";
          const net = typeof turn.settledNet === "number" ? ` | Net: ${turn.settledNet >= 0 ? "+" : ""}$${Math.abs(turn.settledNet)}` : "";
          const stateLabel = statusDisplay(turn).label || turn.state;
          roundLines.push(`  - ${name} (${role}) | State: ${stateLabel} | Bet: ${bet}${net}`);
        });
        if (r.balances?.length) {
          const nameById = new Map(
            (r.turns ?? []).map((turn) => [
              turn.player.id,
              [turn.player.firstName, turn.player.lastName].filter(Boolean).join(" ") || turn.player.firstName || "Player",
            ])
          );
          roundLines.push("  Balances:");
          r.balances.forEach((b) => {
            const payerName = nameById.get(b.payer) ?? b.payer;
            const payeeName = nameById.get(b.payee) ?? b.payee;
            roundLines.push(`    - ${payerName} -> ${payeeName}: $${b.amount}`);
          });
        }
        roundLines.push("");
        return roundLines.join("\n");
      })
      .join("\n");

    const content = [header, body].join("\n");
    const filename = `kvitlach-history${room?.roomId ? `-${room.roomId}` : ""}.txt`;

    const triggerDownload = (href: string) => {
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = filename;
      anchor.rel = "noopener";
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
    };

    try {
      const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      triggerDownload(url);
      requestAnimationFrame(() => URL.revokeObjectURL(url));
    } catch (err) {
      const dataUri = `data:text/plain;charset=utf-8,${encodeURIComponent(content)}`;
      triggerDownload(dataUri);
    }
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
        {!room && (
          <section className="rounded-xl shadow-md bg-amber-50/70 border border-amber-200 p-4 flex flex-col gap-2">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-3 max-w-xl">
                <h1 className="text-xl font-bold text-amber-800">Welcome to Kvitlach</h1>
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
                  className="group inline-flex items-center gap-2 rounded-full border border-amber-300 text-amber-700 px-4 py-2 text-xs font-semibold tracking-wide shadow-sm transition-colors duration-200 hover:bg-amber-600 hover:text-white"
                  onClick={() => {
                    setShowHowTo(false);
                    setShowWhatIs(true);
                  }}
                >
                  <span className="inline-flex h-5 w-5 items-center justify-center overflow-hidden rounded border border-amber-300 bg-white shadow-sm transition-colors duration-200 group-hover:border-amber-600 p-[1px]">
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

        {!room && (
          <section className="grid md:grid-cols-2 gap-4 items-start">
          <form className="card-surface p-4 flex flex-col gap-3" onSubmit={onJoin}>
            <header className="flex flex-col gap-1 pb-3 border-b border-slate-200">
              <h2 className="text-lg font-semibold text-ink flex items-center gap-2">
                Join Game
                <span className="inline-flex items-center gap-1 text-[11px] uppercase tracking-[0.3em] text-slate-600">
                  <svg
                    className="h-3 w-3 text-amber-500"
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
                <input required className="mt-1 w-full rounded border px-3 py-2" value={roomIdInput} onChange={(e) => setRoomId(e.target.value)} />
            </label>
              <label className="text-sm">First name (required)
                <input required className="mt-1 w-full rounded border px-3 py-2" value={joinFirstName} onChange={(e) => setJoinFirst(e.target.value)} />
            </label>
              <label className="text-sm">Last name (optional)
                <input className="mt-1 w-full rounded border px-3 py-2" value={joinLastName} onChange={(e) => setJoinLast(e.target.value)} />
            </label>
            <label className="text-sm">Password (if required)
              <input
                className={clsx(
                  "mt-1 w-full rounded border px-3 py-2",
                  formErrors.join ? "border-red-300 focus:border-red-400 focus:ring-red-200" : ""
                )}
                value={joinPassword}
                onChange={(e) => setJoinPassword(e.target.value)}
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
              <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                <span>Computer players</span>
                <div className="flex gap-1" role="group" aria-label="Number of computer players">
                  {[2, 3, 4, 5].map((count) => (
                    <button
                      key={count}
                      type="button"
                      onClick={() => setPracticeBotCount(count)}
                      aria-pressed={practiceBotCount === count}
                      className={clsx(
                        "h-6 w-6 rounded-full border text-xs font-semibold transition-colors",
                        practiceBotCount === count
                          ? "border-accent bg-accent text-white"
                          : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                      )}
                    >
                      {count}
                    </button>
                  ))}
                </div>
              </div>
              <button
                type="button"
                onClick={() => store.createPracticeRoom(joinFirstName.trim() || "Guest", practiceBotCount)}
                className="w-full rounded bg-accent px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors duration-200 hover:bg-accent/85"
                title="Start a solo table against computer players -- no code needed"
              >
                Practice Against the Computer
              </button>
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
                <svg className="h-4 w-4 text-amber-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
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
                />
              </label>
              <label className="text-sm">Custom Game ID (optional)
                <input
                  className="mt-1 w-full rounded border px-3 py-2 uppercase"
                  value={customRoomId}
                  onChange={(e) => setCustomRoomId(e.target.value.toUpperCase())}
                  placeholder="e.g. CHOLENT-613"
                  maxLength={20}
                />
                <span className="text-xs text-slate-500">Use 4-20 characters with letters, numbers, or hyphen.</span>
              </label>
              <label className="text-sm">First name (required)
                <input required className="mt-1 w-full rounded border px-3 py-2" value={bankerFirstName} onChange={(e) => setBankerFirst(e.target.value)} />
              </label>
              <label className="text-sm">Last name (optional)
                <input className="mt-1 w-full rounded border px-3 py-2" value={bankerLastName} onChange={(e) => setBankerLast(e.target.value)} />
              </label>
              <label className="text-sm">Password (optional for joining)
                <input className="mt-1 w-full rounded border px-3 py-2" value={roomPassword} onChange={(e) => setRoomPassword(e.target.value)} />
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
                    className="text-amber-700 font-semibold"
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



      <SiteFooter>
        <div className="flex items-center gap-3">
          <span
            className={clsx(
              "inline-flex items-center gap-1 rounded-full px-2 py-1 border text-[11px]",
              status === "connected"
                ? "border-green-200 bg-green-50 text-green-700"
                : status === "connecting"
                ? "border-amber-200 bg-amber-50 text-amber-700"
                : "border-slate-200 bg-slate-50 text-slate-700"
            )}
            title={`WebSocket: ${status} (${wsUrl})`}
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: status === "connected" ? "#16a34a" : status === "connecting" ? "#f59e0b" : "#94a3b8" }}
              aria-hidden="true"
            />
            <span className="uppercase tracking-wide">WS</span>
            <span className="text-[10px]">{status === "connected" ? "ok" : status === "connecting" ? "wait" : "down"}</span>
          </span>
          <span className="text-[11px] uppercase tracking-wide text-slate-500">Sound</span>
          <label className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-1 shadow-sm">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
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
              className="h-4 w-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
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
        </div>
      </SiteFooter>


      </div>
      {rulesModals}
    </>
  );
}
