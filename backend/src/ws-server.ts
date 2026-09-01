import { WebSocketServer, WebSocket, RawData } from "ws";
import type { IncomingMessage } from "http";
import { AccessControl } from "./access.js";
import { validatePayload } from "./payload.js";
import { GameStore } from "./store.js";
import { metrics } from "./metrics.js";
import { ClientEnvelope, PublicRoundState, RoomState, RoundState, ServerEnvelope, ReactionEvent } from "./types.js";
import type { RoundContext } from "./round.js";

interface ConnectionMeta {
  roomId?: string;
  playerId?: string;
  ip?: string;
  userAgent?: string;
  connectionId?: number;
}

// Bounds accidental abuse (e.g. a buggy client stuck in a reconnect loop),
// not determined attackers -- those just rotate IPs regardless. Needs to
// comfortably clear a real family/friends game night, where dozens of
// players are commonly behind the same home-WiFi NAT and would otherwise
// all share one IP and get throttled together. Was 40 -- too tight for the
// ~50-person night this app is meant to host (the waiting-list drawer only
// helps once someone's actually connected).
const MAX_CONNS_PER_IP = 80;
const MAX_MSGS_PER_WINDOW = 30;
const MSG_WINDOW_MS = 10_000;
// `ws` defaults maxPayload to 100 MiB. The rate limiter below counts MESSAGES,
// not bytes, so at the default one socket could push ~30 x 100 MiB per window
// through data.toString() + JSON.parse before it ever tripped -- an easy
// memory-exhaustion DoS on a public endpoint, and this box also hosts other
// services that would go down with it. Real traffic is nowhere near this: the
// largest legitimate message is a room:create carrying a few short strings,
// and set-watermark is capped at 60 chars server-side. 32 KiB is enormous
// headroom for that while making the attack pointless. Oversized frames are
// closed by `ws` itself with 1009 before any of our code sees them.
const MAX_MESSAGE_BYTES = 32 * 1024;

export class WSServer {
  private wss: WebSocketServer;
  private store: GameStore;
  private rooms = new Map<string, Set<WebSocket>>();
  private meta = new WeakMap<WebSocket, ConnectionMeta>();
  private connsByIp = new Map<string, Set<WebSocket>>();
  private msgCount = new WeakMap<WebSocket, { count: number; resetAt: number }>();

  // How many rooms this server currently holds socket sets for. Must track
  // rooms with someone CONNECTED, not rooms ever created -- see onClose. Read
  // -only and cheap, so the leak regression test can watch it without reaching
  // into the private map.
  get trackedRoomCount(): number {
    return this.rooms.size;
  }

  // Injected rather than constructed here so index.ts owns the one instance
  // the HTTP admin page also mutates -- two AccessControls would mean the
  // admin page toggling a lockdown that gameplay never sees. Optional so the
  // many tests that construct a bare WSServer keep working; absent means an
  // always-open gate, which is the pre-existing behaviour.
  constructor(store: GameStore, port: number, private readonly access: AccessControl = new AccessControl()) {
    this.store = store;
    this.store.setRoundUpdateListener((round) => this.handleRoundUpdate(round));
    this.wss = new WebSocketServer({ port, maxPayload: MAX_MESSAGE_BYTES });
    this.wss.on("connection", (socket: WebSocket, request: IncomingMessage) => this.onConnection(socket, request));
    console.log(`WebSocket listening on ws://0.0.0.0:${port}`);
  }

  private onConnection(socket: WebSocket, request: IncomingMessage) {
    const forwardedFor = request.headers["x-forwarded-for"];
    const ip = Array.isArray(forwardedFor)
      ? forwardedFor[0]
      : typeof forwardedFor === "string"
      ? forwardedFor.split(",")[0]?.trim()
      : request.socket.remoteAddress;
    const userAgentHeader = request.headers["user-agent"];
    const userAgent = Array.isArray(userAgentHeader) ? userAgentHeader[0] : userAgentHeader;

    const ipKey = ip ?? "unknown";
    const existing = this.connsByIp.get(ipKey) ?? new Set();
    if (existing.size >= MAX_CONNS_PER_IP) {
      console.warn(`Rate limit: too many connections from ${ipKey} (${existing.size}), dropping`);
      socket.close(1008, "too_many_connections");
      return;
    }
    existing.add(socket);
    this.connsByIp.set(ipKey, existing);
    metrics.wsConnectionOpened();

    this.meta.set(socket, { ip: ip ?? undefined, userAgent: userAgent ?? undefined });
    this.msgCount.set(socket, { count: 0, resetAt: Date.now() + MSG_WINDOW_MS });
    socket.on("message", (data: RawData) => void this.onMessage(socket, data));
    socket.on("close", () => this.onClose(socket));
    socket.on("error", (err: Error) => console.error("ws error", err));
  }

  private onClose(socket: WebSocket) {
    metrics.wsConnectionClosed();
    const info = this.meta.get(socket);
    if (info?.ip) {
      const ipSet = this.connsByIp.get(info.ip);
      if (ipSet) {
        ipSet.delete(socket);
        if (ipSet.size === 0) this.connsByIp.delete(info.ip);
      }
    }
    if (info?.roomId) {
      const roomSockets = this.rooms.get(info.roomId);
      roomSockets?.delete(socket);
      if (info.playerId) {
        const stillConnected = Array.from(roomSockets ?? []).some((sock) => {
          const meta = this.meta.get(sock);
          return meta?.playerId === info.playerId;
        });
        if (!stillConnected) {
          this.store.setPresence(info.roomId, info.playerId, "offline");
          this.broadcastRoom(info.roomId);
          // Both of these reach Postgres, and both are fire-and-forget. An
          // unhandled rejection terminates the process on Node 20, so a db
          // hiccup while ONE player's socket closed would drop every player
          // in every room. store.ts already catches on all its own void
          // writes; these two were the outliers.
          void this.store
            .recordDisconnection(info.connectionId)
            .catch((e) => console.error("record disconnection failed", e));
          void this.broadcastConnections(info.roomId).catch((e) =>
            console.error("broadcast connections failed", info.roomId, e),
          );
        }
      }
      // Drop the room's entry once its last socket goes. Without this, every
      // roomId that ever had a connection kept a permanent Map entry -- an
      // empty Set and the id string -- for the life of the process. The STORE
      // reaps its own rooms (on close, on the inactivity timer, on admin
      // force), but nothing told this map, so the two drifted apart and this
      // one only ever grew. Practice rooms make it add up fastest: they are
      // throwaway single-human sessions reaped after 30 minutes, and each one
      // still left its entry behind.
      // Safe to delete rather than keep empty: both broadcast helpers treat a
      // missing entry exactly like an empty one, and the join path below
      // recreates the Set on demand.
      if (roomSockets && roomSockets.size === 0) this.rooms.delete(info.roomId);
    }
  }

  private async onMessage(socket: WebSocket, data: RawData) {
    metrics.wsMessageReceived();
    const rate = this.msgCount.get(socket);
    if (rate) {
      const now = Date.now();
      if (now > rate.resetAt) { rate.count = 0; rate.resetAt = now + MSG_WINDOW_MS; }
      rate.count++;
      if (rate.count > MAX_MSGS_PER_WINDOW) {
        this.send(socket, { type: "error", error: { message: "rate_limited" } });
        socket.close(1008, "rate_limited");
        return;
      }
    }

    let msg: ClientEnvelope;
    try {
      msg = JSON.parse(data.toString());
    } catch (err) {
      this.send(socket, { type: "error", error: { message: "invalid_json" } });
      return;
    }

    const { type, requestId } = msg;
    try {
      // Every field on every message type goes through this before any
      // handler sees it -- see payload.ts for why it's one universal rule
      // rather than a per-type schema. Handlers below still destructure with
      // `payload as any`, but that cast is now backed by a real check: the
      // values are guaranteed scalars, so the truthiness guards they already
      // do are actually sufficient.
      const payload = validatePayload(msg.payload);
      switch (type) {
        case "room:create": {
          const { firstName, lastName, roomName, password, buyIn, roomId, bankerBankroll, accessCode } = (payload as any) || {};
          this.access.assertAllowed("create", accessCode);
          if (!firstName) throw new Error("invalid_payload");
          const { room, player, sessionToken } = this.store.createRoom({ firstName, lastName, roomName, password, buyIn, roomId, bankerBankroll });
          await this.attach(socket, room.roomId, player.id);
          this.sendAck(socket, requestId, {
            room,
            player,
            session: { roomId: room.roomId, playerId: player.id, token: sessionToken },
          });
          this.broadcastRoom(room.roomId);
          await this.broadcastConnections(room.roomId);
          break;
        }
        case "room:create-practice": {
          const { firstName, botCount, buyIn, bankBuyIn, deckCount, accessCode } = (payload as any) || {};
          this.access.assertAllowed("practice", accessCode);
          if (!firstName) throw new Error("invalid_payload");
          const { room, player, sessionToken } = this.store.createPracticeRoom({ firstName, botCount, buyIn, bankBuyIn, deckCount });
          await this.attach(socket, room.roomId, player.id);
          // Unlike room:create, a round is already underway here (no human
          // banker exists to click Start) -- the client only ever populates
          // state from broadcasts, not the ack, so this needs its own
          // explicit round:state push (mirrors round:start's own pattern).
          const round = room.roundId ? this.store.getRound(room.roundId) : undefined;
          if (round) this.broadcastRound(round);
          this.sendAck(socket, requestId, {
            room,
            player,
            round: round ? this.sanitizeRound(round) : undefined,
            session: { roomId: room.roomId, playerId: player.id, token: sessionToken },
          });
          this.broadcastRoom(room.roomId);
          await this.broadcastConnections(room.roomId);
          break;
        }
        case "room:join": {
          const { roomId, firstName, lastName, password, spectator, accessCode } = (payload as any) || {};
          this.access.assertAllowed("join", accessCode);
          if (!roomId || !firstName) throw new Error("invalid_payload");
          const { room, player, sessionToken } = this.store.joinRoom(roomId, { firstName, lastName, password, spectator: Boolean(spectator) });
          await this.attach(socket, room.roomId, player.id);
          this.sendAck(socket, requestId, {
            room,
            player,
            session: { roomId: room.roomId, playerId: player.id, token: sessionToken },
          });
          this.broadcastRoom(room.roomId);
          await this.broadcastConnections(room.roomId);
          break;
        }
        // Deliberately NOT gated by this.access -- see assertAllowed's comment
        // in access.ts. Resume is how someone already seated at a live table
        // gets back after their connection blinks; gating it would turn a
        // lockdown into a mass ejection mid-hand.
        case "room:resume": {
          const { roomId, playerId, token } = (payload as any) || {};
          if (!roomId || !playerId || !token) throw new Error("invalid_payload");
          const { player, sessionToken } = this.store.resumePlayer(roomId, playerId, token);
          await this.attach(socket, roomId, playerId);
          const room = this.store.getRoom(roomId);
          const round = room?.roundId ? this.store.getRound(room.roundId) : undefined;
          if (room) this.broadcastRoom(roomId);
          if (round) this.broadcastRound(round);
          this.sendAck(socket, requestId, {
            room,
            player,
            round: round ? this.sanitizeRound(round) : undefined,
            session: { roomId, playerId, token: sessionToken },
          });
          await this.broadcastConnections(roomId);
          break;
        }
        case "room:switch-admin": {
          const { roomId, targetPlayerId } = (payload as any) || {};
          const meta = this.meta.get(socket);
          const actorId = meta?.playerId;
          if (!roomId || !actorId || !targetPlayerId) throw new Error("invalid_payload");
          this.store.switchAdmin(roomId, actorId, targetPlayerId);
          this.broadcastRoom(roomId);
          this.sendAck(socket, requestId, {});
          break;
        }
        case "round:start": {
          const { roomId, deckCount } = (payload as any) || {};
          const meta = this.meta.get(socket);
          const actorId = meta?.playerId;
          if (!roomId || !actorId) throw new Error("invalid_payload");
          const round = this.store.startRound(roomId, actorId, deckCount);
          this.broadcastRound(round);
          this.sendAck(socket, requestId, { round: this.sanitizeRound(round) });
          this.broadcastRoom(roomId);
          break;
        }
        case "turn:bet": {
          const { roundId, amount, bank, eleveroon } = (payload as any) || {};
          const meta = this.meta.get(socket);
          const actorId = meta?.playerId;
          if (!roundId || typeof amount !== "number" || !actorId) throw new Error("invalid_payload");
          const round = this.store.applyBet(roundId, actorId, amount, { bank: Boolean(bank), eleveroon: Boolean(eleveroon) });
          this.handleRoundUpdate(round);
          this.sendAck(socket, requestId, { round: this.sanitizeRound(round) });
          break;
        }
        case "turn:stand": {
          const { roundId } = (payload as any) || {};
          const meta = this.meta.get(socket);
          const actorId = meta?.playerId;
          if (!roundId || !actorId) throw new Error("invalid_payload");
          const round = this.store.applyStand(roundId, actorId);
          this.handleRoundUpdate(round);
          this.sendAck(socket, requestId, { round: this.sanitizeRound(round) });
          break;
        }
        case "turn:hit": {
          const { roundId, eleveroon } = (payload as any) || {};
          const meta = this.meta.get(socket);
          const actorId = meta?.playerId;
          if (!roundId || !actorId) throw new Error("invalid_payload");
          const round = this.store.applyHit(roundId, actorId, { eleveroon: Boolean(eleveroon) });
          this.handleRoundUpdate(round);
          this.sendAck(socket, requestId, { round: this.sanitizeRound(round) });
          break;
        }
        case "turn:skip": {
          const { roundId, playerId: targetId } = (payload as any) || {};
          const meta = this.meta.get(socket);
          const actorId = meta?.playerId;
          if (!roundId || !actorId) throw new Error("invalid_payload");
          const roundCtx = this.store.getRound(roundId);
          if (!roundCtx) throw new Error("round_not_found");
          const effectivePlayerId = targetId ?? actorId;
          if (targetId && targetId !== actorId && !this.store.isAdmin(roundCtx.roomId, actorId)) {
            throw new Error("forbidden");
          }
          const round = this.store.applySkip(roundId, effectivePlayerId);
          this.handleRoundUpdate(round);
          this.sendAck(socket, requestId, { round: this.sanitizeRound(round) });
          break;
        }
        case "round:banker-end": {
          const meta = this.meta.get(socket);
          const roomId = meta?.roomId;
          const actorId = meta?.playerId;
          if (!roomId || !actorId) throw new Error("invalid_payload");
          const round = this.store.endRoundAfterBankDecision(roomId, actorId);
          this.handleRoundUpdate(round);
          this.broadcast(roomId, { type: "round:banker-ended", roomId });
          this.sendAck(socket, requestId, { round: this.sanitizeRound(round) });
          break;
        }
        // Any seated player can pull the table out from under a banker who
        // has dropped and stayed dropped -- see GameStore.voidAbandonedRound.
        // Deliberately NOT admin-gated: the whole point is that the admin is
        // the one who isn't there.
        case "round:void-abandoned": {
          const meta = this.meta.get(socket);
          const roomId = meta?.roomId;
          const actorId = meta?.playerId;
          if (!roomId || !actorId) throw new Error("invalid_payload");
          const round = this.store.voidAbandonedRound(roomId, actorId);
          this.handleRoundUpdate(round);
          this.broadcast(roomId, {
            type: "round:voided",
            roomId,
            payload: { by: actorId, reason: "banker_absent" },
          });
          this.sendAck(socket, requestId, { round: this.sanitizeRound(round) });
          break;
        }
        case "player:rename-request": {
          const { firstName, lastName, roomId: roomFromPayload } = (payload as any) || {};
          const meta = this.meta.get(socket);
          const roomId = roomFromPayload ?? meta?.roomId;
          const actorId = meta?.playerId;
          if (!roomId || !actorId || !firstName) throw new Error("invalid_payload");
          this.store.requestRename(roomId, actorId, firstName, lastName);
          const updatedRoom = this.store.getRoom(roomId);
          this.broadcastRoom(roomId);
          this.sendAck(socket, requestId, { room: updatedRoom });
          break;
        }
        case "player:rename-cancel": {
          const meta = this.meta.get(socket);
          const roomId = meta?.roomId;
          const actorId = meta?.playerId;
          if (!roomId || !actorId) throw new Error("invalid_payload");
          this.store.cancelRename(roomId, actorId);
          const updatedRoom = this.store.getRoom(roomId);
          this.broadcastRoom(roomId);
          this.sendAck(socket, requestId, { room: updatedRoom });
          break;
        }
        case "player:rename-block": {
          const { playerId: targetPlayerId, block, roomId: roomFromPayload } = (payload as any) || {};
          const meta = this.meta.get(socket);
          const roomId = roomFromPayload ?? meta?.roomId;
          const actorId = meta?.playerId;
          if (!roomId || !actorId || !targetPlayerId || typeof block !== "boolean") throw new Error("invalid_payload");
          this.store.setRenameBlock(roomId, actorId, targetPlayerId, block);
          const updatedRoom = this.store.getRoom(roomId);
          this.broadcastRoom(roomId);
          this.sendAck(socket, requestId, { room: updatedRoom });
          break;
        }
        case "player:rename-approve": {
          const { playerId: targetPlayerId, roomId: roomFromPayload } = (payload as any) || {};
          const meta = this.meta.get(socket);
          const roomId = roomFromPayload ?? meta?.roomId;
          const actorId = meta?.playerId;
          if (!roomId || !actorId || !targetPlayerId) throw new Error("invalid_payload");
          const updatedRound = this.store.approveRename(roomId, actorId, targetPlayerId);
          this.broadcastRoom(roomId);
          if (updatedRound) this.broadcastRound(updatedRound);
          const updatedRoom = this.store.getRoom(roomId);
          this.sendAck(socket, requestId, { room: updatedRoom });
          break;
        }
        case "player:rename-reject": {
          const { playerId: targetPlayerId, roomId: roomFromPayload } = (payload as any) || {};
          const meta = this.meta.get(socket);
          const roomId = roomFromPayload ?? meta?.roomId;
          const actorId = meta?.playerId;
          if (!roomId || !actorId || !targetPlayerId) throw new Error("invalid_payload");
          this.store.rejectRename(roomId, actorId, targetPlayerId);
          this.broadcastRoom(roomId);
          const updatedRoom = this.store.getRoom(roomId);
          this.sendAck(socket, requestId, { room: updatedRoom });
          break;
        }
        case "player:buyin-request": {
          const { amount, note, roomId: roomFromPayload } = (payload as any) || {};
          const meta = this.meta.get(socket);
          const roomId = roomFromPayload ?? meta?.roomId;
          const actorId = meta?.playerId;
          if (!roomId || !actorId || !Number.isFinite(amount)) throw new Error("invalid_payload");
          this.store.requestBuyIn(roomId, actorId, amount, note);
          const updatedRoom = this.store.getRoom(roomId);
          this.broadcastRoom(roomId);
          this.sendAck(socket, requestId, { room: updatedRoom });
          break;
        }
        case "player:buyin-cancel": {
          const meta = this.meta.get(socket);
          const roomId = meta?.roomId;
          const actorId = meta?.playerId;
          if (!roomId || !actorId) throw new Error("invalid_payload");
          this.store.cancelBuyIn(roomId, actorId);
          const updatedRoom = this.store.getRoom(roomId);
          this.broadcastRoom(roomId);
          this.sendAck(socket, requestId, { room: updatedRoom });
          break;
        }
        case "player:buyin-block": {
          const { playerId: targetPlayerId, block, roomId: roomFromPayload } = (payload as any) || {};
          const meta = this.meta.get(socket);
          const roomId = roomFromPayload ?? meta?.roomId;
          const actorId = meta?.playerId;
          if (!roomId || !actorId || !targetPlayerId || typeof block !== "boolean") throw new Error("invalid_payload");
          this.store.setBuyInBlock(roomId, actorId, targetPlayerId, block);
          const updatedRoom = this.store.getRoom(roomId);
          this.broadcastRoom(roomId);
          this.sendAck(socket, requestId, { room: updatedRoom });
          break;
        }
        case "player:buyin-approve": {
          const { playerId: targetPlayerId, roomId: roomFromPayload } = (payload as any) || {};
          const meta = this.meta.get(socket);
          const roomId = roomFromPayload ?? meta?.roomId;
          const actorId = meta?.playerId;
          if (!roomId || !actorId || !targetPlayerId) throw new Error("invalid_payload");
          this.store.approveBuyIn(roomId, actorId, targetPlayerId);
          const updatedRoom = this.store.getRoom(roomId);
          this.broadcastRoom(roomId);
          this.sendAck(socket, requestId, { room: updatedRoom });
          break;
        }
        case "player:buyin-reject": {
          const { playerId: targetPlayerId, roomId: roomFromPayload } = (payload as any) || {};
          const meta = this.meta.get(socket);
          const roomId = roomFromPayload ?? meta?.roomId;
          const actorId = meta?.playerId;
          if (!roomId || !actorId || !targetPlayerId) throw new Error("invalid_payload");
          this.store.rejectBuyIn(roomId, actorId, targetPlayerId);
          const updatedRoom = this.store.getRoom(roomId);
          this.broadcastRoom(roomId);
          this.sendAck(socket, requestId, { room: updatedRoom });
          break;
        }
        case "player:kick": {
          const { playerId: targetPlayerId, roomId: roomFromPayload } = (payload as any) || {};
          const meta = this.meta.get(socket);
          const roomId = roomFromPayload ?? meta?.roomId;
          const actorId = meta?.playerId;
          if (!roomId || !actorId || !targetPlayerId) throw new Error("invalid_payload");
          const updatedRoom = this.store.kickPlayer(roomId, actorId, targetPlayerId);
          this.broadcastRoom(roomId);
          const roundId = updatedRoom.roundId;
          if (roundId) {
            const round = this.store.getRound(roundId);
            if (round) this.broadcastRound(round);
          }
          this.sendAck(socket, requestId, { room: updatedRoom });
          break;
        }
        case "room:close": {
          const { roomId: roomFromPayload } = (payload as any) || {};
          const meta = this.meta.get(socket);
          const roomId = roomFromPayload ?? meta?.roomId;
          const actorId = meta?.playerId;
          if (!roomId || !actorId) throw new Error("invalid_payload");
          this.store.closeRoom(roomId, actorId);
          this.broadcast(roomId, { type: "room:closed", roomId, payload: { reason: "banker_closed" } });
          this.sendAck(socket, requestId, {});
          break;
        }
        case "player:bank-adjust": {
          const { playerId: targetPlayerId, amount, note, roomId: roomFromPayload } = (payload as any) || {};
          const meta = this.meta.get(socket);
          const roomId = roomFromPayload ?? meta?.roomId;
          const actorId = meta?.playerId;
          if (!roomId || !actorId || !targetPlayerId || !Number.isFinite(amount)) throw new Error("invalid_payload");
          const result = this.store.adjustPlayerWallet(roomId, actorId, targetPlayerId, amount, note);
          const room = this.store.getRoom(roomId);
          if (room?.roundId) {
            const round = this.store.getRound(room.roundId);
            if (round) this.broadcastRound(round);
          }
          this.broadcastRoom(roomId);
          this.broadcast(roomId, {
            type: "player:bank-adjusted",
            roomId,
            playerId: targetPlayerId,
            payload: result,
          });
          this.sendAck(socket, requestId, { room, adjust: result });
          break;
        }
        case "player:practice-topup": {
          const meta = this.meta.get(socket);
          const roomId = meta?.roomId;
          const actorId = meta?.playerId;
          if (!roomId || !actorId) throw new Error("invalid_payload");
          const result = this.store.selfTopUpWallet(roomId, actorId);
          const room = this.store.getRoom(roomId);
          this.broadcastRoom(roomId);
          this.sendAck(socket, requestId, { room, topUp: result });
          break;
        }
        case "room:banker-topup": {
          const { amount, note, roomId: roomFromPayload } = (payload as any) || {};
          const meta = this.meta.get(socket);
          const roomId = roomFromPayload ?? meta?.roomId;
          const actorId = meta?.playerId;
          if (!roomId || !actorId || !Number.isFinite(amount)) throw new Error("invalid_payload");
          const result = this.store.topUpBanker(roomId, actorId, amount, note);
          const room = this.store.getRoom(roomId);
          if (room?.roundId) {
            const round = this.store.getRound(room.roundId);
            if (round) this.broadcastRound(round);
          }
          this.broadcastRoom(roomId);
          this.broadcast(roomId, {
            type: "room:banker-topup",
            roomId,
            playerId: actorId,
            payload: result,
          });
          this.sendAck(socket, requestId, { room, topUp: result });
          break;
        }
        case "room:set-watermark": {
          const { text, roomId: roomFromPayload } = (payload as any) || {};
          const meta = this.meta.get(socket);
          const roomId = roomFromPayload ?? meta?.roomId;
          const actorId = meta?.playerId;
          if (!roomId || !actorId || typeof text !== "string") throw new Error("invalid_payload");
          const result = this.store.setFeltWatermark(roomId, actorId, text);
          this.broadcastRoom(roomId);
          this.sendAck(socket, requestId, { result });
          break;
        }
        case "room:reshuffle-deck": {
          const { roomId: roomFromPayload } = (payload as any) || {};
          const meta = this.meta.get(socket);
          const roomId = roomFromPayload ?? meta?.roomId;
          const actorId = meta?.playerId;
          if (!roomId || !actorId) throw new Error("invalid_payload");
          // A mid-round reshuffle returns the updated round -- everyone at
          // the table needs to see the fresh deckReshuffledAt, not just the
          // banker who requested it. Between rounds there's no live round to
          // broadcast; the ack alone is enough (mirrors round:start's own
          // pattern of ack + conditional round broadcast).
          const updatedRound = this.store.reshuffleDeck(roomId, actorId);
          if (updatedRound) this.broadcastRound(updatedRound);
          // `broadcastRound` is what tells the client whether the round:state
          // it just received (broadcast goes out BEFORE this ack) already
          // announced this reshuffle to the whole table. Without it the
          // banker toasted twice mid-round -- once off the broadcast, once
          // off this ack -- and the client had no race-free way to tell the
          // two cases apart on its own.
          this.sendAck(socket, requestId, { broadcastRound: Boolean(updatedRound) });
          break;
        }
        case "player:react": {
          const { emoji } = (payload as any) || {};
          const meta = this.meta.get(socket);
          const roomId = meta?.roomId;
          const actorId = meta?.playerId;
          if (!roomId || !actorId || typeof emoji !== "string" || !emoji.trim()) throw new Error("invalid_payload");
          const room = this.store.getRoom(roomId);
          const isMember = room?.players.some((p) => p.id === actorId);
          if (!isMember) throw new Error("forbidden");
          // Mirrors frontend/src/table/selectors.ts's REACTION_EMOJIS /
          // REACTION_PHRASES / REACTION_GAME_CALLS exactly -- keep in sync,
          // or a new reaction added there silently falls back to 👏 here.
          const allowed = new Set([
            "👏","😂","😮","❤️","🔥","👍","😢","🤯","😎","🙌","😡","🤔","🎉","🤞","🙏","🍀","🍻","🍕","💯","🤑","😭","🥳","🃏","💰","😏","💤",
            // Yiddish/Hebrew text reactions (REACTION_PHRASES).
            "בהצלחה","מזל טוב","אוי וויי","קיין עין הרע","גוואלד","נו?","גיי שוין",
            // In-game banter (REACTION_GAME_CALLS).
            "BANK!","Futched!","Stay","Nice hand!","So close!","Deal me in!",
          ]);
          const trimmed = emoji.trim();
          const normalized = allowed.has(trimmed) ? trimmed : "👏";
          const payloadOut: ReactionEvent = { playerId: actorId, emoji: normalized, reactedAt: Date.now() };
          this.broadcast(roomId, { type: "reaction:new", roomId, payload: payloadOut });
          this.sendAck(socket, requestId, {});
          break;
        }
        case "room:get": {
          const { roomId } = (payload as any) || {};
          if (!roomId) throw new Error("invalid_payload");
          const room = this.store.getRoom(roomId);
          this.sendAck(socket, requestId, { room });
          break;
        }
        case "round:get": {
          const { roundId } = (payload as any) || {};
          if (!roundId) throw new Error("invalid_payload");
          const round = this.store.getRound(roundId);
          this.sendAck(socket, requestId, { round: round ? this.sanitizeRound(round) : undefined });
          break;
        }
        default:
          this.send(socket, { type: "error", requestId, error: { message: "unknown_type" } });
      }
    } catch (err: any) {
      // The protocol's error codes ARE messages here (the client switches on
      // "room_full", "not_your_turn", ...), so they have to pass through. But
      // anything else reaching this catch is unexpected -- a pg error naming
      // tables and columns, a TypeError naming internals -- and forwarding
      // its text hands a public client a free look inside. Matching on shape
      // rather than a list of the ~34 codes: every one of them is a bare
      // snake_case token, and real exception messages carry spaces and
      // punctuation, so the list can grow without anyone updating this.
      const raw = err?.message;
      const isProtocolCode = typeof raw === "string" && /^[a-z][a-z0-9_]*$/.test(raw);
      if (!isProtocolCode) console.error("unexpected handler error", type, err);
      this.send(socket, {
        type: "error",
        requestId,
        error: { message: isProtocolCode ? raw : "server_error" },
      });
    }
  }

  private handleRoundUpdate(round: RoundState) {
    this.broadcastRound(round);
    if (round.state === "terminate") {
      const roundSnapshot = this.store.getRound(round.roundId);
      const sanitizedRound = roundSnapshot ? this.sanitizeRound(roundSnapshot as RoundContext) : undefined;
      const { balances } = this.store.finalizeRound(round.roundId);
      this.broadcast(round.roomId, {
        type: "round:ended",
        roomId: round.roomId,
        payload: { balances, round: sanitizedRound },
      });
      this.broadcastRoom(round.roomId);
      // Used to auto-start a practice room's next round on a fixed timer,
      // since there's no human banker to click "Start round" -- but that
      // rushed the one human at the table past reading what just happened.
      // The felt now shows THEM the deal button instead (TableRoot gates it
      // on isAdmin || room.practice, see round:start below), so they choose
      // when, same as reviewing a real banker's own table.
    }
  }

  // The ONLY place a round crosses the wire (every ack, resume and broadcast
  // routes through here), so it's the one place that has to get this right.
  // `deck` is the live shoe in dealing order -- sending it let any player read
  // the next cards straight out of devtools. Clients only ever used its
  // length, for the shoe badge, so only the count goes out.
  private sanitizeRound(round: RoundState | RoundContext): PublicRoundState {
    const { timer, turnTimer, botTimer, deck, ...rest } = round as RoundContext;
    return { ...rest, deckRemaining: deck?.length ?? 0 };
  }

  private async attach(socket: WebSocket, roomId: string, playerId: string) {
    const existing = this.meta.get(socket) ?? {};
    const meta: ConnectionMeta = { ...existing, roomId, playerId };
    this.meta.set(socket, meta);
    if (!this.rooms.has(roomId)) this.rooms.set(roomId, new Set());
    this.rooms.get(roomId)!.add(socket);
    try {
      const connectionId = await this.store.recordConnection(roomId, playerId, existing.ip, existing.userAgent);
      meta.connectionId = connectionId;
      this.meta.set(socket, meta);
    } catch (err) {
      console.error("connection logging failed", err);
    }
  }

  private broadcastRoom(roomId: string) {
    const room = this.store.getRoom(roomId);
    if (!room) return;
    this.broadcast(roomId, { type: "room:state", roomId, payload: room });
  }

  private broadcastRound(round: RoundState) {
    const sanitized = this.sanitizeRound(round as RoundContext);
    this.broadcast(round.roomId, {
      type: "round:state",
      roomId: round.roomId,
      payload: sanitized,
    });
  }

  private broadcast(roomId: string, message: ServerEnvelope) {
    const sockets = this.rooms.get(roomId);
    if (!sockets) return;
    sockets.forEach((sock) => this.send(sock, message));
  }

  private async broadcastConnections(roomId: string) {
    const sockets = this.rooms.get(roomId);
    if (!sockets) return;
    const summaries = await this.store.getConnectionSummaries(roomId);
    sockets.forEach((sock) => {
      const meta = this.meta.get(sock);
      if (!meta?.playerId) return;
      if (!this.store.isAdmin(roomId, meta.playerId)) return;
      this.send(sock, { type: "room:connections", roomId, payload: { players: summaries } });
    });
  }

  private sendAck(socket: WebSocket, requestId: string | undefined, payload: unknown) {
    this.send(socket, { type: "ack", requestId, payload });
  }

  private send(socket: WebSocket, message: ServerEnvelope) {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }
}
