import { create, StateCreator } from "zustand";
import { WSClient } from "./ws";
import { Balance, RoomState, RoundHistoryEntry, RoundState, ServerEnvelope, Turn, ConnectionSummary } from "./types";
import { ReactionEvent } from "./types";
import { bestTotal, isPushTurn } from "./table/selectors";
import { DiscardEntry, discardedEntries } from "./table/DiscardPile";
import { router } from "./router";

type NotificationTone = "success" | "info" | "error";

export interface UINotification {
  id: string;
  message: string;
  tone: NotificationTone;
}

interface SessionData {
  roomId: string;
  playerId: string;
  token: string;
  // Lets a SessionData value be passed directly as a WSClient.send() payload
  // (MessagePayload = Record<string, unknown> | undefined) -- named
  // interfaces aren't structurally assignable to an indexed type without
  // this, unlike object literals, which TS checks more leniently.
  [key: string]: unknown;
}

export interface CompletedRoundSummary {
  roundId: string;
  roundNumber: number;
  turns: Turn[];
  balances: Balance[];
  completedAt: number;
}

interface UIState {
  client: WSClient;
  room?: RoomState;
  round?: RoundState;
  balances: Balance[];
  roundHistory: CompletedRoundSummary[];
  // Every resolved hand's cards from the CURRENT shoe, not just the round in
  // progress -- see advanceShoeDiscards below for how it accumulates across
  // rounds and resets on reshuffle. TableRoot merges this with the live
  // round's own resolved cards for DiscardPile/DiscardPileModal.
  shoeDiscards: DiscardEntry[];
  connections?: ConnectionSummary[];
  reactions: ReactionEvent[];
  playerId?: string;
  session?: SessionData;
  status: "disconnected" | "connecting" | "connected";
  message?: string;
  wsUrl: string;
  pendingAction?: { requestId: string; type: "bet" | "hit" | "stand" | "skip" };
  bankerSummaryAt?: number;
  init: () => void;
  createRoom: (firstName: string, lastName?: string, roomName?: string, password?: string, buyIn?: number, roomId?: string, bankerBankroll?: number) => void;
  createPracticeRoom: (firstName: string, options?: { botCount?: number; buyIn?: number; bankBuyIn?: number; deckCount?: number }) => void;
  joinRoom: (roomId: string, firstName: string, lastName?: string, password?: string, spectator?: boolean) => void;
  notifications: UINotification[];
  dismissNotification: (id: string) => void;
  setFormError: (form: "join" | "create" | "round" | "global" | "practice", message?: string) => void;
  formErrors: Partial<Record<"join" | "create" | "round" | "global" | "practice", string>>;
  startRound: (deckCount?: number) => void;
  bet: (amount: number, options?: { bank?: boolean; eleveroon?: boolean }) => void;
  hit: (options?: { eleveroon?: boolean }) => void;
  stand: () => void;
  skip: (playerId?: string) => void;
  sendReaction: (emoji: string) => void;
  requestRename: (firstName: string, lastName?: string) => void;
  approveRename: (playerId: string) => void;
  rejectRename: (playerId: string) => void;
  requestBuyIn: (amount: number, note?: string) => void;
  practiceTopUp: () => void;
  approveBuyIn: (playerId: string) => void;
  rejectBuyIn: (playerId: string) => void;
  topUpBanker: (amount: number, note?: string) => void;
  endRoundDueToBank: () => void;
  voidAbandonedRound: () => void;
  dismissBankerSummary: () => void;
  kickPlayer: (playerId: string) => void;
  adjustPlayerBankroll: (playerId: string, amount: number, note?: string) => void;
  setFeltWatermark: (text: string) => void;
  reshuffleDeck: () => void;
  closeRoom: () => void;
  leaveGame: () => void;
}

const SESSION_STORAGE_KEY = "kvitlach.session";
const LAST_ROOM_STORAGE_KEY = "kvitlach.lastRoomId";
// How long the GENERIC "last active room" session may silently auto-resume
// for. This is the ambient "whatever I was last doing" key with no age check
// at all -- the cause of the original "dropped back into a game from last
// week" bug. Deliberately much shorter than the server's own room/session
// TTLs (server session token: 7 days, SESSION_TTL_MS in backend/store.ts;
// room inactivity GC: 21 days, INACTIVITY_TIMEOUT_MS) -- those exist so a
// genuinely-paused game survives server-side, but the CLIENT shouldn't drop
// someone back into a days-old game with no indication it happened. Past
// this window the session is treated as stale and cleared, landing on a
// fresh join screen instead (the "Leave game" button clears it immediately,
// on demand).
const AUTO_RESUME_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
// How long a PER-ROOM session (reached via a ?room=CODE URL -- a bookmark or
// a restored browser tab) may resume for. Unlike the generic key above, this
// is a deliberate return to one specific, named room, not an accidental
// stale resume -- so it's allowed to track the server's own room lifetime
// instead of the much stricter window above. If the room has actually
// expired server-side by then, room:resume just fails with room_not_found
// and the client falls through to a fresh join screen anyway (see the
// silent-stale-resume handling below), so this can't leave anyone stuck.
const ROOM_SESSION_MAX_AGE_MS = 21 * 24 * 60 * 60 * 1000; // 21 days
const historyKey = (roomId: string) => `kvitlach.history.${roomId}`;
const roomSessionKey = (roomId: string) => `kvitlach.session.${roomId}`;

interface PersistedSession extends SessionData {
  savedAt: number;
}

interface PersistedRoomSession extends SessionData {
  firstName?: string;
  lastName?: string;
  savedAt: number;
}

const loadSession = (): SessionData | undefined => {
  if (typeof window === "undefined" || !window.localStorage) return undefined;
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.roomId === "string" &&
      typeof parsed.playerId === "string" &&
      typeof parsed.token === "string"
    ) {
      // Entries saved before `savedAt` existed, or older than the auto-resume
      // window, are treated as stale rather than silently resumed.
      if (typeof parsed.savedAt !== "number" || Date.now() - parsed.savedAt > AUTO_RESUME_MAX_AGE_MS) {
        window.localStorage.removeItem(SESSION_STORAGE_KEY);
        return undefined;
      }
      return parsed as SessionData;
    }
  } catch (err) {
    console.warn("Failed to load session", err);
  }
  return undefined;
};

const loadRoomSession = (roomId: string): PersistedRoomSession | undefined => {
  if (typeof window === "undefined" || !window.localStorage) return undefined;
  try {
    const raw = window.localStorage.getItem(roomSessionKey(roomId));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.roomId === "string" &&
      typeof parsed.playerId === "string" &&
      typeof parsed.token === "string" &&
      typeof parsed.savedAt === "number"
    ) {
      if (Date.now() - parsed.savedAt > ROOM_SESSION_MAX_AGE_MS) {
        window.localStorage.removeItem(roomSessionKey(roomId));
        return undefined;
      }
      return parsed as PersistedRoomSession;
    }
  } catch (err) {
    console.warn("Failed to load room session", err);
  }
  return undefined;
};

const persistRoomSession = (session: SessionData, firstName?: string, lastName?: string) => {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const entry: PersistedRoomSession = { ...session, firstName, lastName, savedAt: Date.now() };
    window.localStorage.setItem(roomSessionKey(session.roomId), JSON.stringify(entry));
  } catch (err) {
    console.warn("Failed to persist room session", err);
  }
};

const clearRoomSession = (roomId: string) => {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.removeItem(roomSessionKey(roomId));
  } catch (err) {
    console.warn("Failed to clear room session", err);
  }
};

// /table/:roomId (the URL shown once actually seated in a room) takes
// priority over the legacy ?room= query param, which stays live as an
// invite-link pre-fill hint (App.tsx reads it separately to fill the join
// form's Game ID field for someone who hasn't joined yet) and for anyone
// re-clicking an old-style link to a room they already have a stored
// session for.
const ROOM_PATH_RE = /^\/table\/([^/]+)\/?$/;
const getUrlRoomId = (): string | undefined => {
  if (typeof window === "undefined") return undefined;
  try {
    const pathMatch = window.location.pathname.match(ROOM_PATH_RE);
    if (pathMatch) return decodeURIComponent(pathMatch[1]).trim().toUpperCase();
    const params = new URLSearchParams(window.location.search);
    const roomId = params.get("room");
    return roomId ? roomId.trim().toUpperCase() : undefined;
  } catch {
    return undefined;
  }
};

const loadLastRoomId = (): string | undefined => {
  if (typeof window === "undefined" || !window.localStorage) return undefined;
  try {
    const raw = window.localStorage.getItem(LAST_ROOM_STORAGE_KEY);
    if (raw && typeof raw === "string") return raw;
  } catch (err) {
    console.warn("Failed to load last roomId", err);
  }
  return undefined;
};

const persistLastRoomId = (roomId?: string) => {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    if (!roomId) {
      window.localStorage.removeItem(LAST_ROOM_STORAGE_KEY);
    } else {
      window.localStorage.setItem(LAST_ROOM_STORAGE_KEY, roomId);
    }
  } catch (err) {
    console.warn("Failed to persist last roomId", err);
  }
};

const persistSession = (session?: SessionData) => {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    if (!session) {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
      persistLastRoomId(undefined);
    } else {
      const entry: PersistedSession = { ...session, savedAt: Date.now() };
      window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(entry));
      persistLastRoomId(session.roomId);
    }
  } catch (err) {
    console.warn("Failed to persist session", err);
  }
};

// Reflects which room we're in directly in the address bar (/table/CODE) so
// the URL is meaningful to share/bookmark and isn't identical across every
// stage of the app. Goes through the router's own imperative navigate()
// (not raw history.pushState/replaceState) so React Router's internal
// location state stays in sync -- a raw pushState would move the address
// bar without the router ever noticing, leaving it to route the NEXT
// navigation from a stale idea of where we are.
//
// Entering a genuinely NEW room (the address bar didn't already say this
// roomId) gets its own history entry, so the browser Back button returns to
// the lobby instead of leaving the site outright -- see the popstate
// listener below, which is what actually tears the room down when that
// happens. Every other call -- re-confirming the room already reflected in
// the URL (a reconnect's resume ack fires this on every reconnect, not just
// the first) or clearing it (left/kicked/closed) -- replaces in place. We
// don't want a duplicate entry per reconnect, or a phantom "back into the
// room" entry left behind once the room's already gone.
const setUrlRoomId = (roomId?: string) => {
  if (typeof window === "undefined") return;
  try {
    const currentRoomId = window.location.pathname.match(ROOM_PATH_RE)?.[1];
    const next = roomId ? `/table/${encodeURIComponent(roomId)}` : "/";
    if (roomId && roomId !== currentRoomId) {
      router.navigate(next);
    } else {
      router.navigate(next, { replace: true });
    }
  } catch {
    /* ignore -- URL sync is a nicety, never worth breaking the app over */
  }
};

const persistRoundHistory = (roomId: string | undefined, history: CompletedRoundSummary[]) => {
  if (!roomId || typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(historyKey(roomId), JSON.stringify(history.slice(0, 50)));
  } catch (err) {
    console.warn("Failed to persist round history", err);
  }
};

const loadRoundHistory = (roomId: string | undefined): CompletedRoundSummary[] => {
  if (!roomId || typeof window === "undefined" || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(historyKey(roomId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as CompletedRoundSummary[];
  } catch (err) {
    console.warn("Failed to load round history", err);
  }
  return [];
};

// The server's RoundHistoryEntry is deliberately compact (no cards/deck) --
// turned into a CompletedRoundSummary shape so it can slot into the same
// list/export/stats code as a live-tracked round. `busted` rides along on
// each synthesized Turn since statusDisplay can't derive it without cards.
const serverEntryToSummary = (entry: RoundHistoryEntry): CompletedRoundSummary => ({
  roundId: entry.roundId,
  roundNumber: entry.roundNumber,
  completedAt: entry.completedAt,
  balances: [],
  turns: entry.entries.map((e) => ({
    player: { id: e.playerId, firstName: e.name, lastName: "", type: e.role, presence: "offline" },
    state: e.outcome,
    cards: [],
    bet: e.bet,
    busted: e.busted,
  })),
});

// Merges the server's durable (but compact) roundHistory into whatever the
// client already has, adding only rounds the client doesn't already know
// about -- this is what lets history survive a cleared cache or a fresh
// device, without discarding the richer, card-complete entries the client
// tracked live this session.
const mergeServerHistory = (
  clientHistory: CompletedRoundSummary[],
  serverEntries: RoundHistoryEntry[] | undefined
): CompletedRoundSummary[] => {
  if (!serverEntries?.length) return clientHistory;
  const existingIds = new Set(clientHistory.map((h) => h.roundId));
  const backfill = serverEntries.filter((e) => !existingIds.has(e.roundId)).map(serverEntryToSummary);
  if (!backfill.length) return clientHistory;
  return [...clientHistory, ...backfill].sort((a, b) => b.roundNumber - a.roundNumber).slice(0, 50);
};

const DEFAULT_WS_PORT = 3001;

function computeDefaultWsUrl(): string {
  if (typeof window === "undefined") return `ws://localhost:${DEFAULT_WS_PORT}`;
  const { protocol, hostname } = window.location;
  const wsProtocol = protocol === "https:" ? "wss" : "ws";

  // If we are served from the public domain, hard-point to the tunnel host.
  if (hostname.endsWith("kvitlach.us")) {
    return `${wsProtocol}://ws.kvitlach.us`;
  }

  if (/-\d+\.app\.github\.dev$/.test(hostname)) {
    // GitHub Codespaces encode the port inside the subdomain, so swap in the WS port.
    return `${wsProtocol}://${hostname.replace(/-\d+\.app\.github\.dev$/, `-${DEFAULT_WS_PORT}.app.github.dev`)}`;
  }

  return `${wsProtocol}://${hostname}:${DEFAULT_WS_PORT}`;
}

// Prefer build-time injection; otherwise, default to the public tunnel host.
const WS_URL = import.meta.env.VITE_WS_URL ?? "wss://ws.kvitlach.us";

type SetState = Parameters<StateCreator<UIState>>[0];
type GetState = Parameters<StateCreator<UIState>>[1];

const initialSession = loadSession();

const creator: StateCreator<UIState> = (set: SetState, get: GetState) => {
  const client = new WSClient(WS_URL);
  let connectTimer: ReturnType<typeof setTimeout> | undefined;
  // requestId of the room:resume sent automatically from onOpen (if any), so
  // a resulting room_not_found can be told apart from one caused by a user
  // manually submitting the join form with a mistyped room code -- both
  // produce the identical error shape from the server (see ws-server.ts's
  // room:join/room:resume handlers), so requestId is the only reliable way
  // to distinguish "silently clear a stale auto-resume" from "show the user
  // their typo".
  let autoResumeRequestId: string | undefined;
  // requestIds for banker "settings" actions that otherwise have no visible
  // result -- the ManageDrawer is a popover the banker might already have
  // closed by the time the ack lands, so success/failure has to surface as a
  // notification (seen from anywhere) rather than inline form state.
  let pendingWatermarkRequestId: string | undefined;
  let pendingReshuffleRequestId: string | undefined;
  let pendingRoundStartRequestId: string | undefined;
  // Practice mode now has its own lobby card, separate from the Join Game
  // form (see App.tsx) -- routing its errors through the generic join/create
  // fallback below would risk surfacing them under the wrong card, so this
  // gets the same tracked-requestId treatment as the other actions above.
  let pendingPracticeRequestId: string | undefined;

  // Every notification (round outcomes, deck reshuffles, rename/buy-in
  // approvals, bank top-ups, ...) is built through this one factory, so
  // scheduling the auto-dismiss here covers all of them without having to
  // remember it at each call site. Auto-dismissing an ID already gone
  // (manually dismissed, or aged out of the 5-notification cap elsewhere)
  // is a harmless no-op -- the filter just doesn't match anything.
  const NOTIFICATION_AUTO_DISMISS_MS = 18000;
  const makeNotification = (message: string, tone: NotificationTone): UINotification => {
    const notification: UINotification = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      message,
      tone,
    };
    setTimeout(() => {
      set((state: UIState) => ({ notifications: state.notifications.filter((n) => n.id !== notification.id) }));
    }, NOTIFICATION_AUTO_DISMISS_MS);
    return notification;
  };

  // The server flips deckReshuffledAt to a new timestamp every time (and
  // only when) a fresh shoe comes into play -- diff against the round
  // already in state so this fires once per reshuffle, not on every one of
  // the many round:state broadcasts that follow it.
  const deckReshuffleNotification = (
    prevRound: RoundState | undefined,
    nextRound: RoundState
  ): UINotification | undefined => {
    if (!nextRound.deckReshuffledAt || nextRound.deckReshuffledAt === prevRound?.deckReshuffledAt) return undefined;
    return makeNotification("Fresh deck shuffled in -- the shoe ran low.", "info");
  };

  // Folds a round that's about to be replaced into the running shoe-scoped
  // discard tally DiscardPile/DiscardPileModal show ("what's come out of the
  // CURRENT shoe," not just the round in progress -- see 2026-08-11's
  // "discard pile should last until the deck is reshuffled" report: a shoe
  // runs through several rounds before it's thin enough to reshuffle, and
  // the review only ever showed whichever one was still live). Two cases:
  //   * A genuine reshuffle (deckReshuffledAt just changed) wipes the tally
  //     outright -- none of the old shoe's discards belong to the new one,
  //     not even the ones from whatever round was still live when the
  //     reshuffle landed.
  //   * Otherwise, whatever the OUTGOING round had already resolved --
  //     exactly what discardedEntries(prevRound.turns) computes right now --
  //     gets folded in before it's replaced, the same way round:ended
  //     already folds a finished round into roundHistory.
  // Known gap, not fixed here: store.ts's reshuffleDeck can swap the shoe
  // MID-round (deckReshuffledAt changes, roundId doesn't) -- cards that
  // round already resolved before the swap were drawn from the OLD shoe, but
  // turn.cards carries no per-card timestamp to separate "before" from
  // "after," so this still wipes on the change and then re-counts whatever
  // that same round resolves afterward as if it were all post-reshuffle.
  // Rare (an explicit banker action mid-hand), and there's no data here to
  // do better with.
  const advanceShoeDiscards = (
    prevRound: RoundState | undefined,
    nextRound: RoundState,
    prevShoeDiscards: DiscardEntry[]
  ): DiscardEntry[] => {
    if (nextRound.deckReshuffledAt && nextRound.deckReshuffledAt !== prevRound?.deckReshuffledAt) return [];
    if (!prevRound || prevRound.roundId === nextRound.roundId) return prevShoeDiscards;
    return [...prevShoeDiscards, ...discardedEntries(prevRound.turns)];
  };

  // Fires once, for the viewer specifically, the moment their OWN turn
  // resolves to a terminal state -- whether that's an immediate bust/21
  // mid-round or the standby -> won/lost resolution at round-terminate.
  // Diffed the same way as the deck-reshuffle notice: only when the
  // viewer's turn state actually CHANGES into won/lost this update, not on
  // every subsequent re-broadcast of an already-resolved turn.
  const outcomeNotification = (
    prevRound: RoundState | undefined,
    nextRound: RoundState,
    playerId: string | undefined
  ): UINotification | undefined => {
    if (!playerId) return undefined;
    const nextTurn = nextRound.turns.find((t) => t.player.id === playerId);
    if (!nextTurn || (nextTurn.state !== "won" && nextTurn.state !== "lost")) return undefined;
    const prevTurn =
      prevRound?.roundId === nextRound.roundId ? prevRound?.turns.find((t) => t.player.id === playerId) : undefined;
    if (prevTurn && (prevTurn.state === "won" || prevTurn.state === "lost")) return undefined;
    if (isPushTurn(nextTurn)) return makeNotification("Push -- your wager is returned.", "info");
    if (nextTurn.state === "won") return makeNotification("You won this hand!", "success");
    const { total, bustedTotal } = bestTotal(nextTurn.cards);
    const busted = total === undefined && bustedTotal !== undefined;
    return makeNotification(busted ? "You Futched!" : "You lost this hand.", "error");
  };

  // Public, table-wide, and deliberately NOT gated to `playerId` like
  // outcomeNotification above -- a real table hears an Eleveroon save called
  // out loud, whoever it happens to. Every client independently diffs the
  // same broadcast round state (this mirrors deckReshuffleNotification's
  // "only on an actual change" shape), so this fires once for everyone at
  // the table, including the player it happened to -- not just whoever's
  // bet/hit cards happen to still be hidden from the rest of the table (see
  // Seat.tsx's `hide` logic -- the specific card can stay concealed while
  // this announcement still goes out, same as a verbal call-out would).
  const eleveroonNotification = (
    prevRound: RoundState | undefined,
    nextRound: RoundState
  ): UINotification | undefined => {
    if (!prevRound || prevRound.roundId !== nextRound.roundId) return undefined;
    for (const turn of nextRound.turns) {
      // Guards against a partial/malformed turn object the same way the
      // deckReshuffle/outcome checks above tolerate one -- this runs on
      // every broadcast for every client, so a crash here is worse than a
      // skipped notification.
      if (!turn?.player?.id || !turn.cards) continue;
      const prevTurn = prevRound.turns.find((t) => t?.player?.id === turn.player.id);
      const prevCount = prevTurn?.cards?.length ?? 0;
      const newlyIgnored = turn.cards.slice(prevCount).some((c) => c.attributes?.eleveroonIgnored);
      if (newlyIgnored) {
        const name =
          [turn.player.firstName, turn.player.lastName].filter(Boolean).join(" ") || turn.player.firstName || "A player";
        return makeNotification(`Eleveroon! ${name} just saved a busting eleven.`, "success");
      }
    }
    return undefined;
  };

  // Public, table-wide, same shape as eleveroonNotification above -- a BANK!
  // wager that leaves seats still waiting forces the banker straight into a
  // fresh hand, and the server overwrites their turn with that redeal in the
  // very same update that resolves the frame which just finished. Without
  // this, nobody at the table ever sees what that frame actually did -- only
  // the bank's wallet total quietly moving (2026-08-10 bug hunt; see
  // TASKS.md and store.ts's settleBankOutcome). Diffed by `settledAt`, not
  // presence, since the field is never cleared back to undefined between
  // frames -- see BankFrameResult in types.ts.
  const bankFrameNotification = (
    prevRound: RoundState | undefined,
    nextRound: RoundState
  ): UINotification | undefined => {
    // Same guard as eleveroonNotification, and for the same reason: a client
    // that just connected (fresh join, or reconnecting mid-round) has no
    // prevRound to diff against, and firing off whatever frame happened to
    // already be sitting on the round would replay a stale event as if it
    // just happened.
    if (!prevRound || prevRound.roundId !== nextRound.roundId) return undefined;
    const frame = nextRound.lastBankFrame;
    if (!frame || frame.settledAt === prevRound.lastBankFrame?.settledAt) return undefined;
    const { total, bustedTotal } = bestTotal(frame.cards);
    const busted = total === undefined && bustedTotal !== undefined;
    const headline = busted
      ? `Bank Futched with a ${bustedTotal}`
      : total === 21
        ? "Bank hit 21!"
        : `Bank showed ${total ?? "--"}`;
    const record =
      frame.beat === undefined || frame.lostTo === undefined
        ? ""
        : frame.beat === 0 && frame.lostTo === 0
          ? " (no wagers)"
          : frame.lostTo === 0
            ? ` (beat ${frame.beat})`
            : frame.beat === 0
              ? ` (lost to ${frame.lostTo})`
              : ` (beat ${frame.beat}, lost ${frame.lostTo})`;
    const tone: NotificationTone = busted ? "error" : total === 21 ? "success" : "info";
    return makeNotification(`${headline}${record} -- new hand dealt to keep the table live.`, tone);
  };

  const analyzeRoomTransition = (state: UIState, nextRoom: RoomState): Partial<UIState> => {
    const updates: Partial<UIState> = { room: nextRoom };
    let history = state.roundHistory;
    if (!history.length || state.room?.roomId !== nextRoom.roomId) {
      const hydratedHistory = loadRoundHistory(nextRoom.roomId);
      if (hydratedHistory.length) history = hydratedHistory;
    }
    // Backfill from the server's durable copy every time -- covers rounds
    // that finished on a device/session this client never saw live.
    const merged = mergeServerHistory(history, nextRoom.roundHistory);
    if (merged !== state.roundHistory) {
      updates.roundHistory = merged;
      if (merged !== history) persistRoundHistory(nextRoom.roomId, merged);
    }
    const playerId = state.playerId;
    const prevRoom = state.room;

    // If we have a playerId and were just removed from the room (kicked), clear the
    // per-room session so we don't auto-reconnect as that player again.
    if (playerId && prevRoom && prevRoom.roomId === nextRoom.roomId) {
      const wasPresent = prevRoom.players.some((p) => p.id === playerId);
      const stillPresent = nextRoom.players.some((p) => p.id === playerId);
      if (wasPresent && !stillPresent) {
        clearRoomSession(nextRoom.roomId);
        persistSession(undefined);
        setUrlRoomId(undefined);
        updates.session = undefined;
        updates.playerId = undefined;
        updates.round = undefined;
        updates.shoeDiscards = [];
      }
    }

    if (!playerId || !prevRoom) return updates;

    let notifications = state.notifications;
    let mutated = false;

    const prevRename = prevRoom.renameRequests.find((req) => req.playerId === playerId);
    const nextRename = nextRoom.renameRequests.find((req) => req.playerId === playerId);
    if (prevRename && !nextRename) {
      const prevPlayer = prevRoom.players.find((p) => p.id === playerId);
      const nextPlayer = nextRoom.players.find((p) => p.id === playerId);
      const nameChanged = Boolean(
        (prevPlayer?.firstName ?? "") !== (nextPlayer?.firstName ?? "") ||
          (prevPlayer?.lastName ?? "") !== (nextPlayer?.lastName ?? "")
      );
      const targetName = [nextPlayer?.firstName, nextPlayer?.lastName]
        .filter(Boolean)
        .join(" ")
        .trim();
      const message = nameChanged
        ? `Banker approved your name change${targetName ? ` to ${targetName}` : ""}.`
        : "Banker declined your name change request.";
      const tone: NotificationTone = nameChanged ? "success" : "error";
      notifications = [...notifications, makeNotification(message, tone)];
      mutated = true;
    }

    const prevBuyIn = prevRoom.buyInRequests.find((req) => req.playerId === playerId);
    const nextBuyIn = nextRoom.buyInRequests.find((req) => req.playerId === playerId);
    if (prevBuyIn && !nextBuyIn) {
      const prevWallet = prevRoom.wallets?.[playerId] ?? 0;
      const nextWallet = nextRoom.wallets?.[playerId] ?? 0;
      const approved = nextWallet >= prevWallet + prevBuyIn.amount;
      const amountLabel = `$${prevBuyIn.amount}`;
      const message = approved
        ? `Banker approved your ${amountLabel} chip request.`
        : `Banker declined your ${amountLabel} chip request.`;
      const tone: NotificationTone = approved ? "success" : "error";
      notifications = [...notifications, makeNotification(message, tone)];
      mutated = true;
    }

    if (mutated) updates.notifications = notifications.slice(-5);
    return updates;
  };

  const handleMessage = (msg: ServerEnvelope) => {
    if (msg.type === "room:state" && msg.payload)
      set((state: UIState) => analyzeRoomTransition(state, msg.payload as RoomState));
    if (msg.type === "round:state" && msg.payload) {
      set((state: UIState) => {
        const nextRound = msg.payload as RoundState;
        const notifications = [
          deckReshuffleNotification(state.round, nextRound),
          outcomeNotification(state.round, nextRound, state.playerId),
          eleveroonNotification(state.round, nextRound),
          bankFrameNotification(state.round, nextRound),
        ].filter((n): n is UINotification => Boolean(n));
        return {
          round: nextRound,
          shoeDiscards: advanceShoeDiscards(state.round, nextRound, state.shoeDiscards),
          notifications: notifications.length ? [...state.notifications, ...notifications].slice(-5) : state.notifications,
        };
      });
    }
    if (msg.type === "round:ended") {
      const payload = (msg.payload as any) || {};
      const balances = payload.balances ?? [];
      const roundFromPayload = payload.round as RoundState | undefined;
      set((s: UIState) => {
        const currentRound = roundFromPayload ?? s.round;
        const inferredRoundNumber =
          currentRound?.roundNumber ?? s.room?.completedRounds ?? s.roundHistory[0]?.roundNumber ?? 0;
        const summary = currentRound
          ? {
              roundId: currentRound.roundId,
              roundNumber: currentRound.roundNumber ?? inferredRoundNumber,
              turns: currentRound.turns.map((turn) => ({
                ...turn,
                cards: turn.cards.map((card) => ({
                  ...card,
                  attributes: {
                    ...card.attributes,
                    values: [...card.attributes.values],
                  },
                })),
              })),
              balances: balances ?? [],
              completedAt: Date.now(),
            }
          : undefined;
        const existing = summary
          ? s.roundHistory.filter((r) => r.roundId !== summary.roundId)
          : s.roundHistory;
        const nextHistory = summary ? [summary, ...existing].slice(0, 50) : existing;
        if (summary && (s.room?.roomId || currentRound?.roomId)) {
          persistRoundHistory(s.room?.roomId ?? currentRound?.roomId, nextHistory);
        }
        return {
          balances: [...balances, ...s.balances],
          roundHistory: nextHistory,
        };
      });
      return;
    }
    if (msg.type === "room:connections") {
      const payload = (msg.payload as any) || {};
      const players = (payload.players as ConnectionSummary[]) || [];
      set({ connections: players });
      return;
    }
    if (msg.type === "room:closed") {
      set((s: UIState) => {
        const roomId = s.room?.roomId;
        if (roomId) {
          clearRoomSession(roomId);
          persistSession(undefined);
          setUrlRoomId(undefined);
        }
        return {
          room: undefined,
          round: undefined,
          shoeDiscards: [],
          balances: [],
          playerId: undefined,
          session: undefined,
          notifications: [...s.notifications, makeNotification("The banker has closed this session.", "info")].slice(-5),
        };
      });
      return;
    }
    if (msg.type === "room:banker-topup") {
      const payload = (msg.payload as any) || {};
      set((state: UIState) => {
        const bankerName = "Banker";
        const amountValue = typeof payload.amount === "number" ? payload.amount : undefined;
        const amountLabel = typeof amountValue === "number" ? `$${Math.abs(amountValue)}` : "chips";
        const direction =
          typeof amountValue === "number" ? (amountValue > 0 ? "added" : "removed") : "adjusted";
        const preposition = direction === "removed" ? "from" : "to";
        const totalLabel = typeof payload.total === "number" ? `$${payload.total}` : undefined;
        const noteSuffix = payload.note ? ` (${payload.note})` : "";
        const summary =
          direction === "adjusted"
            ? `${bankerName} adjusted the bank${noteSuffix}`
            : `${bankerName} ${direction} ${amountLabel} ${preposition} the bank${noteSuffix}`;
        const totalSentence = totalLabel ? ` Bank now holds ${totalLabel}.` : "";
        const message = `${summary}.${totalSentence}`;
        const last = state.notifications[state.notifications.length - 1];
        if (last?.message === message) return { notifications: state.notifications };
        const notifications = [...state.notifications, makeNotification(message, "info")].slice(-5);
        return { notifications };
      });
      return;
    }
    if (msg.type === "player:bank-adjusted") {
      const payload = (msg.payload as any) || {};
      set((state: UIState) => {
        const actorName = "Banker";
        const targetId = typeof payload.playerId === "string" ? payload.playerId : msg.playerId;
        const target = state.room?.players.find((p) => p.id === targetId);
        const targetName = [target?.firstName, target?.lastName].filter(Boolean).join(" ").trim() || "Player";
        const amountValue = typeof payload.amount === "number" ? payload.amount : undefined;
        const amountLabel = typeof amountValue === "number" ? `$${Math.abs(amountValue)}` : "chips";
        const direction = amountValue && amountValue < 0 ? "removed" : "added";
        const preposition = direction === "removed" ? "from" : "to";
        const totalLabel = typeof payload.total === "number" ? `$${payload.total}` : undefined;
        const noteSuffix = payload.note ? ` (${payload.note})` : "";
        const summary = `${actorName} ${direction} ${amountLabel} ${preposition} ${targetName}'s stack${noteSuffix}`;
        const totalSentence = totalLabel ? ` ${targetName} now has ${totalLabel}.` : "";
        const message = `${summary}.${totalSentence}`;
        const last = state.notifications[state.notifications.length - 1];
        if (last?.message === message) return { notifications: state.notifications };
        const notifications = [...state.notifications, makeNotification(message, "info")].slice(-5);
        return { notifications };
      });
      return;
    }
    if (msg.type === "round:banker-ended") {
      set({ bankerSummaryAt: Date.now() });
      return;
    }
    if (msg.type === "error" && msg.error) {
      const errorMessage = msg.error?.message;
      const isAutoResumeError = Boolean(msg.requestId && msg.requestId === autoResumeRequestId);
      if (isAutoResumeError) autoResumeRequestId = undefined;
      const isWatermarkError = Boolean(msg.requestId && msg.requestId === pendingWatermarkRequestId);
      if (isWatermarkError) pendingWatermarkRequestId = undefined;
      const isReshuffleError = Boolean(msg.requestId && msg.requestId === pendingReshuffleRequestId);
      if (isReshuffleError) pendingReshuffleRequestId = undefined;
      if (isWatermarkError || isReshuffleError) {
        const friendly =
          errorMessage === "forbidden"
            ? "Only the banker can do that."
            : errorMessage === "round_not_found"
            ? "That round has already ended."
            : "Something went wrong. Please try again.";
        set((state: UIState) => ({
          notifications: [...state.notifications, makeNotification(friendly, "error")].slice(-5),
        }));
        return;
      }
      const isRoundStartError = Boolean(msg.requestId && msg.requestId === pendingRoundStartRequestId);
      if (isRoundStartError) pendingRoundStartRequestId = undefined;
      if (isRoundStartError) {
        // round:start never sets pendingAction (that's bet/hit/stand/skip
        // only), so without this an error here fell through to the generic
        // branch below and landed in formErrors.join -- a form that isn't
        // even rendered once you're already in a room. See the felt-table
        // "start round" flow, which is the only caller of this action.
        const friendly =
          errorMessage === "deck_low"
            ? get().room?.practice === true
              // Manage table is admin-gated, so a practice room's human can't
              // reach it -- they have the felt's own Reshuffle button instead
              // (see the deck_empty branch below for the same split).
              ? "Not enough cards left in the shoe for everyone this round. Hit Reshuffle on the table, then deal again."
              : "Not enough cards left in the shoe for everyone this round. Open Manage table → Reshuffle deck, then deal again."
            : errorMessage === "not_enough_players"
            ? "Need at least one seated player before dealing."
            : "Something went wrong. Please try again.";
        set((state: UIState) => ({
          notifications: [...state.notifications, makeNotification(friendly, "error")].slice(-5),
        }));
        return;
      }
      const isPracticeError = Boolean(msg.requestId && msg.requestId === pendingPracticeRequestId);
      if (isPracticeError) pendingPracticeRequestId = undefined;
      if (isPracticeError) {
        // Inline, not a notification: unlike round:start/watermark/reshuffle
        // (fired from a popover the banker might have already closed), this
        // form is the only place this action can even be triggered from, and
        // it's still on screen the instant the ack comes back.
        const friendly =
          errorMessage === "practice_capacity"
            ? "Practice tables are full right now. Please try again in a few minutes."
            : errorMessage === "maintenance_mode"
            ? "New games are temporarily paused for maintenance. Existing games are unaffected. Check back soon."
            : "Something went wrong. Please try again.";
        set((state: UIState) => ({
          formErrors: { ...state.formErrors, practice: friendly },
        }));
        return;
      }
      if (errorMessage === "deck_empty") {
        // Can arrive on ANY bet/hit, not just a tracked admin action -- the
        // shoe ran out mid-hand and the dealer has to choose to bring in a
        // fresh one (see GameStore's drawCard). This has to actually reach
        // whoever's on the felt, which the generic branch below can't do:
        // nothing in the felt view renders `message` (see App.tsx, which
        // only shows it in the pre-join lobby) -- so this pushes a toast
        // instead, and tailors it to whether the viewer can act on it.
        const viewerId = get().playerId;
        const isBanker = get().room?.players.find((p) => p.id === viewerId)?.type === "admin";
        // The practice case is neither of the other two and has to be called
        // out separately: that human is a type: "player", so they used to get
        // the "waiting for the banker" line -- advice that never comes true,
        // because a practice room's banker is a BOT that will never reshuffle.
        // They're the one who has to do it, via the felt's own Reshuffle
        // button (TableRoot.tsx), and Manage table is admin-gated and out of
        // reach for them, so neither existing string was pointing anywhere
        // they could actually go.
        const isPractice = get().room?.practice === true;
        const friendly = isPractice
          ? "The shoe just ran out of cards. Hit Reshuffle on the table to bring in a fresh one, then try again."
          : isBanker
          ? "The shoe just ran out of cards. Open Manage table → Reshuffle deck to bring in a fresh one, then try again."
          : "The shoe just ran out of cards. Waiting for the banker to reshuffle.";
        set((state: UIState) => {
          const update: Partial<UIState> = {
            notifications: [...state.notifications, makeNotification(friendly, "error")].slice(-5),
          };
          if (msg.requestId && state.pendingAction?.requestId === msg.requestId) update.pendingAction = undefined;
          return update;
        });
        return;
      }
      if (errorMessage === "invalid_session") {
        const priorRoom = get().session?.roomId || get().room?.roomId;
        if (priorRoom) persistLastRoomId(priorRoom);
        persistSession(undefined);
        setUrlRoomId(undefined);
        // Do NOT clear per-room session on invalid_session — the server session token
        // lasts 7 days but the per-room localStorage key lasts 21 days (ROOM_SESSION_
        // MAX_AGE_MS, matching the server's own room-inactivity GC window). If the
        // server restarted (in-memory state lost) or the token simply expired, the user
        // should fall through to the join form, not have their room session wiped.
        // We only clear it on explicit leave.
      }
      set((state: UIState) => {
          const update: Partial<UIState> = {};
        if (msg.requestId && state.pendingAction?.requestId === msg.requestId) update.pendingAction = undefined;
        if (errorMessage === "invalid_session") {
          update.session = undefined;
          update.room = undefined;
          update.round = undefined;
          update.shoeDiscards = [];
          update.playerId = undefined;
          update.message = "Session expired. Rejoin the game.";
          return update;
        }
        // room_not_found from the automatic resume-on-connect attempt = stale
        // auto-resume; clear silently. A room_not_found from a manual join
        // (or any other action) falls through to the friendly-message branch
        // below instead, so a mistyped room code isn't swallowed silently.
        if (errorMessage === "room_not_found" && isAutoResumeError) {
          setUrlRoomId(undefined);
          update.session = undefined;
          update.room = undefined;
          update.round = undefined;
          update.shoeDiscards = [];
          update.playerId = undefined;
          return update;
        }
        const pendingType = state.pendingAction?.type;
        const friendly =
          errorMessage === "maintenance_mode"
            ? "New games are temporarily paused for maintenance. Existing games are unaffected. Check back soon."
            : errorMessage === "room_not_found"
            ? "Room not found. Check the room ID and try again."
            : errorMessage === "room_full"
            ? "This table is full (100 players max). Try a different room."
            : errorMessage === "invalid_password"
            ? "Incorrect password."
            : errorMessage === "insufficient_bank"
            ? "Cannot remove more chips than the bank holds."
            : errorMessage === "bank_locked"
            ? "Bank showdown in progress. Please wait."
            : errorMessage === "banker_deciding"
            ? "Banker must decide how to proceed."
            : errorMessage === "bank_empty"
            ? "Bank has no chips left."
            : errorMessage === "turn_not_pending"
            ? "That action already went through."
            : errorMessage === "not_your_turn"
            ? "It's not your turn yet."
            : errorMessage === "banker_not_absent"
            ? "The banker is back — the round can carry on."
            : errorMessage === "banker_not_absent_long_enough"
            ? "Give the banker another moment to reconnect."
            : errorMessage === "forbidden"
            ? "Only the banker can perform that action."
            : errorMessage === "invalid_bank_amount"
            ? "Bank wager must equal the remaining bank."
            : errorMessage === "bank_not_in_decision"
            ? "No bank decision is pending."
            : errorMessage === "rate_limited"
            ? "Too many requests. Please slow down."
            : errorMessage === "invalid_payload"
            ? "Something went wrong. Please try again."
            : (errorMessage ?? "Something went wrong.").replace(/_/g, " ");
        if (pendingType === "bet" || pendingType === "hit" || pendingType === "stand" || pendingType === "skip") {
          update.message = friendly;
        } else if (errorMessage === "maintenance_mode") {
          update.formErrors = { ...state.formErrors, create: friendly };
        } else {
          const nextErrors = { ...state.formErrors, join: friendly };
          update.formErrors = nextErrors;
        }
        return update;
      });
      return;
    }
    if (msg.type === "reaction:new") {
      const reaction = (msg.payload as ReactionEvent | undefined) as ReactionEvent | undefined;
      if (!reaction || !reaction.playerId || !reaction.emoji || !reaction.reactedAt) return;
      set((state: UIState) => {
        const cutoff = Date.now() - 10000;
        const trimmed = state.reactions.filter((r) => r.reactedAt > cutoff);
        const next = [...trimmed, reaction].slice(-20);
        return { reactions: next };
      });
      setTimeout(() => {
        set((state: UIState) => ({
          reactions: state.reactions.filter(
            (r) => !(r.playerId === reaction.playerId && r.reactedAt === reaction.reactedAt && r.emoji === reaction.emoji)
          ),
        }));
      }, 10000);
      return;
    }
    if (msg.type === "ack") {
      if (msg.requestId && msg.requestId === autoResumeRequestId) autoResumeRequestId = undefined;
      if (msg.requestId && msg.requestId === pendingWatermarkRequestId) {
        pendingWatermarkRequestId = undefined;
        set((state: UIState) => ({
          notifications: [...state.notifications, makeNotification("Table label saved.", "success")].slice(-5),
        }));
      }
      if (msg.requestId && msg.requestId === pendingReshuffleRequestId) {
        pendingReshuffleRequestId = undefined;
        // Generic on purpose -- this fires for both the between-round and
        // the mid-round path now, and "ready for the next round" would read
        // oddly for the latter (a hand is still actually in progress).
        set((state: UIState) => ({
          notifications: [...state.notifications, makeNotification("Fresh shoe shuffled in.", "success")].slice(-5),
        }));
      }
      set((state: UIState) => {
        const update: Partial<UIState> = { message: undefined };
        const nextErrors = { ...state.formErrors };
        const payload = (msg.payload as any) || {};
        if (payload.room) Object.assign(update, analyzeRoomTransition(state, payload.room as RoomState));
        if (payload.room) nextErrors.join = undefined;
        if (msg.requestId && state.pendingAction?.requestId === msg.requestId) update.pendingAction = undefined;
        if (payload.round) {
          const nextRound = payload.round as RoundState;
          update.shoeDiscards = advanceShoeDiscards(state.round, nextRound, state.shoeDiscards);
          update.round = nextRound;
          const newNotifications = [
            deckReshuffleNotification(state.round, nextRound),
            outcomeNotification(state.round, nextRound, state.playerId),
          ].filter((n): n is UINotification => Boolean(n));
          if (newNotifications.length) {
            update.notifications = [...(update.notifications ?? state.notifications), ...newNotifications].slice(-5);
          }
        }
        const sessionPayload = payload.session as SessionData | undefined;
        if (sessionPayload && sessionPayload.roomId && sessionPayload.playerId && sessionPayload.token) {
          persistSession(sessionPayload);
          setUrlRoomId(sessionPayload.roomId);
          update.session = sessionPayload;
          update.playerId = sessionPayload.playerId;
          persistLastRoomId(sessionPayload.roomId);
          // Also persist per-room session for URL-param-based reconnect.
          const playerFromPayload = payload.player as { firstName?: string; lastName?: string } | undefined;
          const existingPlayer = state.room?.players.find((p) => p.id === sessionPayload.playerId);
          const firstName = playerFromPayload?.firstName ?? existingPlayer?.firstName;
          const lastName = playerFromPayload?.lastName ?? existingPlayer?.lastName;
          persistRoomSession(sessionPayload, firstName, lastName);
        } else if (payload.player) {
          update.playerId = payload.player.id;
        }
        update.formErrors = nextErrors;
        return update;
      });
    }
  };

  client.onMessage(handleMessage);
  client.onOpen(() => {
    if (connectTimer) clearTimeout(connectTimer);
    connectTimer = undefined;
    set({ status: "connected", message: undefined, pendingAction: undefined });

    // Priority 1: URL param ?room=ROOMID — try per-room saved session first.
    const urlRoomId = getUrlRoomId();
    if (urlRoomId) {
      const roomSession = loadRoomSession(urlRoomId);
      if (roomSession) {
        autoResumeRequestId = client.send("room:resume", { roomId: roomSession.roomId, playerId: roomSession.playerId, token: roomSession.token });
        persistLastRoomId(roomSession.roomId);
        return;
      }
      // /table/:roomId with no matching per-room session -- a stale or
      // invalid bookmark/link. Unlike ?room=, this URL shape implies actual
      // room membership, so leaving it as-is while the lobby renders would
      // be misleading (address bar says "you're at this table", the page
      // says otherwise). Fold it back into the ?room= query form, which
      // App.tsx's own pre-fill effect already reads -- same helpful
      // "Game ID filled in" outcome as an ordinary invite link, just
      // reached from a stale table URL. Harmless if priority 2 below goes
      // on to resume a DIFFERENT room -- that success path calls
      // setUrlRoomId with the real roomId and overwrites this.
      if (window.location.pathname.match(ROOM_PATH_RE)) {
        router.navigate(`/?room=${encodeURIComponent(urlRoomId)}`, { replace: true });
      }
    }

    // Priority 2: In-memory or single-key localStorage session (existing behavior).
    const session = get().session ?? loadSession();
    if (session) {
      autoResumeRequestId = client.send("room:resume", session);
      persistLastRoomId(session.roomId);
    }
  });
  client.onClose(() => {
    if (connectTimer) clearTimeout(connectTimer);
    connectTimer = undefined;
    set({ status: "disconnected", message: get().message, pendingAction: undefined });
  });
  client.onError(() => set({ status: "disconnected", message: `WebSocket error. Tried ${WS_URL}`, pendingAction: undefined }));

  // Shared by leaveGame (the explicit "Leave" button) and the popstate
  // listener below (the browser Back button while in a room) -- both need
  // to tear the session down the same way before navigating away.
  const teardownRoomSession = () => {
    const roomId = get().room?.roomId ?? get().session?.roomId;
    if (roomId) clearRoomSession(roomId);
    persistSession(undefined);
    // Close the socket before navigating: an in-flight room:resume ack
    // (e.g. one sent right after the 1.5s auto-reconnect, landing just as
    // the user leaves) would otherwise still be able to fire after the
    // clears above and re-persist a session, undoing the leave.
    get().client.close();
  };

  // The browser Back button while in a room. setUrlRoomId (above) only ever
  // pushes a new history entry when entering a room, so a popstate here
  // always means "leave the room, back to the lobby" -- there's no other
  // in-app screen to return to. Tear the session down exactly like the
  // explicit Leave button, then reload: the browser has already moved the
  // address bar back to "/" by the time this fires, so reload (not assign)
  // re-renders the lobby there without pushing yet another history entry on
  // top of the one we just popped.
  if (typeof window !== "undefined") {
    window.addEventListener("popstate", () => {
      if (get().room) {
        teardownRoomSession();
        window.location.reload();
      }
    });
  }

  return {
    client,
    status: "disconnected",
    balances: [],
    roundHistory: [],
    shoeDiscards: [],
    reactions: [],
    wsUrl: WS_URL,
    pendingAction: undefined,
    formErrors: {},
    notifications: [],
    bankerSummaryAt: undefined,
    session: initialSession,
    init: () => {
      set({ status: "connecting", message: undefined });
      if (connectTimer) clearTimeout(connectTimer);
      connectTimer = setTimeout(() => {
        set({ status: "disconnected", message: `Cannot reach ${WS_URL}. Is the backend running and accessible?` });
      }, 2500);
      client.connect(() => set({ status: "connecting" }));
    },
      createRoom: (firstName: string, lastName?: string, roomName?: string, password?: string, buyIn?: number, roomId?: string, bankerBankroll?: number) => {
      if (!firstName) {
        set((s) => ({ formErrors: { ...s.formErrors, create: "Enter a first name to create a room." } }));
        return;
      }
        const trimmedRoomId = roomId?.trim() || undefined;
        client.send("room:create", { firstName, lastName, roomName, password, buyIn, roomId: trimmedRoomId, bankerBankroll });
    },
    // An options object rather than createRoom's positional style: four
    // same-typed optional numbers in a row would be an easy mix-up
    // (buyIn/bankBuyIn especially) at every call site.
    createPracticeRoom: (firstName: string, options?: { botCount?: number; buyIn?: number; bankBuyIn?: number; deckCount?: number }) => {
      if (!firstName) {
        set((s) => ({ formErrors: { ...s.formErrors, practice: "Enter a first name to start a practice game." } }));
        return;
      }
      pendingPracticeRequestId = client.send("room:create-practice", { firstName, ...options });
    },
    joinRoom: (roomId: string, firstName: string, lastName?: string, password?: string, spectator?: boolean) => {
      if (!roomId) {
        set((s) => ({ formErrors: { ...s.formErrors, join: "Enter a room ID to join." } }));
        return;
      }
      if (!firstName) {
        set((s) => ({ formErrors: { ...s.formErrors, join: "Enter a first name to join." } }));
        return;
      }
      client.send("room:join", { roomId, firstName, lastName, password, spectator: Boolean(spectator) });
    },
    startRound: (deckCount?: number) => {
      const roomId = get().room?.roomId;
      if (!roomId) {
        set({ message: "Create or join a game first." });
        return;
      }
      // Tracked the same way as the watermark/reshuffle actions: round:start
      // never set pendingAction (that's reserved for bet/hit/stand/skip), so
      // an error here used to fall through to the generic branch's "else"
      // case and land in formErrors.join -- a form that isn't even rendered
      // once you're already in a room. deck_low in particular needs to
      // actually reach the banker.
      pendingRoundStartRequestId = client.send("round:start", { roomId, deckCount });
    },
    bet: (amount: number, options?: { bank?: boolean; eleveroon?: boolean }) => {
      const roundId = get().round?.roundId;
      const playerId = get().playerId;
      if (get().pendingAction) return;
      if (!roundId) {
        set({ message: "No active round." });
        return;
      }
      if (!playerId) {
        set({ message: "Player session unavailable. Rejoin the game." });
        return;
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        set({ message: "Enter a valid bet amount." });
        return;
      }
      const requestId = client.send("turn:bet", {
        roundId,
        amount,
        playerId,
        bank: Boolean(options?.bank),
        eleveroon: Boolean(options?.eleveroon),
      });
      set({ pendingAction: { requestId, type: "bet" } });
    },
    hit: (options?: { eleveroon?: boolean }) => {
      const roundId = get().round?.roundId;
      const playerId = get().playerId;
      if (get().pendingAction) return;
      if (!roundId) {
        set({ message: "No active round." });
        return;
      }
      if (!playerId) {
        set({ message: "Player session unavailable. Rejoin the game." });
        return;
      }
      const requestId = client.send("turn:hit", { roundId, playerId, eleveroon: Boolean(options?.eleveroon) });
      set({ pendingAction: { requestId, type: "hit" } });
    },
    stand: () => {
      const roundId = get().round?.roundId;
      const playerId = get().playerId;
      if (get().pendingAction) return;
      if (!roundId || !playerId) return;
      const requestId = client.send("turn:stand", { roundId, playerId });
      set({ pendingAction: { requestId, type: "stand" } });
    },
    sendReaction: (emoji: string) => {
      if (!emoji) return;
      client.send("player:react", { emoji });
    },
    skip: (playerId?: string) => {
      const roundId = get().round?.roundId;
      const actorId = get().playerId;
      if (!roundId || !actorId) return;
      if (get().pendingAction) return;
      const requestId = client.send("turn:skip", { roundId, playerId, actorId });
      set({ pendingAction: { requestId, type: "skip" } });
    },
    requestRename: (firstName: string, lastName?: string) => {
      const roomId = get().room?.roomId;
      const playerId = get().playerId;
      if (!roomId || !playerId) {
        set({ message: "Join a game before updating your name." });
        return;
      }
      const trimmedFirst = firstName.trim();
      if (!trimmedFirst) {
        set({ message: "Enter a first name before submitting." });
        return;
      }
      client.send("player:rename-request", { roomId, firstName: trimmedFirst, lastName });
    },
    approveRename: (playerId: string) => {
      const roomId = get().room?.roomId;
      if (!roomId) return;
      client.send("player:rename-approve", { roomId, playerId });
    },
    rejectRename: (playerId: string) => {
      const roomId = get().room?.roomId;
      if (!roomId) return;
      client.send("player:rename-reject", { roomId, playerId });
    },
    requestBuyIn: (amount: number, note?: string) => {
      const roomId = get().room?.roomId;
      const playerId = get().playerId;
      if (!roomId || !playerId) {
        set({ message: "Join a game before requesting chips." });
        return;
      }
      const normalizedAmount = Math.round(Number(amount));
      if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
        set({ message: "Enter a valid amount." });
        return;
      }
      client.send("player:buyin-request", { roomId, amount: normalizedAmount, note });
    },
    practiceTopUp: () => {
      const roomId = get().room?.roomId;
      if (!roomId) return;
      client.send("player:practice-topup", { roomId });
    },
    approveBuyIn: (playerId: string) => {
      const roomId = get().room?.roomId;
      if (!roomId) return;
      client.send("player:buyin-approve", { roomId, playerId });
    },
    rejectBuyIn: (playerId: string) => {
      const roomId = get().room?.roomId;
      if (!roomId) return;
      client.send("player:buyin-reject", { roomId, playerId });
    },
    topUpBanker: (amount: number, note?: string) => {
      const roomId = get().room?.roomId;
      const playerId = get().playerId;
      if (!roomId || !playerId) {
        set({ message: "Join a game before adjusting the bank." });
        return;
      }
      const player = get().room?.players.find((p) => p.id === playerId);
      if (player?.type !== "admin") {
        set({ message: "Only the banker can adjust the bankroll." });
        return;
      }
      const normalizedAmount = Math.round(Number(amount));
      if (!Number.isFinite(normalizedAmount) || normalizedAmount === 0) {
        set({ message: "Enter a non-zero amount." });
        return;
      }
      const currentWallet = get().room?.wallets?.[playerId] ?? 0;
      if (normalizedAmount < 0 && currentWallet + normalizedAmount < 0) {
        set({ message: "Cannot remove more chips than the bank holds." });
        return;
      }
      client.send("room:banker-topup", { roomId, amount: normalizedAmount, note });
    },
    endRoundDueToBank: () => {
      const roomId = get().room?.roomId;
      const playerId = get().playerId;
      if (!roomId || !playerId) return;
      const player = get().room?.players.find((p) => p.id === playerId);
      if (player?.type !== "admin") {
        set({ message: "Only the banker can end the round." });
        return;
      }
      client.send("round:banker-end", { roomId });
    },
    // Deliberately not admin-gated, unlike everything else that ends a round:
    // this exists precisely because the admin is the one who has gone.
    voidAbandonedRound: () => {
      const roomId = get().room?.roomId;
      if (!roomId) return;
      client.send("round:void-abandoned", { roomId });
    },
    dismissBankerSummary: () => set({ bankerSummaryAt: undefined }),
    setFormError: (form, message) => {
      set((state: UIState) => ({ formErrors: { ...state.formErrors, [form]: message } }));
    },
    dismissNotification: (id: string) => {
      set((state: UIState) => ({ notifications: state.notifications.filter((note) => note.id !== id) }));
    },
    kickPlayer: (playerId: string) => {
      const roomId = get().room?.roomId;
      const actorId = get().playerId;
      if (!roomId || !actorId) {
        set({ message: "Join a game first." });
        return;
      }
      const actor = get().room?.players.find((p) => p.id === actorId);
      if (actor?.type !== "admin") {
        set({ message: "Only the banker can remove players." });
        return;
      }
      client.send("player:kick", { roomId, playerId });
    },
    adjustPlayerBankroll: (playerId: string, amount: number, note?: string) => {
      const roomId = get().room?.roomId;
      const actorId = get().playerId;
      if (!roomId || !actorId) {
        set({ message: "Join a game first." });
        return;
      }
      const actor = get().room?.players.find((p) => p.id === actorId);
      if (actor?.type !== "admin") {
        set({ message: "Only the banker can adjust wallets." });
        return;
      }
      const normalizedAmount = Math.round(Number(amount));
      if (!Number.isFinite(normalizedAmount) || normalizedAmount === 0) {
        set({ message: "Enter a non-zero chip amount." });
        return;
      }
      client.send("player:bank-adjust", { roomId, playerId, amount: normalizedAmount, note });
    },
    setFeltWatermark: (text: string) => {
      const roomId = get().room?.roomId;
      const actorId = get().playerId;
      if (!roomId || !actorId) {
        set({ message: "Join a game first." });
        return;
      }
      const actor = get().room?.players.find((p) => p.id === actorId);
      if (actor?.type !== "admin") {
        set({ message: "Only the banker can set the table watermark." });
        return;
      }
      pendingWatermarkRequestId = client.send("room:set-watermark", { roomId, text });
    },
    reshuffleDeck: () => {
      const roomId = get().room?.roomId;
      const actorId = get().playerId;
      if (!roomId || !actorId) {
        set({ message: "Join a game first." });
        return;
      }
      const actor = get().room?.players.find((p) => p.id === actorId);
      // Mirrors the server's own carve-out (store.ts's reshuffleDeck) rather
      // than being stricter than it: a practice room's banker is a BOT with no
      // session, so the one human there is a type: "player" and is who has to
      // bring in a fresh shoe. This guard used to be a bare admin check, which
      // meant the practice-only Reshuffle button (TableRoot.tsx, added for
      // exactly this human) never got its message off the client -- it set
      // this error instead. A practice table was then unrecoverable the moment
      // its shoe ran out, which is every ~8 rounds by design
      // (TARGET_ROUNDS_PER_SHOE): can't deal, can't reshuffle, nothing to do
      // but leave. The backend carve-out and its test were both already right;
      // only this line disagreed with them.
      const isPractice = get().room?.practice === true;
      if (!(actor?.type === "admin" || (isPractice && actor?.type === "player"))) {
        set({ message: "Only the banker can reshuffle the deck." });
        return;
      }
      // Deliberately no "finish the round first" guard here anymore -- the
      // banker can choose to bring in a fresh shoe mid-round too (see
      // ManageDrawer's stronger confirmation copy for that case). The server
      // is the actual authority on whether this is allowed.
      pendingReshuffleRequestId = client.send("room:reshuffle-deck", { roomId });
    },
    closeRoom: () => {
      const roomId = get().room?.roomId;
      const actorId = get().playerId;
      if (!roomId || !actorId) return;
      const actor = get().room?.players.find((p) => p.id === actorId);
      if (actor?.type !== "admin") {
        set({ message: "Only the banker can close the session." });
        return;
      }
      client.send("room:close", { roomId });
    },
    leaveGame: () => {
      teardownRoomSession();
      // A hard navigation (not just clearing in-memory state) is deliberate:
      // the existing WebSocket stays attached server-side to this room/player,
      // so anything short of tearing down the socket would let the next
      // broadcast from that still-live room silently repopulate state and
      // undo the "leave". Reloading also resets the URL and gives everyone --
      // stale session or active game -- the same clean way back to the join
      // screen.
      if (typeof window !== "undefined") window.location.assign("/");
    },
  };
};

export const useGameStore = create<UIState>(creator);
