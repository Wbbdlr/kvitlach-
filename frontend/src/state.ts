import { create, StateCreator } from "zustand";
import { activeProfile, storedSlug } from "./familyProfile";
import { errorCopy } from "./errorCopy";
import { WSClient } from "./ws";
import { Balance, LedgerEntry, RoomState, RoundHistoryEntry, RoundState, ServerEnvelope, Turn, ConnectionSummary } from "./types";
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

/**
 * What survives the table being closed, so the night doesn't just vanish.
 *
 * `room:closed` wipes room/round/playerId/session -- it has to, or a stale
 * room repopulates from the next broadcast (see the handler). But that left
 * every player except the banker with a toast and nothing else: no final
 * standings, and no way to export, because the export reads room.roomId,
 * room.name and room.players, all of which had just been cleared. After a
 * two-hour night that is the last frame everyone sees.
 *
 * So the pieces the summary screen and the export need are lifted out BEFORE
 * the wipe. `rounds` is the same array roundHistory already holds (no copy --
 * completed rounds are never mutated in place), which is also why standings
 * are recomputed from it via tableStandings rather than stored: one source.
 */
export interface GameOverSummary {
  roomId?: string;
  roomName?: string;
  /** Who this device was at that table -- drives "your night" and the personal export. */
  playerId?: string;
  wasBanker: boolean;
  closedAt: number;
  rounds: CompletedRoundSummary[];
  /** Chips moved by hand -- the export needs these after the room is gone. */
  ledger: LedgerEntry[];
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
  gameOver?: GameOverSummary;
  dismissGameOver: () => void;
  init: () => void;
  createRoom: (firstName: string, lastName?: string, roomName?: string, password?: string, buyIn?: number, roomId?: string, bankerBankroll?: number) => void;
  createPracticeRoom: (firstName: string, options?: { roomName?: string; botCount?: number; buyIn?: number; bankBuyIn?: number; deckCount?: number }) => void;
  joinRoom: (
    roomId: string,
    firstName: string,
    lastName?: string,
    password?: string,
    spectator?: boolean,
    allowDuplicateName?: boolean
  ) => void;
  /**
   * The one question a join is ever stopped for: an EMPTY seat under this
   * name with chips still on it. "Is this you coming back, or a different
   * Rivka?" -- a real question at a family table, and the only one whose
   * wrong answer costs somebody their stack.
   *
   * A same-named player who is still connected raises no question at all:
   * that is plainly somebody else, they are seated without being asked, and
   * the server tags the name so the felt can tell them apart.
   *
   * The attempt is kept so either answer can be acted on without making the
   * player retype a name and password they just entered.
   */
  seatPrompt?: {
    roomId: string;
    firstName: string;
    lastName?: string;
    password?: string;
  };
  /** A claim sent, waiting on the banker. */
  seatClaimPending?: { roomId: string; wallet: number };
  claimSeat: () => void;
  joinAsSomeoneElse: () => void;
  dismissSeatPrompt: () => void;
  approveSeatClaim: (claimId: string) => void;
  rejectSeatClaim: (claimId: string) => void;
  // The admin panel's Watch link, which is NOT joinRoom(spectator: true). That
  // seats a named spectator the table can see; this subscribes with no player
  // identity at all. `watching` is what the felt keys its read-only mode off:
  // there is no playerId to infer it from, and an undefined playerId is also
  // what a still-connecting player has.
  watchRoom: (roomId: string, token: string) => void;
  watching: boolean;
  notifications: UINotification[];
  dismissNotification: (id: string) => void;
  setFormError: (form: "join" | "create" | "round" | "global" | "practice", message?: string) => void;
  formErrors: Partial<Record<"join" | "create" | "round" | "global" | "practice", string>>;
  // Whether the server has told us a code is needed, and what the player has
  // typed. Kept at the top level rather than per-form: one code covers
  // creating, joining and practice, so three copies would just be three
  // places to forget to fill in.
  accessCode: string;
  accessCodeRequired: boolean;
  setAccessCode: (code: string) => void;
  startRound: (deckCount?: number) => void;
  bet: (amount: number, options?: { bank?: boolean; eleveroon?: boolean }) => void;
  hit: (options?: { eleveroon?: boolean }) => void;
  stand: () => void;
  skip: (playerId?: string) => void;
  standFor: (playerId: string) => void;
  sendReaction: (emoji: string) => void;
  requestRename: (firstName: string, lastName?: string) => void;
  approveRename: (playerId: string) => void;
  rejectRename: (playerId: string) => void;
  requestBuyIn: (amount: number, note?: string) => void;
  practiceTopUp: () => void;
  practiceTopUpBank: (amount: number) => void;
  approveBuyIn: (playerId: string) => void;
  rejectBuyIn: (playerId: string) => void;
  topUpBanker: (amount: number, note?: string) => void;
  endRoundDueToBank: () => void;
  endGameAfterBankDecision: () => void;
  passBankToPlayer: (targetPlayerId: string) => void;
  voidAbandonedRound: () => void;
  dismissBankerSummary: () => void;
  kickPlayer: (playerId: string) => void;
  adjustPlayerBankroll: (playerId: string, amount: number, note?: string) => void;
  setFeltWatermark: (text: string) => void;
  setTurnSeconds: (seconds: number) => void;
  setDeckCount: (decks: number) => void;
  /**
   * serverClock - deviceClock, in ms, measured off the last round snapshot.
   *
   * Every timestamp the server sends (a turn's expiry, a reaction's `at`) is
   * on ITS clock, and the felt was comparing them against the device's. A
   * phone with a hand-set clock therefore ran a turn timer that was wrong by
   * exactly that much -- invisible while the timer was only a bar, and
   * unmissable now that the bar has a number beside it.
   *
   * Zero on a device that agrees with the server, which is almost all of
   * them, so this normally changes nothing.
   */
  clockSkewMs: number;
  undoLastCorrection: () => void;
  reshuffleDeck: () => void;
  /**
   * Dismisses the held BANK! frame and, at a computer table, releases the bot
   * banker that was waiting on it. Harmless at a live table, where nothing is
   * held server-side -- the server answers with released: false and the panel
   * simply closes.
   */
  acknowledgeBankFrame: (settledAt?: number) => void;
  closeRoom: () => void;
  /** Disconnect but keep the seat, the stack and the way back. */
  stepAway: () => void;
  /** Give up the seat for good -- the server removes it, chips and all. */
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

// The grant on an admin panel Watch link. Read straight from the URL on every
// connect rather than stashed in state, because it has to survive a reload of
// the tab, and deliberately NOT persisted to localStorage: it authorises
// watching one table for 30 minutes and should die with the tab, not linger
// where a later ordinary player on the same browser could pick it up.
export const getUrlWatchToken = (): string | undefined => {
  if (typeof window === "undefined") return undefined;
  try {
    const token = new URLSearchParams(window.location.search).get("watch");
    return token ? token.trim() : undefined;
  } catch {
    return undefined;
  }
};

// Exported because App.tsx's lobby needs the same read to prefill the room
// field, and was doing it inline instead -- hardcoding the key string a second
// time, and without the guard or try/catch below. localStorage getItem THROWS
// when site data is blocked (a strict privacy setting, some corporate
// policies), so that inline copy took the whole lobby down for those users
// rather than just not prefilling a field.
// The platform can be put into invite-only mode from the admin page (see
// backend/src/access.ts). The client cannot know that before it tries -- the
// mode is not published anywhere unauthenticated, deliberately -- so the flow
// is: try, get told `invite_required`, show the field, retry. The code is
// remembered so a household types it once rather than once per person per
// visit, and it is stored next to the room id rather than in the session blob
// because it outlives any one table.
const ACCESS_CODE_STORAGE_KEY = "kvitlach.accessCode";

export const loadAccessCode = (): string => {
  if (typeof window === "undefined" || !window.localStorage) return "";
  try {
    return window.localStorage.getItem(ACCESS_CODE_STORAGE_KEY) ?? "";
  } catch (err) {
    console.warn("Failed to load access code", err);
    return "";
  }
};

const persistAccessCode = (code: string) => {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    if (code) window.localStorage.setItem(ACCESS_CODE_STORAGE_KEY, code);
    else window.localStorage.removeItem(ACCESS_CODE_STORAGE_KEY);
  } catch (err) {
    console.warn("Failed to persist access code", err);
  }
};

// Player-requested, 2026-09-04: the Disclaimer's age/legal language ("by
// playing, you agree you are of legal age...") was a passive sentence on a
// page most people never open before joining -- an active checkbox at every
// point that actually starts play (Join, Create, Practice; NOT Watch, which
// never wagers or "plays" in that sense) closes the gap between the claim and
// what's actually confirmed. Remembered rather than re-asked every time, same
// reasoning and same shape as the access code above: a returning player
// should not re-confirm on every table they join.
//
// Scoped per form, NOT one shared flag -- tried a single flag first (check
// it on Join, Practice shows checked too, same load) and it read as one
// checkbox silently controlling three, which is not what "I confirm" means
// on a form you never touched. Same key shape, one segment longer, so each
// of the three still gets its own remembered state.
export type AgeAckScope = "join" | "create" | "practice";

const ageAckStorageKey = (scope: AgeAckScope): string => `kvitlach.ageAck.${scope}`;

export const loadAgeAcknowledged = (scope: AgeAckScope): boolean => {
  if (typeof window === "undefined" || !window.localStorage) return false;
  try {
    return window.localStorage.getItem(ageAckStorageKey(scope)) === "1";
  } catch (err) {
    console.warn("Failed to load age acknowledgement", err);
    return false;
  }
};

export const persistAgeAcknowledged = (scope: AgeAckScope, value: boolean): void => {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    if (value) window.localStorage.setItem(ageAckStorageKey(scope), "1");
    else window.localStorage.removeItem(ageAckStorageKey(scope));
  } catch (err) {
    console.warn("Failed to persist age acknowledgement", err);
  }
};

export const loadLastRoomId = (): string | undefined => {
  if (typeof window === "undefined" || !window.localStorage) return undefined;
  try {
    const raw = window.localStorage.getItem(LAST_ROOM_STORAGE_KEY);
    if (raw && typeof raw === "string") return raw;
  } catch (err) {
    console.warn("Failed to load last roomId", err);
  }
  return undefined;
};

// The lobby's "you were at table X" row offers a way to say "not me". It has
// to clear the SAME key the prefill reads, so it lives here next to it rather
// than reaching into localStorage from a component.
export const forgetLastRoom = () => persistLastRoomId(undefined);

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
  // NO auto-hit follows a confirmed BANK!, deliberately.
  //
  // One used to: a BANK! wagers the bank's whole window, and the reasoning
  // was that a seat that committed everything had already decided to take
  // another card. It was broken from the day it was written (it fired inside
  // the window where pendingAction blocks every action, so it was swallowed
  // every time) and only actually reached a player once that was fixed --
  // who reported it immediately: "when i confirmed BANK! it gave me TWO
  // cards instead of once".
  //
  // They are right, and the rule is on their side. A bet of any size deals
  // exactly one card (handleBet, backend/src/round.ts); BANK! is a bet, not
  // a different kind of move, and nothing in docs/GAME_RULES.md says
  // otherwise. The bank lock stays at stage "player" for exactly as long as
  // that seat is pending, so they can hit or stand as normal -- the wager
  // being large is a reason to leave the next card to the player, not to
  // take it out of their hands.
  // pendingAction gates every gameplay action (each of bet/hit/stand/skip
  // opens with `if (get().pendingAction) return`) so a double-tap can't fire
  // the same move twice. Nothing but a matching ack or error ever cleared
  // it, and neither is guaranteed to arrive: one dropped frame on a flaky
  // phone connection that keeps the socket itself open leaves that player
  // unable to bet, hit, stand OR skip for the rest of the round -- silently,
  // since the guard returns without a word, and with no way back short of a
  // reload they have no reason to think would help. (Socket-level drops are
  // already covered: onClose/onError clear it. This is specifically the
  // reply that never comes back on a socket that stayed up.)
  //
  // 10s is far longer than any real round trip here but well inside the
  // server's own 90s turn timer, so the escape hatch lands while the player
  // still has time to actually retry the move.
  const PENDING_ACTION_TIMEOUT_MS = 10_000;
  // Which of the three lobby forms was last submitted. The access gate is
  // per-action now (create can need a code while join stays open), so an
  // `invite_required` has to land on the form the player is actually looking
  // at -- and nothing in the error envelope says which that was.
  let lastLobbyAction: "create" | "join" | "practice" | undefined;
  let lastJoinAttempt: { roomId: string; firstName: string; lastName?: string; password?: string } | undefined;
  let pendingJoinRequestId: string | undefined;
  let pendingClaimRequestId: string | undefined;
  // Which room the player last tried to JOIN by hand. Only ever read to
  // decide whether a room_not_found means the remembered table is gone (see
  // the error handler), and never to decide anything about the round.
  let lastJoinAttemptRoomId: string | undefined;

  let pendingActionTimer: ReturnType<typeof setTimeout> | undefined;
  const beginPendingAction = (requestId: string, type: "bet" | "hit" | "stand" | "skip") => {
    if (pendingActionTimer) clearTimeout(pendingActionTimer);
    pendingActionTimer = setTimeout(() => {
      pendingActionTimer = undefined;
      // Only lift the lock if THIS request is still the one being waited on.
      // A late-but-arrived ack may already have cleared it and a newer
      // action taken its place -- clearing that one would reintroduce the
      // double-fire this guard exists to prevent.
      if (get().pendingAction?.requestId !== requestId) return;
      // Same reason the refusal branch toasts: `message` is rendered only by
      // App.tsx's lobby branch, so an action that never reached the table
      // released the controls and said nothing at the felt -- the player is
      // left tapping a button that appears to do nothing.
      const dropped = "That didn't reach the table - try again.";
      set((state: UIState) => ({
        pendingAction: undefined,
        message: dropped,
        notifications: [...state.notifications, makeNotification(dropped, "error")].slice(-5),
      }));
    }, PENDING_ACTION_TIMEOUT_MS);
    set({ pendingAction: { requestId, type } });
  };
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
  // Was 18s, unmeasured -- reported as staying up too long, and with up to
  // 5 stacked (the slice(-5) cap below) a slow-draining stack reads as
  // clutter rather than history. Dropped to 8s, then to 6s (still reported
  // as lingering): long enough to read one outcome sentence, short enough
  // that the stack actually clears between hands.
  const NOTIFICATION_AUTO_DISMISS_MS = 6000;
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
    return makeNotification("Fresh deck shuffled in - the shoe ran low.", "info");
  };

  // Who this round left behind, said out loud exactly once -- on the first
  // broadcast of a new roundId, not on every one of the dozens that follow.
  //
  // The exclusion has always been correct: startRound cannot deal to a phone
  // that is off. What it never did was TELL anybody, and the two people who
  // needed telling need opposite sentences. The player who was left out saw
  // the table playing without them and had no way to know why; the banker
  // saw a full player list and no sign that the round was short a seat.
  // Everyone else is told nothing, because the empty chair is already on the
  // felt in front of them.
  //
  // Deduped on the round id it last announced rather than on a prev/next
  // diff, which is what every other notification here uses. That difference
  // is load-bearing, and a live run is what found it: ws-server's room:resume
  // BROADCASTS round:state before it sends the ack, so a reconnecting player
  // receives the new round twice -- first on a broadcast where the store does
  // not yet know who they are (playerId arrives with the ack's session), then
  // on the ack, by which time a prev/next diff sees the same roundId and says
  // nothing. The person the message exists for got silence.
  let satOutAnnouncedFor: string | undefined;
  const satOutNotification = (
    _prevRound: RoundState | undefined,
    nextRound: RoundState,
    viewerId: string | undefined,
    room: RoomState | undefined
  ): UINotification | undefined => {
    const satOut = nextRound.satOutPlayerIds ?? [];
    if (satOut.length === 0) return undefined;
    if (nextRound.roundId === satOutAnnouncedFor) return undefined;
    // Only claimed once there is somebody to tell -- a broadcast that lands
    // before the session does must not consume the announcement.
    if (!viewerId) return undefined;
    satOutAnnouncedFor = nextRound.roundId;
    if (viewerId && satOut.includes(viewerId)) {
      return makeNotification(
        "You were disconnected when this round was dealt, so you're sitting it out. You're back in for the next one.",
        "info"
      );
    }
    const isBanker = room?.players?.find((p) => p.id === viewerId)?.type === "admin";
    if (!isBanker) return undefined;
    const names = satOut
      .map((id) => {
        const player = room?.players?.find((p) => p.id === id);
        return player ? [player.firstName, player.lastName].filter(Boolean).join(" ").trim() : undefined;
      })
      .filter((n): n is string => Boolean(n));
    if (names.length === 0) return undefined;
    const who = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
    return makeNotification(`${who} ${names.length === 1 ? "was" : "were"} offline and sat this round out.`, "info");
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
    const { total, bustedTotal } = bestTotal(nextTurn.cards);
    const busted = total === undefined && bustedTotal !== undefined;
    // The banker is not a wagering player, and this used to treat them as one.
    // They never put a bet down, so isPushTurn below was true for them at the
    // end of EVERY round -- meaning the person the whole table just settled
    // against was told "Push -- your wager is returned", win, lose or futch.
    // Found while testing the table-wide announcement (see
    // bankOutcomeNotification): the banker's half of "no alert when the banker
    // wins" was not a missing toast, it was a toast describing someone else's
    // situation. Second person, same wording as the table-wide version, so the
    // banker and the table are told the same story about the same hand.
    if (nextTurn.player?.type === "admin") {
      if (nextTurn.busted) {
        return makeNotification(`You futched with ${bustedTotal ?? "a bust"} - every hand still live wins.`, "error");
      }
      // A natural 21 beats the whole table outright, the same instant a bust
      // futches the bank -- it deserves the same kind of stand-out wording,
      // not the plain "stood on N" an ordinary showdown win gets. Same
      // total === 21 check selectors.ts's "BANK 21!" badge and App.tsx's
      // natural21 sound already use to tell this apart.
      if (nextTurn.state === "won" && total === 21) {
        return makeNotification("You hit 21 - everyone still in the hand loses!", "success");
      }
      return nextTurn.state === "won"
        ? makeNotification(`You stood on ${total ?? "--"} and took the round.`, "success")
        : makeNotification(`You stood on ${total ?? "--"} and finished down on the round.`, "info");
    }
    if (isPushTurn(nextTurn)) return makeNotification("Push - your wager is returned.", "info");
    if (nextTurn.state === "won") return makeNotification("You won this hand!", "success");
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
        return makeNotification(`Eleveroon! ${name} just avoided a futching eleven.`, "success");
      }
    }
    return undefined;
  };

  // Public, table-wide, same shape as eleveroonNotification above -- what the
  // BANK finally did, announced to everyone rather than only to the banker.
  //
  // The end of the banker's hand is the moment the whole table is waiting on:
  // they act last, every unresolved wager settles against them at once, and a
  // futched bank pays out every player still in the hand. Until now the only
  // signal was k-futch-flash in TableRoot, which (a) covers the futch and
  // nothing else -- a bank that simply WON said nothing at all -- and (b) is a
  // label inside the dock, so on a phone it replaces the words "Round
  // complete" in a row players have stopped looking at by then. Reported by a
  // tester as no alert coming up when the banker won or futched. There was no
  // alert; there was a caption.
  //
  // `busted`, not the "lost" turn state: a banker's turn also resolves to lost
  // when they merely end the round down on money (see CLAUDE.md), and calling
  // that a futch would be wrong on the one hand players care most about.
  const bankOutcomeNotification = (
    prevRound: RoundState | undefined,
    nextRound: RoundState,
    playerId: string | undefined
  ): UINotification | undefined => {
    // Same fresh-connection guard as eleveroonNotification below: without a
    // prevRound to diff, a client joining after the fact would replay a
    // finished round's result as if it had just happened.
    if (!prevRound || prevRound.roundId !== nextRound.roundId) return undefined;
    const banker = nextRound.turns.find((t) => t?.player?.type === "admin");
    if (!banker || (banker.state !== "won" && banker.state !== "lost")) return undefined;
    const before = prevRound.turns.find((t) => t?.player?.type === "admin");
    if (before && (before.state === "won" || before.state === "lost")) return undefined;
    // The banker's own client already had "You won this hand!" from
    // outcomeNotification a few lines up. Two toasts saying the same thing to
    // the same person is the exact duplication the bank-frame path was fixed
    // for once already.
    if (playerId && banker.player?.id === playerId) return undefined;
    const { total, bustedTotal } = bestTotal(banker.cards ?? []);
    if (banker.busted) {
      // Good news from every seat that is reading this, hence "success" on
      // what is nominally the bank losing.
      return makeNotification(
        `The bank futched with ${bustedTotal ?? "a bust"} - everyone still in the hand wins!`,
        "success"
      );
    }
    if (banker.state === "won") {
      // Same natural-21 special case as outcomeNotification's own banker
      // branch above (see its comment) -- bad news for the table this time,
      // hence "error" rather than the plain "info" an ordinary bank win gets.
      if (total === 21) {
        return makeNotification("Banker has 21 - everyone still in the hand loses.", "error");
      }
      return makeNotification(`The bank stood on ${total ?? "--"} and took the round.`, "info");
    }
    return makeNotification(`The bank stood on ${total ?? "--"} and finished down on the round.`, "info");
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
    return makeNotification(`${headline}${record} - new hand dealt to keep the table live.`, tone);
  };

  const analyzeRoomTransition = (state: UIState, nextRoom: RoomState): Partial<UIState> => {
    const updates: Partial<UIState> = { room: nextRoom };
    // Being in a room again is the one unambiguous signal that the last
    // night's summary is done with, whether it was dismissed or the player
    // just joined the next table straight past it.
    if (state.gameOver) updates.gameOver = undefined;
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

    // The BANKER's side of the same two queues. Everything below this block
    // tells a player what happened to the request they made; nothing told the
    // banker one had arrived. The request landed in room.renameRequests /
    // buyInRequests and waited there silently until they happened to open
    // Manage -- which on a phone is itself inside the collapsed chrome menu.
    // A player watching their "pending banker approval" line had no way to
    // know the banker had never been told.
    //
    // Fires once per arrival; the count on the Manage button (TableRoot's
    // pendingApprovals) is the part that persists until the queue is empty.
    // Named rather than counted -- "Sara wants chips" is actionable in a way
    // that "1 request" is not, and both queues are short by construction.
    const viewer = nextRoom.players.find((p) => p.id === playerId);
    if (viewer?.type === "admin") {
      const nameOf = (id: string) => {
        const p = nextRoom.players.find((player) => player.id === id);
        return [p?.firstName, p?.lastName].filter(Boolean).join(" ").trim() || "A player";
      };
      const arrived = <T extends { playerId: string; requestedAt: number }>(prev: T[], next: T[]) =>
        // requestedAt as well as playerId: re-requesting REPLACES the row for
        // that player (store.ts filters the old one out), so a second ask
        // after a decline is a new arrival with the same id.
        next.filter((n) => !prev.some((p) => p.playerId === n.playerId && p.requestedAt === n.requestedAt));

      for (const req of arrived(prevRoom.buyInRequests, nextRoom.buyInRequests)) {
        notifications = [
          ...notifications,
          makeNotification(`${nameOf(req.playerId)} is asking for $${req.amount} in chips.`, "info"),
        ];
        mutated = true;
      }
      for (const req of arrived(prevRoom.renameRequests, nextRoom.renameRequests)) {
        const to = [req.firstName, req.lastName].filter(Boolean).join(" ").trim();
        notifications = [
          ...notifications,
          makeNotification(`${nameOf(req.playerId)} wants to be called ${to}.`, "info"),
        ];
        mutated = true;
      }
    }

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

  const handleMessage = (incoming: ServerEnvelope) => {
    let msg = incoming;
    // Re-measured on every round snapshot rather than once at connect: a
    // device whose clock is corrected mid-game (an NTP sync, a manual fix)
    // would otherwise keep the stale offset for the rest of the night.
    // Rounds arrive on several paths -- round:state, and acks carrying a
    // round -- so this sits above all of them rather than in each.
    const roundish = (msg.payload as { round?: RoundState } | RoundState | undefined) ?? undefined;
    const stamped =
      (roundish as { round?: RoundState } | undefined)?.round ?? (roundish as RoundState | undefined);
    if (stamped && typeof stamped.serverNow === "number") {
      useGameStore.setState({ clockSkewMs: stamped.serverNow - Date.now() });
    }
    if (msg.type === "room:state" && msg.payload)
      set((state: UIState) => analyzeRoomTransition(state, msg.payload as RoomState));
    if (msg.type === "round:state" && msg.payload) {
      set((state: UIState) => {
        const nextRound = msg.payload as RoundState;
        const notifications = [
          deckReshuffleNotification(state.round, nextRound),
          satOutNotification(state.round, nextRound, state.playerId, state.room),
          outcomeNotification(state.round, nextRound, state.playerId),
          eleveroonNotification(state.round, nextRound),
          bankOutcomeNotification(state.round, nextRound, state.playerId),
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
        // Lifted out before the wipe below -- see GameOverSummary. No toast
        // any more: it said less than the screen that replaces it, and would
        // have sat on top of it.
        const gameOver: GameOverSummary = {
          roomId,
          roomName: s.room?.name,
          playerId: s.playerId,
          wasBanker: s.room?.players.find((p) => p.id === s.playerId)?.type === "admin",
          closedAt: Date.now(),
          rounds: s.roundHistory,
          ledger: s.room?.ledger ?? [],
        };
        return {
          room: undefined,
          round: undefined,
          shoeDiscards: [],
          balances: [],
          playerId: undefined,
          session: undefined,
          gameOver,
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
      // The refusal that is really a question. "You already have a seat here"
      // is not something a player can act on by reading it in a red box --
      // it needs a way to take the seat back, and a way to say you are a
      // different Rivka. Turned into a prompt here rather than left to
      // formErrors.join.
      const isJoinError = Boolean(msg.requestId && msg.requestId === pendingJoinRequestId);
      if (isJoinError && errorMessage === "seat_claimable") {
        pendingJoinRequestId = undefined;
        const attempt = lastJoinAttempt;
        if (attempt) {
          set({ seatPrompt: { ...attempt }, formErrors: {} });
          return;
        }
      }
      if (isJoinError) pendingJoinRequestId = undefined;
      const isClaimError = Boolean(msg.requestId && msg.requestId === pendingClaimRequestId);
      if (isClaimError) {
        pendingClaimRequestId = undefined;
        set((state: UIState) => ({
          seatClaimPending: undefined,
          formErrors: { ...state.formErrors, join: errorCopy(errorMessage) },
        }));
        return;
      }
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
        // Access refusals must NOT be handled here. This branch returns, so
        // anything it swallows never reaches the shared handler below that
        // raises the access-code banner -- and practice is one of the three
        // gated actions. Before this check, requiring a code for practice gave
        // the player "Something went wrong. Please try again." and no field to
        // type a code into: the button simply looked broken, permanently.
        if (errorMessage !== "invite_required" && errorMessage !== "invalid_invite" && errorMessage !== "locked_down") {
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
        // invite_required / invalid_invite / locked_down fall through.
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
        persistSession(undefined);
        // AFTER persistSession, not before: clearing the session also clears
        // the remembered room id (see persistSession), so re-saving it first
        // and dropping the session second threw away the very thing this line
        // exists to keep. The table is still there and only the token went
        // stale, so the Game ID the player needs is the one to leave in the
        // lobby's box -- which is what this could not actually do.
        if (priorRoom) persistLastRoomId(priorRoom);
        setUrlRoomId(undefined);
        // Do NOT clear per-room session on invalid_session - the server session token
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
          // Forget the table as well as the seat. invalid_session directly
          // above deliberately does the opposite -- it re-saves the room id,
          // because there the TABLE is still there and only the token went
          // stale, so prefilling the Game ID is exactly right. Here the room
          // itself is gone (ended, GC'd, or a practice table the server
          // restarted out of existence), and remembering it only means the
          // lobby opens with a dead code already typed into the Game ID box.
          // Reported from a fresh visit that showed a code from a table that
          // no longer existed: pressing Join then says "Room not found" about
          // something the player never typed.
          persistSession(undefined);
          const goneRoom = get().session?.roomId || get().room?.roomId;
          if (goneRoom) clearRoomSession(goneRoom);
          update.session = undefined;
          update.room = undefined;
          update.round = undefined;
          update.shoeDiscards = [];
          update.playerId = undefined;
          return update;
        }
        // The other half of the auto-resume branch above. A table the player
        // last sat at is remembered so the lobby can prefill its Game ID
        // (App.tsx's loadLastRoomId), and until now nothing ever unremembered
        // it once the auto-resume path stopped running -- which it does the
        // moment the session itself is gone. So a code for a table that ended
        // weeks ago sat in the box on every visit, and pressing Join answered
        // "Room not found" about something the player never typed.
        //
        // Pressing Join against that exact code is the server telling us it
        // is gone. Matched against the attempted id rather than cleared on
        // any room_not_found, so a mistyped code costs the player nothing.
        if (
          errorMessage === "room_not_found" &&
          !isAutoResumeError &&
          lastJoinAttemptRoomId &&
          lastJoinAttemptRoomId.trim().toUpperCase() === (loadLastRoomId() ?? "").trim().toUpperCase()
        ) {
          persistLastRoomId(undefined);
        }
        // Puts the message on the form that was actually submitted, falling
        // back to all three only when we somehow have no idea -- which is
        // still better than silently swallowing it.
        const lobbyErrors = (current: UIState["formErrors"], text: string) =>
          lastLobbyAction
            ? { ...current, [lastLobbyAction]: text }
            : { ...current, create: text, join: text, practice: text };
        const pendingType = state.pendingAction?.type;
        const friendly = errorCopy(errorMessage);
        // Anything refused while the player is AT A TABLE has to be visible at
        // the table. `message` below reaches only App.tsx's lobby branch
        // (`return room ? <TableRoot/> : <lobby/>`), and `formErrors` reaches
        // only the three lobby forms, so an in-room refusal that is not one of
        // the four turn actions had nowhere at all to land: it set state
        // nothing renders and the felt carried on as if nothing had happened.
        //
        // Found by pressing "Add to the bank" on a practice table and watching
        // the dialog close, the bank stay at zero and nothing be said - the
        // same failure shape as the 11.6 BANK! report, one release later,
        // through a message type that had not been written yet when that was
        // fixed. Toasting off `room` rather than off a list of message types
        // is what stops the next new action inheriting it too.
        const isTurnAction =
          pendingType === "bet" || pendingType === "hit" || pendingType === "stand" || pendingType === "skip";
        if (state.room && !isTurnAction) {
          update.notifications = [...state.notifications, makeNotification(friendly, "error")].slice(-5);
        }
        if (isTurnAction) {
          // A toast, because `message` below is rendered ONLY by the lobby
          // branch of App.tsx (`return room ? <TableRoot/> : <lobby/>`) -- so
          // at the felt, where every one of these four actions actually
          // happens, it went nowhere. Reported on 11.6 as BANK! being
          // accepted and then "just wouldn't deal a card, no matter how many
          // times": the server was refusing correctly and the client was
          // saying nothing at all. `message` is kept for the case where a
          // refusal lands while the player is back at the lobby.
          update.message = friendly;
          update.notifications = [...state.notifications, makeNotification(friendly, "error")].slice(-5);
          // Both of these can only come from creating a table, so they belong
          // on the create form. Without the room_capacity case they fell to
          // the join branch below and surfaced on a form the banker isn't
          // even looking at -- the same misrouting the round:start handler
          // above documents.
        } else if (errorMessage === "invite_required" || errorMessage === "invalid_invite") {
          // Unlike every other code here, these three can arrive from ANY of
          // the lobby's three forms (create, join, practice), and nothing in
          // the error envelope says which one the player was using. Rather
          // than guess a form and risk showing the message on one they are
          // not looking at -- the exact misrouting the room_capacity branch
          // below was added to fix -- this raises the shared access-code
          // banner, which sits above all three.
          update.accessCodeRequired = true;
          update.formErrors = lobbyErrors(state.formErrors, friendly);
        } else if (errorMessage === "locked_down") {
          // Same routing, but no code banner: in a closed mode a code would
          // not help, and offering a field that cannot work is worse than
          // offering no field at all.
          update.formErrors = lobbyErrors(state.formErrors, friendly);
        } else if (errorMessage === "maintenance_mode" || errorMessage === "room_capacity") {
          update.formErrors = { ...state.formErrors, create: friendly };
        } else {
          const nextErrors = { ...state.formErrors, join: friendly };
          update.formErrors = nextErrors;
        }
        return update;
      });
      return;
    }
    // Pushed from the admin page to everyone connected. Rendered through the
    // same notification stack as everything else rather than as its own
    // banner: it is one more thing the server has to say, and giving it a
    // bespoke surface would mean a second thing that can cover the felt.
    if (msg.type === "admin:notice") {
      const notice = msg.payload as { text?: string; level?: string } | undefined;
      const text = typeof notice?.text === "string" ? notice.text.trim().slice(0, 200) : "";
      if (text) {
        set((state: UIState) => ({
          notifications: [
            ...state.notifications,
            makeNotification(text, notice?.level === "warning" ? "error" : "info"),
          ].slice(-5),
        }));
      }
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
    // The banker said yes. This arrives unsolicited -- the claimant has no
    // session and is in no room, so nothing they sent is being answered --
    // but its payload is exactly an ack's (room + player + session), and the
    // ack branch below already knows how to adopt one: persist the session,
    // set the URL, remember the room, seat the player. Rewriting the type
    // here rather than repeating that block is the difference between one
    // adoption path and two that have to be kept in step.
    if (msg.type === "seat:claim-approved" && msg.payload) {
      useGameStore.setState({ seatClaimPending: undefined, seatPrompt: undefined });
      msg = { ...msg, type: "ack" };
    }
    if (msg.type === "seat:claim-rejected") {
      useGameStore.setState((state: UIState) => ({
        seatClaimPending: undefined,
        seatPrompt: undefined,
        formErrors: {
          ...state.formErrors,
          join: "The banker did not recognise that seat as yours. Join with a different name to take a new one.",
        },
      }));
      return;
    }
    // The claim was LODGED, not granted -- this payload deliberately carries
    // no room and no session. Nothing seats the player until the banker
    // answers and seat:claim-approved arrives above.
    if (msg.type === "ack" && msg.requestId && msg.requestId === pendingClaimRequestId) {
      pendingClaimRequestId = undefined;
      const claimPayload = (msg.payload as any) || {};
      useGameStore.setState({
        seatClaimPending: { roomId: claimPayload.roomId, wallet: Number(claimPayload.wallet) || 0 },
        seatPrompt: undefined,
        formErrors: {},
      });
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
        // Only when the server did NOT broadcast a round for this reshuffle.
        // A mid-round reshuffle goes out to the whole table as round:state
        // (which lands BEFORE this ack) and deckReshuffleNotification already
        // toasted it -- the banker was getting that plus this one, two
        // near-identical messages back to back for one action. Between
        // rounds there's no live round to broadcast, so this stays the only
        // feedback the banker gets, and has to keep firing.
        // The flag comes from the server rather than being inferred from
        // deckReshuffledAt: by ack time the broadcast has already been
        // applied to state, so the two cases are indistinguishable here.
        const broadcastRound = Boolean((msg.payload as any)?.broadcastRound);
        if (!broadcastRound) {
          // Generic on purpose -- "ready for the next round" would read
          // oddly if this ever fires with a hand still in progress.
          set((state: UIState) => ({
            notifications: [...state.notifications, makeNotification("Fresh shoe shuffled in.", "success")].slice(-5),
          }));
        }
      }
      set((state: UIState) => {
        const update: Partial<UIState> = { message: undefined };
        const nextErrors = { ...state.formErrors };
        const payload = (msg.payload as any) || {};
        if (payload.room) Object.assign(update, analyzeRoomTransition(state, payload.room as RoomState));
        if (payload.room) nextErrors.join = undefined;
        // Set from the ack, never inferred. Once true it stays true for the
        // life of the tab: nothing in a watcher's session can turn them into
        // a player, and clearing it on a later ack would hand them controls.
        if (payload.watching) update.watching = true;
        if (msg.requestId && state.pendingAction?.requestId === msg.requestId) update.pendingAction = undefined;
        if (payload.round) {
          const nextRound = payload.round as RoundState;
          update.shoeDiscards = advanceShoeDiscards(state.round, nextRound, state.shoeDiscards);
          update.round = nextRound;
          // Who this ack is FOR, not who the store currently thinks we are.
          // On a join or resume the session block below is what sets playerId,
          // and it runs after this one -- so state.playerId is still undefined
          // on exactly the ack a returning player receives. That is not an
          // edge case for the sat-out notice, it is the ONLY case: a player
          // left out of a round because they were disconnected necessarily
          // learns about it on the ack that reconnects them.
          const viewerId =
            (payload.session as SessionData | undefined)?.playerId ??
            (payload.player as { id?: string } | undefined)?.id ??
            state.playerId;
          const viewerRoom = (payload.room as RoomState | undefined) ?? state.room;
          const newNotifications = [
            deckReshuffleNotification(state.round, nextRound),
            satOutNotification(state.round, nextRound, viewerId, viewerRoom),
            // Deliberately still state.playerId: this one diffs against the
            // round already in state, and a resuming client has none, so
            // widening it here would toast a returning player about a hand
            // that finished while they were gone.
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

    // Priority 0: an admin Watch link. Must come before the resume paths --
    // a watcher has no session, so priority 1 would find none, decide the
    // /table/<id> URL was a stale bookmark and rewrite it to /?room=<id>,
    // dropping the token and dumping the operator on the lobby the first
    // time their connection blinked.
    const watchToken = getUrlWatchToken();
    if (watchToken) {
      const watchRoomId = getUrlRoomId();
      if (watchRoomId) {
        client.send("room:watch", { roomId: watchRoomId.trim().toUpperCase(), token: watchToken });
        return;
      }
    }

    // Priority 1: URL param ?room=ROOMID - try per-room saved session first.
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
    clockSkewMs: 0,
    accessCode: loadAccessCode(),
    accessCodeRequired: false,
    watching: false,
    setAccessCode: (code: string) => {
      const trimmed = code.trim();
      persistAccessCode(trimmed);
      set({ accessCode: trimmed });
    },
    notifications: [],
    bankerSummaryAt: undefined,
    gameOver: undefined,
    dismissGameOver: () => set({ gameOver: undefined }),
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
        lastLobbyAction = "create";
        // The banker's own family link, stamped onto the table so everyone who
        // joins sees it. storedSlug() rather than the fetched profile: the
        // fetch may not have landed yet on a fast create, and the slug is what
        // the server resolves anyway.
        client.send("room:create", { firstName, lastName, roomName, password, buyIn, roomId: trimmedRoomId, bankerBankroll, familyProfile: storedSlug() || undefined, accessCode: get().accessCode || activeProfile()?.accessCode || undefined });
    },
    // An options object rather than createRoom's positional style: four
    // same-typed optional numbers in a row would be an easy mix-up
    // (buyIn/bankBuyIn especially) at every call site.
    createPracticeRoom: (firstName: string, options?: { roomName?: string; botCount?: number; buyIn?: number; bankBuyIn?: number; deckCount?: number }) => {
      if (!firstName) {
        set((s) => ({ formErrors: { ...s.formErrors, practice: "Enter a first name to start a practice game." } }));
        return;
      }
      lastLobbyAction = "practice";
        pendingPracticeRequestId = client.send("room:create-practice", { firstName, ...options, familyProfile: storedSlug() || undefined, accessCode: get().accessCode || activeProfile()?.accessCode || undefined });
    },
    joinRoom: (
      roomId: string,
      firstName: string,
      lastName?: string,
      password?: string,
      spectator?: boolean,
      allowDuplicateName?: boolean
    ) => {
      if (!roomId) {
        set((s) => ({ formErrors: { ...s.formErrors, join: "Enter a room ID to join." } }));
        return;
      }
      if (!firstName) {
        set((s) => ({ formErrors: { ...s.formErrors, join: "Enter a first name to join." } }));
        return;
      }
      lastLobbyAction = "join";
      lastJoinAttemptRoomId = roomId;
      // Remembered for the seat prompt below, which has to be able to re-send
      // this exact join (or turn it into a claim) without making the player
      // retype a name and password they just entered.
      lastJoinAttempt = { roomId, firstName, lastName, password };
      pendingJoinRequestId = client.send("room:join", {
        roomId,
        firstName,
        lastName,
        password,
        spectator: Boolean(spectator),
        allowDuplicateName: Boolean(allowDuplicateName),
        // A family link may carry the code, so joining a gated table is still
        // one paste. A code typed by hand always wins over the carried one.
        accessCode: get().accessCode || activeProfile()?.accessCode || undefined,
      });
    },
    claimSeat: () => {
      const attempt = lastJoinAttempt;
      if (!attempt) return;
      set({ seatPrompt: undefined });
      pendingClaimRequestId = client.send("room:claim-seat", {
        roomId: attempt.roomId,
        firstName: attempt.firstName,
        lastName: attempt.lastName,
        password: attempt.password,
        // A family link may carry the code, so joining a gated table is still
        // one paste. A code typed by hand always wins over the carried one.
        accessCode: get().accessCode || activeProfile()?.accessCode || undefined,
      });
    },
    joinAsSomeoneElse: () => {
      const attempt = lastJoinAttempt;
      if (!attempt) return;
      set({ seatPrompt: undefined });
      get().joinRoom(attempt.roomId, attempt.firstName, attempt.lastName, attempt.password, false, true);
    },
    dismissSeatPrompt: () => set({ seatPrompt: undefined, seatClaimPending: undefined }),
    approveSeatClaim: (claimId: string) => {
      const roomId = get().room?.roomId;
      if (!roomId) return;
      client.send("room:claim-approve", { roomId, claimId });
    },
    rejectSeatClaim: (claimId: string) => {
      const roomId = get().room?.roomId;
      if (!roomId) return;
      client.send("room:claim-reject", { roomId, claimId });
    },
    watchRoom: (roomId: string, token: string) => {
      if (!roomId || !token) return;
      // No accessCode: a lockdown is about who may take a seat, and an
      // operator watching has not taken one. Same reasoning as room:resume.
      lastLobbyAction = "join";
      client.send("room:watch", { roomId: roomId.trim().toUpperCase(), token });
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
      beginPendingAction(requestId, "bet");
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
      beginPendingAction(requestId, "hit");
    },
    stand: () => {
      const roundId = get().round?.roundId;
      const playerId = get().playerId;
      if (get().pendingAction) return;
      if (!roundId || !playerId) return;
      const requestId = client.send("turn:stand", { roundId, playerId });
      beginPendingAction(requestId, "stand");
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
      beginPendingAction(requestId, "skip");
    },
    // The banker standing an absent player's hand for them. Skip voids a
    // hand, which is the wrong answer once chips are down (the server now
    // refuses it -- cannot_skip_wagered), so this is the banker's way past a
    // seat the table is stuck on without touching anyone's money: the hand
    // stands as dealt and settles like any other, bank bust included.
    standFor: (playerId: string) => {
      const roundId = get().round?.roundId;
      const actorId = get().playerId;
      if (!roundId || !actorId || !playerId) return;
      if (get().pendingAction) return;
      const requestId = client.send("turn:stand", { roundId, playerId });
      beginPendingAction(requestId, "stand");
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
    // The practice table's own answer to an emptied bank. A real table's
    // banker fixes this from Manage -> BANK; a practice table's banker is a
    // bot, so without this the table is simply over -- every wager after the
    // bank hits zero is refused and nothing on the felt can undo it.
    practiceTopUpBank: (amount: number) => {
      const roomId = get().room?.roomId;
      if (!roomId) return;
      client.send("bank:practice-topup", { roomId, amount });
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
    // The banker's third exit from a depleted bank. The rule was always
    // "replenish, pass the bank, or end round AND game" -- the button only
    // ever did the first half, leaving a table sitting on a dead bank with no
    // hand in progress and no way forward but the Manage drawer.
    //
    // Two existing sends rather than a new server op: both halves are already
    // authorized paths, and the socket delivers them in order, so the round
    // that just ended is folded into roundHistory BEFORE room:closed wipes the
    // room -- which is what puts it in the game-over screen's standings. A new
    // combined op would have to reproduce that ordering anyway.
    endGameAfterBankDecision: () => {
      get().endRoundDueToBank();
      get().closeRoom();
    },
    // Same moment and same admin gate as endRoundDueToBank -- this is the
    // third choice offered when a BANK! wager empties the bank (replenish /
    // end / hand it over). The server ends the round as part of the handover;
    // see GameStore.passBankAfterBankDecision for why the two are one action.
    passBankToPlayer: (targetPlayerId: string) => {
      const roomId = get().room?.roomId;
      const playerId = get().playerId;
      if (!roomId || !playerId || !targetPlayerId) return;
      const player = get().room?.players.find((p) => p.id === playerId);
      if (player?.type !== "admin") {
        set({ message: "Only the banker can pass the bank." });
        return;
      }
      client.send("round:pass-bank", { roomId, targetPlayerId });
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
    undoLastCorrection: () => {
      const roomId = get().room?.roomId;
      const actorId = get().playerId;
      if (!roomId || !actorId) {
        set({ message: "Join a game first." });
        return;
      }
      const actor = get().room?.players.find((p) => p.id === actorId);
      if (actor?.type !== "admin") {
        set({ message: "Only the banker can undo a correction." });
        return;
      }
      client.send("room:undo-correction", { roomId });
    },
    setDeckCount: (decks: number) => {
      const roomId = get().room?.roomId;
      const actorId = get().playerId;
      if (!roomId || !actorId) {
        set({ message: "Join a game first." });
        return;
      }
      const actor = get().room?.players.find((p) => p.id === actorId);
      if (actor?.type !== "admin") {
        set({ message: "Only the banker can change the shoe." });
        return;
      }
      client.send("room:set-deck-count", { roomId, decks });
    },
    setTurnSeconds: (seconds: number) => {
      const roomId = get().room?.roomId;
      const actorId = get().playerId;
      if (!roomId || !actorId) {
        set({ message: "Join a game first." });
        return;
      }
      const actor = get().room?.players.find((p) => p.id === actorId);
      if (actor?.type !== "admin") {
        set({ message: "Only the banker can change the turn clock." });
        return;
      }
      client.send("room:set-turn-seconds", { roomId, seconds });
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
    acknowledgeBankFrame: (settledAt?: number) => {
      // Sent unconditionally rather than only in a practice room: the server
      // already knows whether anything is held (only a BOT banker ever is),
      // and duplicating that rule here is how the two drift apart. A live
      // table's ack is a no-op the server drops.
      const roomId = get().room?.roomId;
      if (!roomId || !get().playerId) return;
      client.send("bank:frame-ack", { settledAt });
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
    // Two doors, because there were always two intentions behind one button.
    //
    // Stepping away is a disconnect and nothing more: the per-room session
    // token stays in localStorage, so returning to this room resumes the same
    // seat with the same chips. This is what an accidental tap, a dying
    // battery, or "I'll restart the app to fix it" has to do.
    //
    // Found by playing (2026-09-06): the old single Leave cleared the token
    // and never told the server, so the seat stayed on the table holding its
    // stack and the returning player could only arrive as a stranger -- two
    // rows with the same name, one of them unreachable. See
    // backend/src/__tests__/leave-and-return.test.ts.
    stepAway: () => {
      // Deliberately NOT clearRoomSession: that token is the way back.
      persistSession(undefined);
      get().client.close();
      if (typeof window !== "undefined") window.location.assign("/");
    },
    leaveGame: () => {
      // Tell the server first -- teardownRoomSession closes the socket, and a
      // room:leave sent after that goes nowhere. The seat outliving the
      // player is the whole bug this exists to stop.
      const roomId = get().room?.roomId;
      if (roomId) client.send("room:leave", { roomId });
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
