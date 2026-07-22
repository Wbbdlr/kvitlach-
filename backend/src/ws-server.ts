import { WebSocketServer, WebSocket, RawData } from "ws";
import type { IncomingMessage } from "http";
import { GameStore } from "./store.js";
import { ClientEnvelope, RoomState, RoundState, ServerEnvelope, ReactionEvent } from "./types.js";
import type { RoundContext } from "./round.js";

interface ConnectionMeta {
  roomId?: string;
  playerId?: string;
  ip?: string;
  userAgent?: string;
  connectionId?: number;
}

const MAX_CONNS_PER_IP = 8;
const MAX_MSGS_PER_WINDOW = 30;
const MSG_WINDOW_MS = 10_000;

export class WSServer {
  private wss: WebSocketServer;
  private store: GameStore;
  private rooms = new Map<string, Set<WebSocket>>();
  private meta = new WeakMap<WebSocket, ConnectionMeta>();
  private connsByIp = new Map<string, Set<WebSocket>>();
  private msgCount = new WeakMap<WebSocket, { count: number; resetAt: number }>();

  constructor(store: GameStore, port: number) {
    this.store = store;
    this.store.setRoundUpdateListener((round) => this.handleRoundUpdate(round));
    this.wss = new WebSocketServer({ port });
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

    this.meta.set(socket, { ip: ip ?? undefined, userAgent: userAgent ?? undefined });
    this.msgCount.set(socket, { count: 0, resetAt: Date.now() + MSG_WINDOW_MS });
    socket.on("message", (data: RawData) => void this.onMessage(socket, data));
    socket.on("close", () => this.onClose(socket));
    socket.on("error", (err: Error) => console.error("ws error", err));
  }

  private onClose(socket: WebSocket) {
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
          void this.store.recordDisconnection(info.connectionId);
            void this.broadcastConnections(info.roomId);
        }
      }
    }
  }

  private async onMessage(socket: WebSocket, data: RawData) {
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

    const { type, payload, requestId } = msg;
    try {
      switch (type) {
        case "room:create": {
          if (process.env.MAINTENANCE_MODE === "true") throw new Error("maintenance_mode");
          const { firstName, lastName, roomName, password, buyIn, roomId, bankerBankroll } = (payload as any) || {};
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
        case "room:join": {
          const { roomId, firstName, lastName, password, spectator } = (payload as any) || {};
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
          if (!roomId) throw new Error("invalid_payload");
          const round = this.store.startRound(roomId, deckCount);
          this.broadcastRound(round);
          this.sendAck(socket, requestId, { round: this.sanitizeRound(round) });
          this.broadcastRoom(roomId);
          break;
        }
        case "turn:bet": {
          const { roundId, amount, bank } = (payload as any) || {};
          const meta = this.meta.get(socket);
          const actorId = meta?.playerId;
          if (!roundId || typeof amount !== "number" || !actorId) throw new Error("invalid_payload");
          const round = this.store.applyBet(roundId, actorId, amount, { bank: Boolean(bank) });
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
        case "player:react": {
          const { emoji } = (payload as any) || {};
          const meta = this.meta.get(socket);
          const roomId = meta?.roomId;
          const actorId = meta?.playerId;
          if (!roomId || !actorId || typeof emoji !== "string" || !emoji.trim()) throw new Error("invalid_payload");
          const room = this.store.getRoom(roomId);
          const isMember = room?.players.some((p) => p.id === actorId);
          if (!isMember) throw new Error("forbidden");
          const allowed = new Set(["👏","😂","😮","❤️","🔥","👍","😢","🤯","😎","🙌","😡","🤔","🎉","🤞","🙏","🍀","🍻","🍕","💤","💯","✅","❌","🤑","😭","🤡"]);
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
      this.send(socket, {
        type: "error",
        requestId,
        error: { message: err?.message ?? "error" },
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
    }
  }

  private sanitizeRound(round: RoundState | RoundContext): RoundState {
    const { timer, turnTimer, ...rest } = round as RoundContext;
    return rest;
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
