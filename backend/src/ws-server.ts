import { WebSocketServer, WebSocket, RawData } from "ws";
import { randomBytes } from "node:crypto";
import type { IncomingMessage } from "http";
import { AccessControl } from "./access.js";
import { validatePayload } from "./payload.js";
import { resolveClientIp } from "./client-ip.js";
import { GameStore } from "./store.js";
import { metrics } from "./metrics.js";
import { ClientEnvelope, PublicRoundState, RoomState, RoundState, ServerEnvelope, ReactionEvent, Turn, Card } from "./types.js";
import type { RoundContext } from "./round.js";

// A card that carries no game information, sent in place of one a viewer is
// not entitled to see yet. "0" is never a real Kvitlach value (the deck is
// 1-12), so if a redaction rule and the frontend's own render-time hiding
// ever disagreed, the result is an obviously-wrong blank card rather than a
// silently-plausible one.
const REDACTED_CARD: Card = { name: "0", attributes: { values: [] } };

// Whether card `idx` of `turn` must stay hidden from `viewerId`.
//
// This is a server-side mirror of the concealment rules that used to live
// ONLY in the frontend (selectors.ts's totalDisplay, and the per-card `hide`
// logic in Seat.tsx/Dealer.tsx) -- rules that decided what got RENDERED, not
// what got SENT. The server sent every card to everyone regardless, so the
// banker's hole card and a standing player's hand were one devtools Network
// tab away from anyone already connected to the room. Exactly the class of
// bug this file already fixed once for the shoe (see sanitizeRound's own
// comment on `deck`), never applied here.
//
// Mirrors, not re-implements from scratch: the three branches below (banker,
// public-standby, blatt-vs-wagered) are the same three the frontend already
// had reasons for, reproduced so the two stay readable side by side rather
// than trusting a description of them. `betStartIndex` (types.ts, set by
// round.ts's handleBet) replaces the frontend's own client-side inference of
// the same boundary -- see that field's own comment for why the server's
// version has no blind spot for a late-joining viewer.
function isCardHidden(turn: Turn, idx: number, viewerId: string | undefined, roundTerminated: boolean): boolean {
  if (viewerId !== undefined && viewerId === turn.player.id) return false; // a hand is never hidden from its own player

  if (turn.player.type === "admin") {
    // The banker's hole card (idx 0) stays down until their own turn stops
    // being pending, or the round ends outright. Every other card of theirs
    // -- their hits after the hole card -- is public as soon as it is drawn.
    const bankerReveal = roundTerminated || turn.state !== "pending";
    return idx === 0 && !bankerReveal;
  }

  // Once a hand is actually decided, or the round is over, nothing about it
  // is secret any more -- this covers a resolved win/loss AND (via
  // roundTerminated) the "everyone's cards flip" moment at round end.
  if (turn.state === "won" || turn.state === "lost" || roundTerminated) return false;

  const isBlattPhase = (turn.bet ?? 0) === 0;
  const betStart = turn.betStartIndex;
  const hasBet = typeof betStart === "number";
  // A "blatt" card: a free peek drawn before any wager landed. Visible to
  // the whole table regardless of what happens next -- it's how the game
  // builds tension. Once betStartIndex exists, everything from there on is a
  // real wagered draw and stays hidden; before it exists, the turn hasn't
  // wagered yet at all, so cards 1+ are (so far) all blatts.
  const isBlattCard = hasBet ? idx > 0 && idx < betStart : isBlattPhase && idx > 0;

  // Standing on a wager (turn.state "standby") does NOT reveal it -- see
  // totalDisplay's own comment: a player who stood keeps their hand hidden
  // from everyone still deciding theirs, exactly as if they were still
  // playing. Only the free blatt cards, if any, stay visible.
  if (turn.state === "standby") return !isBlattCard;
  if (isBlattPhase) return idx === 0;
  if (hasBet) return idx === 0 || idx >= betStart;
  return true;
}

function redactTurn(turn: Turn, viewerId: string | undefined, roundTerminated: boolean): Turn {
  let changed = false;
  const cards = turn.cards.map((card, idx) => {
    if (!isCardHidden(turn, idx, viewerId, roundTerminated)) return card;
    changed = true;
    return REDACTED_CARD;
  });
  return changed ? { ...turn, cards } : turn;
}

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

// Independent of MAX_MSGS_PER_WINDOW above: that one bounds a single
// SOCKET's total message rate, but room:create has no cost of its own
// beyond it, so one connection sending room:create in a loop could exhaust
// the platform-wide room cap (limits.ts's maxRooms, 150 by default) in
// under a minute -- denying every OTHER player on the box the ability to
// create a room until one ages out naturally, which for a real room is up
// to three days.
//
// A WINDOWED COUNT, not a flat cooldown after one success: a flat "one per
// 30s" was tried first and rejected before it shipped, on the same grounds
// MAX_CONNS_PER_IP's own comment already documents -- dozens of players are
// commonly behind the same home-WiFi NAT, and on a night with more than one
// household hosting, a SECOND real banker on that NAT creating their own
// table minutes after the first is entirely ordinary, not abuse. A window
// with real headroom (5 creates per IP per minute) accommodates that easily
// while still turning "exhaust the 150-room cap in under a minute" into "at
// minimum 30 minutes, from one IP" -- enough that an operator has time to
// notice and reach for the admin page's lockdown, which is the actual goal;
// this was never going to stop a determined attacker rotating addresses
// (nothing per-IP does -- see MAX_CONNS_PER_IP's own comment on that), only
// raise the floor on an accidental or lazy one.
const ROOM_CREATE_WINDOW_MS = 60_000;
const MAX_ROOM_CREATES_PER_WINDOW = 5;
const MAX_TRACKED_ROOM_CREATE_IPS = 500;

export class WSServer {
  private wss: WebSocketServer;
  private store: GameStore;
  private rooms = new Map<string, Set<WebSocket>>();
  private meta = new WeakMap<WebSocket, ConnectionMeta>();
  private connsByIp = new Map<string, Set<WebSocket>>();
  private msgCount = new WeakMap<WebSocket, { count: number; resetAt: number }>();
  // Admin "Watch" grants, minted by the admin page and redeemed by room:watch.
  // Held here rather than in the store because they are connection-level
  // authorisation, not game state, and must not survive a restart: the admin
  // panel re-renders its links every 15s, so a lost grant costs one refresh.
  private watchTokens = new Map<string, { roomId: string; expires: number }>();
  // Successful room:create count per IP within the current window, and the
  // same for room:create-practice, kept SEPARATE -- see
  // ROOM_CREATE_WINDOW_MS above. One map for both would block the entirely
  // ordinary "try the practice table, then create a real one" sequence; the
  // two draw from different capacity pools (limits.ts's maxRooms vs
  // maxPracticeRooms) and deserve independent throttles.
  private roomCreatesByIp = new Map<string, { count: number; resetAt: number }>();
  private practiceCreatesByIp = new Map<string, { count: number; resetAt: number }>();

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
    const ipKey = resolveClientIp(request.headers, request.socket.remoteAddress);
    const userAgentHeader = request.headers["user-agent"];
    const userAgent = Array.isArray(userAgentHeader) ? userAgentHeader[0] : userAgentHeader;

    const existing = this.connsByIp.get(ipKey) ?? new Set();
    if (existing.size >= MAX_CONNS_PER_IP) {
      console.warn(`Rate limit: too many connections from ${ipKey} (${existing.size}), dropping`);
      socket.close(1008, "too_many_connections");
      return;
    }
    existing.add(socket);
    this.connsByIp.set(ipKey, existing);
    metrics.wsConnectionOpened();

    this.meta.set(socket, { ip: ipKey, userAgent: userAgent ?? undefined });
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
          // unhandled rejection terminates the process (Node 15+), so a db
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
          const createIp = this.meta.get(socket)?.ip ?? "unknown";
          if (WSServer.createThrottled(this.roomCreatesByIp, createIp)) throw new Error("room_create_throttled");
          const { room, player, sessionToken } = this.store.createRoom({ firstName, lastName, roomName, password, buyIn, roomId, bankerBankroll });
          WSServer.recordCreate(this.roomCreatesByIp, createIp);
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
          const practiceIp = this.meta.get(socket)?.ip ?? "unknown";
          if (WSServer.createThrottled(this.practiceCreatesByIp, practiceIp)) throw new Error("room_create_throttled");
          const { room, player, sessionToken } = this.store.createPracticeRoom({ firstName, botCount, buyIn, bankBuyIn, deckCount });
          WSServer.recordCreate(this.practiceCreatesByIp, practiceIp);
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
            round: round ? this.sanitizeRound(round, player.id) : undefined,
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
        // The admin panel's Watch link. A watcher is subscribed to the room's
        // broadcasts and nothing else: no Player, no wallet, no seat, no
        // session token.
        //
        // Deliberately NOT room:join with spectator:true, which is what the
        // lobby's own Watch button sends. That path creates a real Player, so
        // it shows in the roster, counts against maxPlayersPerRoom and is
        // announced to the table -- correct for a guest watching a friend
        // play, and the opposite of what an operator checking on a table
        // needs. The two are different features that share a verb.
        //
        // Nothing here can act on the game: every action handler reads
        // meta.playerId, and this attaches without one, so a watcher fails
        // the same guard an unauthenticated socket does. That is the whole
        // security model for this case -- there is no allow-list to keep in
        // sync with it.
        case "room:watch": {
          const { roomId, token } = (payload as any) || {};
          if (!roomId) throw new Error("invalid_payload");
          const normalizedId = String(roomId).trim().toUpperCase();
          if (!this.redeemWatchToken(token, normalizedId)) throw new Error("watch_not_allowed");
          const room = this.store.getRoom(normalizedId);
          if (!room) throw new Error("room_not_found");
          this.attachWatcher(socket, normalizedId);
          const round = room.roundId ? this.store.getRound(room.roundId) : undefined;
          this.sendAck(socket, requestId, {
            room,
            watching: true,
            // undefined viewerId -- a watcher has no player.id, and gets the
            // same conservative "nothing hidden included" view broadcastRound
            // gives it going forward (see isCardHidden's own comment).
            round: round ? this.sanitizeRound(round, undefined) : undefined,
          });
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
            round: round ? this.sanitizeRound(round, playerId) : undefined,
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
          this.sendAck(socket, requestId, { round: this.sanitizeRound(round, meta?.playerId) });
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
          this.sendAck(socket, requestId, { round: this.sanitizeRound(round, meta?.playerId) });
          break;
        }
        case "turn:stand": {
          const { roundId } = (payload as any) || {};
          const meta = this.meta.get(socket);
          const actorId = meta?.playerId;
          if (!roundId || !actorId) throw new Error("invalid_payload");
          const round = this.store.applyStand(roundId, actorId);
          this.handleRoundUpdate(round);
          this.sendAck(socket, requestId, { round: this.sanitizeRound(round, meta?.playerId) });
          break;
        }
        case "turn:hit": {
          const { roundId, eleveroon } = (payload as any) || {};
          const meta = this.meta.get(socket);
          const actorId = meta?.playerId;
          if (!roundId || !actorId) throw new Error("invalid_payload");
          const round = this.store.applyHit(roundId, actorId, { eleveroon: Boolean(eleveroon) });
          this.handleRoundUpdate(round);
          this.sendAck(socket, requestId, { round: this.sanitizeRound(round, meta?.playerId) });
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
          this.sendAck(socket, requestId, { round: this.sanitizeRound(round, meta?.playerId) });
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
          this.sendAck(socket, requestId, { round: this.sanitizeRound(round, meta?.playerId) });
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
          this.sendAck(socket, requestId, { round: this.sanitizeRound(round, meta?.playerId) });
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
        // Both of these used to take an id from the client and hand back the
        // raw object with no check at all -- reachable by a socket that had
        // never sent room:create/join/resume/watch. room:get returned the
        // FULL RoomState, plaintext password included (store.ts's getRoom
        // does no redaction), so a "password protected" table's password
        // could be read by anyone who knew the room id, without attempting
        // to join. Room ids are exactly the string players are told to
        // share to join, so this was not a brute-force problem.
        //
        // Fixed the same way every other handler already works: the
        // caller's own attached room (meta.roomId, set server-side by
        // attach()/attachWatcher(), never client-supplied) has to match the
        // room being asked about. A watch grant sets meta.roomId too, so a
        // legitimate Watch link still works -- it already receives this same
        // data via broadcast.
        case "room:get": {
          const { roomId } = (payload as any) || {};
          if (!roomId) throw new Error("invalid_payload");
          const meta = this.meta.get(socket);
          if (meta?.roomId !== roomId) throw new Error("forbidden");
          const room = this.store.getRoom(roomId);
          this.sendAck(socket, requestId, { room });
          break;
        }
        case "round:get": {
          const { roundId } = (payload as any) || {};
          if (!roundId) throw new Error("invalid_payload");
          const meta = this.meta.get(socket);
          const round = this.store.getRound(roundId);
          if (!round || meta?.roomId !== round.roomId) throw new Error("forbidden");
          this.sendAck(socket, requestId, { round: this.sanitizeRound(round, meta?.playerId) });
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
      // A single shared payload is genuinely correct here, unlike
      // broadcastRound: round.state is already "terminate" by this branch,
      // which is one of isCardHidden's own unconditional reveal cases -- so
      // redaction is a no-op for every viewer and there is nothing left to
      // keep separate per socket.
      const sanitizedRound = roundSnapshot ? this.sanitizeRound(roundSnapshot as RoundContext, undefined) : undefined;
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
  //
  // `viewerId` makes this PER-RECIPIENT rather than one shared payload: each
  // turn's cards are redacted through redactTurn for whoever is actually
  // receiving this copy. Pass the socket's own meta.playerId (undefined for
  // a room:watch spectator, which is the conservative default -- see
  // isCardHidden's own comment; a watcher sees exactly what a non-member
  // would, nothing hidden included). This is why broadcastRound can no
  // longer send one identical message to the whole room -- see its own
  // comment.
  private sanitizeRound(round: RoundState | RoundContext, viewerId: string | undefined): PublicRoundState {
    const { timer, turnTimer, botTimer, deck, turns, ...rest } = round as RoundContext;
    const roundTerminated = round.state === "terminate";
    return {
      ...rest,
      turns: turns.map((turn) => redactTurn(turn, viewerId, roundTerminated)),
      deckRemaining: deck?.length ?? 0,
    };
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

  /**
   * Issues a one-room, time-boxed grant for the admin panel's Watch link.
   *
   * The panel authenticates over HTTP on 25000; gameplay is a separate socket
   * on 25001 that has never heard of an admin session. This token is the only
   * thing carrying that authorisation across, which is why it is scoped to a
   * single room and expires: the link ends up in a browser history, and a
   * bare `?watch=1` with no proof would let anyone who learned a room id sit
   * in it unseen -- strictly worse than the visible spectator seat the lobby
   * already offers.
   */
  mintWatchToken(roomId: string, ttlMs = 30 * 60 * 1000): string {
    const now = Date.now();
    for (const [t, grant] of this.watchTokens) {
      if (grant.expires <= now) this.watchTokens.delete(t);
    }
    const token = randomBytes(18).toString("hex");
    this.watchTokens.set(token, { roomId: roomId.trim().toUpperCase(), expires: now + ttlMs });
    return token;
  }

  private redeemWatchToken(token: unknown, roomId: string): boolean {
    if (typeof token !== "string" || !token) return false;
    const grant = this.watchTokens.get(token);
    if (!grant) return false;
    if (grant.expires <= Date.now()) {
      this.watchTokens.delete(token);
      return false;
    }
    // Not deleted on use. The watcher's own tab reconnects on every network
    // blink and would otherwise be locked out of a table it is already
    // watching; the expiry is what bounds the grant.
    return grant.roomId === roomId;
  }

  private static createThrottled(map: Map<string, { count: number; resetAt: number }>, ip: string): boolean {
    const entry = map.get(ip);
    if (!entry || Date.now() > entry.resetAt) return false; // no entry, or the window has rolled over
    return entry.count >= MAX_ROOM_CREATES_PER_WINDOW;
  }

  private static recordCreate(map: Map<string, { count: number; resetAt: number }>, ip: string): void {
    const now = Date.now();
    const entry = map.get(ip);
    if (!entry || now > entry.resetAt) {
      // Bounded the same way http-server.ts's admin-login attempt tracker
      // is: a rotating IP defeats a per-IP throttle regardless, so the cap
      // here is only about keeping this map from being an unbounded place
      // to spend memory on a public endpoint, not about stopping rotation.
      // Only swept on a fresh IP's first entry in a full map -- an IP
      // already tracked just updates its own entry below, same as
      // recordFailedAttempt's identical reasoning.
      if (map.size >= MAX_TRACKED_ROOM_CREATE_IPS && !map.has(ip)) {
        let oldestKey: string | undefined;
        let oldestAt = Infinity;
        for (const [key, e] of map) {
          if (e.resetAt < oldestAt) {
            oldestAt = e.resetAt;
            oldestKey = key;
          }
        }
        if (oldestKey !== undefined) map.delete(oldestKey);
      }
      map.set(ip, { count: 1, resetAt: now + ROOM_CREATE_WINDOW_MS });
    } else {
      entry.count += 1;
    }
  }

  /**
   * Subscribes a socket to a room's broadcasts with NO player identity.
   *
   * Not a variant of attach(): the difference is the whole point. attach()
   * sets meta.playerId (which is what authorises every game action) and calls
   * recordConnection, which is what puts a row in the banker's connection
   * list. A watcher gets neither, so it is invisible to the table and inert
   * on it. It still lands in this.rooms, so onClose's empty-Set reap covers
   * it exactly as it covers a player.
   */
  private attachWatcher(socket: WebSocket, roomId: string) {
    const existing = this.meta.get(socket) ?? {};
    this.meta.set(socket, { ...existing, roomId, playerId: undefined, connectionId: undefined });
    if (!this.rooms.has(roomId)) this.rooms.set(roomId, new Set());
    this.rooms.get(roomId)!.add(socket);
  }

  private broadcastRoom(roomId: string) {
    const room = this.store.getRoom(roomId);
    if (!room) return;
    this.broadcast(roomId, { type: "room:state", roomId, payload: room });
  }

  // ONE round is now potentially as many DIFFERENT payloads as there are
  // sockets in the room -- the banker's own hole card is real in the copy
  // the banker gets and REDACTED_CARD in everyone else's, so this can no
  // longer build one message and hand it to `broadcast`. Mirrors
  // broadcastConnections's own per-socket loop, one door down, for the same
  // reason: that one redacts by isAdmin, this one by seat ownership.
  private broadcastRound(round: RoundState) {
    const sockets = this.rooms.get(round.roomId);
    if (!sockets) return;
    sockets.forEach((sock) => {
      const meta = this.meta.get(sock);
      const sanitized = this.sanitizeRound(round as RoundContext, meta?.playerId);
      this.send(sock, { type: "round:state", roomId: round.roomId, payload: sanitized });
    });
  }

  /**
   * Pushes a notice to every connected socket, in every room. Called from the
   * admin page.
   *
   * Transient on purpose: it reaches whoever is connected at the moment it is
   * sent, and is not stored or replayed to anyone who joins afterwards. The
   * thing it exists for -- "server restarting in five minutes" -- is only
   * true for a few minutes, and a stored banner would still be greeting
   * players an hour later.
   */
  /**
   * Pushes a banner to live sockets. `roomId` targets one table; omitted, it
   * goes to every table. Nothing is stored either way, so anyone who joins
   * afterwards never sees it.
   */
  broadcastNotice(text: string, level: "info" | "warning" = "info", roomId?: string): number {
    const message: ServerEnvelope = { type: "admin:notice", payload: { text, level, at: Date.now() } };
    let delivered = 0;
    // An unknown roomId must deliver to NOBODY, not fall back to everyone --
    // a stale room id in a dropdown (the table closed while the page sat open)
    // would otherwise turn "tell table ABC" into "tell the whole platform".
    const targets = roomId === undefined
      ? [...this.rooms.values()]
      : [this.rooms.get(roomId)].filter((s): s is Set<WebSocket> => s !== undefined);
    for (const sockets of targets) {
      for (const sock of sockets) {
        this.send(sock, message);
        delivered += 1;
      }
    }
    return delivered;
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
