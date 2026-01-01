import { create, StateCreator } from "zustand";
import { WSClient } from "./ws";
import { Balance, RoomState, RoundState, ServerEnvelope, Turn } from "./types";

type NotificationTone = "success" | "info" | "error";

interface UINotification {
  id: string;
  message: string;
  tone: NotificationTone;
}

interface SessionData {
  roomId: string;
  playerId: string;
  token: string;
}

interface CompletedRoundSummary {
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
  playerId?: string;
  session?: SessionData;
  status: "disconnected" | "connecting" | "connected";
  message?: string;
  wsUrl: string;
  pendingAction?: { requestId: string; type: "bet" | "hit" | "stand" | "skip" };
  bankerSummaryAt?: number;
  init: () => void;
  createRoom: (firstName: string, lastName?: string, roomName?: string, password?: string, buyIn?: number, roomId?: string, bankerBankroll?: number) => void;
  joinRoom: (roomId: string, firstName: string, lastName?: string, password?: string) => void;
  notifications: UINotification[];
  dismissNotification: (id: string) => void;
  setFormError: (form: "join" | "create" | "round" | "global", message?: string) => void;
  formErrors: Partial<Record<"join" | "create" | "round" | "global", string>>;
  startRound: (deckCount?: number) => void;
  bet: (amount: number, options?: { bank?: boolean }) => void;
  hit: () => void;
  stand: () => void;
  skip: (playerId?: string) => void;
  requestRename: (firstName: string, lastName?: string) => void;
  approveRename: (playerId: string) => void;
  rejectRename: (playerId: string) => void;
  requestBuyIn: (amount: number, note?: string) => void;
  approveBuyIn: (playerId: string) => void;
  rejectBuyIn: (playerId: string) => void;
  topUpBanker: (amount: number, note?: string) => void;
  endRoundDueToBank: () => void;
  dismissBankerSummary: () => void;
  kickPlayer: (playerId: string) => void;
  adjustPlayerBankroll: (playerId: string, amount: number, note?: string) => void;
}

const SESSION_STORAGE_KEY = "kvitlach.session";

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
      return parsed as SessionData;
    }
  } catch (err) {
    console.warn("Failed to load session", err);
  }
  return undefined;
};

const persistSession = (session?: SessionData) => {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    if (!session) {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
    } else {
      window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    }
  } catch (err) {
    console.warn("Failed to persist session", err);
  }
};

const DEFAULT_WS_PORT = 3001;

function computeDefaultWsUrl(): string {
  if (typeof window === "undefined") return `ws://localhost:${DEFAULT_WS_PORT}`;
  const { protocol, hostname } = window.location;
  const wsProtocol = protocol === "https:" ? "wss" : "ws";

  if (/-\d+\.app\.github\.dev$/.test(hostname)) {
    // GitHub Codespaces encode the port inside the subdomain, so swap in the WS port.
    return `${wsProtocol}://${hostname.replace(/-\d+\.app\.github\.dev$/, `-${DEFAULT_WS_PORT}.app.github.dev`)}`;
  }

  return `${wsProtocol}://${hostname}:${DEFAULT_WS_PORT}`;
}

const WS_URL = import.meta.env.VITE_WS_URL ?? computeDefaultWsUrl();

type SetState = Parameters<StateCreator<UIState>>[0];
type GetState = Parameters<StateCreator<UIState>>[1];

const initialSession = loadSession();

const creator: StateCreator<UIState> = (set: SetState, get: GetState) => {
  const client = new WSClient(WS_URL);
  let connectTimer: ReturnType<typeof setTimeout> | undefined;

  const makeNotification = (message: string, tone: NotificationTone): UINotification => ({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    message,
    tone,
  });

  const analyzeRoomTransition = (state: UIState, nextRoom: RoomState): Partial<UIState> => {
    const updates: Partial<UIState> = { room: nextRoom };
    const playerId = state.playerId;
    const prevRoom = state.room;
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
    if (msg.type === "round:state" && msg.payload) set({ round: msg.payload as RoundState });
    if (msg.type === "round:ended") {
      const { balances } = (msg.payload as any) || { balances: [] };
        set((s: UIState) => {
          const currentRound = s.round;
          const summary = currentRound
            ? {
                roundId: currentRound.roundId,
                roundNumber: currentRound.roundNumber ?? (s.roundHistory[0]?.roundNumber ?? 0) + 1,
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
          return {
            balances: [...balances, ...s.balances],
            roundHistory: summary ? [summary, ...s.roundHistory] : s.roundHistory,
          };
        });
      return;
    }
    if (msg.type === "room:banker-topup") {
      const payload = (msg.payload as any) || {};
      set((state: UIState) => {
        const banker = state.room?.players.find((p) => p.id === msg.playerId);
        const bankerName = [banker?.firstName, banker?.lastName].filter(Boolean).join(" ").trim() || "Banker";
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
        const notifications = [...state.notifications, makeNotification(message, "info")].slice(-5);
        return { notifications };
      });
      return;
    }
    if (msg.type === "player:bank-adjusted") {
      const payload = (msg.payload as any) || {};
      set((state: UIState) => {
        const actor = state.room?.players.find((p) => p.id === msg.playerId);
        const target = state.room?.players.find((p) => p.id === payload.playerId || msg.playerId);
        const actorName = [actor?.firstName, actor?.lastName].filter(Boolean).join(" ").trim() || "Banker";
        const targetName = [target?.firstName, target?.lastName].filter(Boolean).join(" ").trim() || "Player";
        const amountValue = typeof payload.amount === "number" ? payload.amount : undefined;
        const amountLabel = typeof amountValue === "number" ? `$${Math.abs(amountValue)}` : "chips";
        const direction = amountValue && amountValue < 0 ? "removed" : "added";
        const preposition = direction === "removed" ? "from" : "to";
        const totalLabel = typeof payload.total === "number" ? `$${payload.total}` : undefined;
        const noteSuffix = payload.note ? ` (${payload.note})` : "";
        const summary = `${actorName} ${direction} ${amountLabel} ${preposition} ${targetName}${noteSuffix}`;
        const totalSentence = totalLabel ? ` ${targetName} now has ${totalLabel}.` : "";
        const message = `${summary}.${totalSentence}`;
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
      if (errorMessage === "invalid_session") {
        persistSession(undefined);
      }
      set((state: UIState) => {
          const update: Partial<UIState> = {};
        if (msg.requestId && state.pendingAction?.requestId === msg.requestId) update.pendingAction = undefined;
        if (errorMessage === "invalid_session") {
          update.session = undefined;
          update.room = undefined;
          update.round = undefined;
          update.playerId = undefined;
          update.message = "Session expired. Rejoin the game.";
          return update;
        }
        const pendingType = state.pendingAction?.type;
        const friendly =
          errorMessage === "invalid_password"
            ? "Incorrect password"
            : errorMessage === "insufficient_bank"
            ? "Cannot remove more chips than the bank holds."
            : errorMessage === "bank_locked"
            ? "Bank showdown in progress. Please wait."
            : errorMessage === "banker_deciding"
            ? "Banker must decide how to proceed."
            : errorMessage === "bank_empty"
            ? "Bank has no chips left."
            : errorMessage === "forbidden"
            ? "Only the banker can perform that action."
            : errorMessage === "invalid_bank_amount"
            ? "Bank wager must equal the remaining bank."
            : errorMessage === "bank_not_in_decision"
            ? "No bank decision is pending."
            : errorMessage === "deck_empty"
            ? "The deck needs to be replenished before play can continue."
            : errorMessage;
        if (pendingType === "bet" || pendingType === "hit" || pendingType === "stand" || pendingType === "skip") {
          update.message = friendly;
        } else {
          const nextErrors = { ...state.formErrors, join: friendly };
          update.formErrors = nextErrors;
        }
        return update;
      });
      return;
    }
    if (msg.type === "ack") {
      set((state: UIState) => {
        const update: Partial<UIState> = { message: undefined };
        const nextErrors = { ...state.formErrors };
        const payload = (msg.payload as any) || {};
        if (payload.room) Object.assign(update, analyzeRoomTransition(state, payload.room as RoomState));
        if (payload.room) nextErrors.join = undefined;
        if (msg.requestId && state.pendingAction?.requestId === msg.requestId) update.pendingAction = undefined;
        if (payload.round) update.round = payload.round as RoundState;
        const sessionPayload = payload.session as SessionData | undefined;
        if (sessionPayload && sessionPayload.roomId && sessionPayload.playerId && sessionPayload.token) {
          persistSession(sessionPayload);
          update.session = sessionPayload;
          update.playerId = sessionPayload.playerId;
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
    const session = get().session ?? loadSession();
    if (session) {
      client.send("room:resume", session);
    }
  });
  client.onClose(() => {
    if (connectTimer) clearTimeout(connectTimer);
    connectTimer = undefined;
    set({ status: "disconnected", message: get().message, pendingAction: undefined });
  });
  client.onError(() => set({ status: "disconnected", message: `WebSocket error. Tried ${WS_URL}`, pendingAction: undefined }));

  return {
    client,
    status: "disconnected",
    balances: [],
    roundHistory: [],
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
    joinRoom: (roomId: string, firstName: string, lastName?: string, password?: string) => {
      if (!roomId) {
        set((s) => ({ formErrors: { ...s.formErrors, join: "Enter a room ID to join." } }));
        return;
      }
      if (!firstName) {
        set((s) => ({ formErrors: { ...s.formErrors, join: "Enter a first name to join." } }));
        return;
      }
      client.send("room:join", { roomId, firstName, lastName, password });
    },
    startRound: (deckCount?: number) => {
      const roomId = get().room?.roomId;
      if (!roomId) {
        set({ message: "Create or join a game first." });
        return;
      }
      client.send("round:start", { roomId, deckCount });
    },
    bet: (amount: number, options?: { bank?: boolean }) => {
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
      const requestId = client.send("turn:bet", { roundId, amount, playerId, bank: Boolean(options?.bank) });
      set({ pendingAction: { requestId, type: "bet" } });
    },
    hit: () => {
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
      const requestId = client.send("turn:hit", { roundId, playerId });
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
  };
};

export const useGameStore = create<UIState>(creator);
