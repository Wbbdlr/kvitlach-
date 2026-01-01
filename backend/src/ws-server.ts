import { WebSocketServer, WebSocket } from "ws";
import { GameStore } from "./store";
import { ClientEnvelope, RoomState, RoundState, ServerEnvelope } from "./types";
import type { RoundContext } from "./round";

interface ConnectionMeta {
  roomId?: string;
  playerId?: string;
}

export class WSServer {
  private wss: WebSocketServer;
  private store: GameStore;
  private rooms = new Map<string, Set<WebSocket>>();
  private meta = new WeakMap<WebSocket, ConnectionMeta>();

  constructor(store: GameStore, port: number) {
    this.store = store;
    this.wss = new WebSocketServer({ port });
    this.wss.on("connection", (socket: WebSocket) => this.onConnection(socket));
    console.log(`WebSocket listening on ws://0.0.0.0:${port}`);
  }

  private onConnection(socket: WebSocket) {
    this.meta.set(socket, {});
    socket.on("message", (data: WebSocket.RawData) => this.onMessage(socket, data));
    socket.on("close", () => this.onClose(socket));
    socket.on("error", (err: Error) => console.error("ws error", err));
  }

  private onClose(socket: WebSocket) {
    const info = this.meta.get(socket);
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
        }
      }
    }
  }

  private onMessage(socket: WebSocket, data: WebSocket.RawData) {
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
          const { firstName, lastName, roomName, password, buyIn, roomId, bankerBankroll } = (payload as any) || {};
          if (!firstName) throw new Error("invalid_payload");
          const { room, player, sessionToken } = this.store.createRoom({ firstName, lastName, roomName, password, buyIn, roomId, bankerBankroll });
          this.attach(socket, room.roomId, player.id);
          this.sendAck(socket, requestId, {
            room,
            player,
            session: { roomId: room.roomId, playerId: player.id, token: sessionToken },
          });
          this.broadcastRoom(room.roomId);
          break;
        }
        case "room:join": {
          const { roomId, firstName, lastName, password } = (payload as any) || {};
          if (!roomId || !firstName) throw new Error("invalid_payload");
          const { room, player, sessionToken } = this.store.joinRoom(roomId, { firstName, lastName, password });
          this.attach(socket, room.roomId, player.id);
          this.sendAck(socket, requestId, {
            room,
            player,
            session: { roomId: room.roomId, playerId: player.id, token: sessionToken },
          });
          this.broadcastRoom(room.roomId);
          break;
        }
        case "room:resume": {
          const { roomId, playerId, token } = (payload as any) || {};
          if (!roomId || !playerId || !token) throw new Error("invalid_payload");
          const { player, sessionToken } = this.store.resumePlayer(roomId, playerId, token);
          this.attach(socket, roomId, playerId);
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
          break;
        }
        case "room:switch-admin": {
          const { roomId, playerId } = (payload as any) || {};
          if (!roomId || !playerId) throw new Error("invalid_payload");
          this.store.switchAdmin(roomId, playerId);
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
          const { roundId, amount, playerId: actorFromPayload, bank } = (payload as any) || {};
          const meta = this.meta.get(socket);
          const actorId = actorFromPayload ?? meta?.playerId;
          if (!roundId || typeof amount !== "number" || !actorId) throw new Error("invalid_payload");
          const round = this.store.applyBet(roundId, actorId, amount, { bank: Boolean(bank) });
          this.handleRoundUpdate(round);
          this.sendAck(socket, requestId, { round: this.sanitizeRound(round) });
          break;
        }
        case "turn:stand": {
          const { roundId, playerId: actorFromPayload } = (payload as any) || {};
          const meta = this.meta.get(socket);
          const actorId = actorFromPayload ?? meta?.playerId;
          if (!roundId || !actorId) throw new Error("invalid_payload");
          const round = this.store.applyStand(roundId, actorId);
          this.handleRoundUpdate(round);
          this.sendAck(socket, requestId, { round: this.sanitizeRound(round) });
          break;
        }
        case "turn:hit": {
          const { roundId, playerId: actorFromPayload } = (payload as any) || {};
          const meta = this.meta.get(socket);
          const actorId = actorFromPayload ?? meta?.playerId;
          if (!roundId || !actorId) throw new Error("invalid_payload");
          const round = this.store.applyHit(roundId, actorId);
          this.handleRoundUpdate(round);
          this.sendAck(socket, requestId, { round: this.sanitizeRound(round) });
          break;
        }
        case "turn:skip": {
          const { roundId, playerId: targetId, actorId: actorFromPayload } = (payload as any) || {};
          const meta = this.meta.get(socket);
          const actorId = actorFromPayload ?? meta?.playerId;
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
      const { balances } = this.store.finalizeRound(round.roundId);
      this.broadcast(round.roomId, {
        type: "round:ended",
        roomId: round.roomId,
        payload: { balances },
      });
      this.broadcastRoom(round.roomId);
    }
  }

  private sanitizeRound(round: RoundState | RoundContext): RoundState {
    const { timer, ...rest } = round as RoundContext;
    return rest;
  }

  private attach(socket: WebSocket, roomId: string, playerId: string) {
    this.meta.set(socket, { roomId, playerId });
    if (!this.rooms.has(roomId)) this.rooms.set(roomId, new Set());
    this.rooms.get(roomId)!.add(socket);
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

  private sendAck(socket: WebSocket, requestId: string | undefined, payload: unknown) {
    this.send(socket, { type: "ack", requestId, payload });
  }

  private send(socket: WebSocket, message: ServerEnvelope) {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }
}
