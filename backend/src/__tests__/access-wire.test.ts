import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import { GameStore } from "../store.js";
import { WSServer } from "../ws-server.js";
import { AccessControl } from "../access.js";
import { createHttpServer } from "../http-server.js";

// access.test.ts covers the rule; this covers the WIRING -- that the gate
// really does sit in front of create/join/practice over a real socket, that
// resume really does bypass it, and that the admin route really does flip the
// same instance gameplay reads. All four are things a unit test of the class
// alone would happily pass while the app stayed wide open.
const PORT = 39741;
const URL = `ws://127.0.0.1:${PORT}`;

let store: GameStore;
let server: WSServer;
let access: AccessControl;

beforeAll(() => {
  store = new GameStore();
  access = new AccessControl();
  server = new WSServer(store, PORT, access);
});
afterAll(() => {
  (server as unknown as { wss: { close: () => void } }).wss.close();
});

function connect(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

let n = 0;
function send(ws: WebSocket, type: string, payload: unknown): Promise<any> {
  const requestId = `a${++n}`;
  return new Promise((resolve, reject) => {
    const onMessage = (data: WebSocket.RawData) => {
      const msg = JSON.parse(data.toString());
      if (msg.requestId !== requestId) return;
      ws.off("message", onMessage);
      if (msg.type === "error") reject(new Error(msg.error?.message ?? "error"));
      else resolve(msg.payload);
    };
    ws.on("message", onMessage);
    ws.send(JSON.stringify({ type, payload, requestId }));
  });
}

describe("access control over the wire", () => {
  it("gates room:create, room:join and room:create-practice in invite mode", async () => {
    const ws = await connect();
    try {
      access.setMode("open");
      const created = await send(ws, "room:create", { firstName: "Host" });
      const roomId = created.room.roomId;

      access.setCodes(["latke"]);
      access.setMode("invite");

      await expect(send(ws, "room:create", { firstName: "Nope" })).rejects.toThrow("invite_required");
      await expect(send(ws, "room:create-practice", { firstName: "Nope" })).rejects.toThrow("invite_required");
      await expect(send(ws, "room:join", { roomId, firstName: "Nope" })).rejects.toThrow("invite_required");

      await expect(send(ws, "room:join", { roomId, firstName: "Nope", accessCode: "wrong" })).rejects.toThrow(
        "invalid_invite"
      );
    } finally {
      access.setMode("open");
      ws.close();
    }
  });

  it("lets a correct code through on all three", async () => {
    const ws = await connect();
    try {
      access.setMode("open");
      const created = await send(ws, "room:create", { firstName: "Host" });
      const roomId = created.room.roomId;
      access.setCodes(["Latke"]);
      access.setMode("invite");

      // Typed the way a person would, not the way it was stored.
      const joiner = await connect();
      const joined = await send(joiner, "room:join", { roomId, firstName: "Guest", accessCode: " LATKE " });
      expect(joined.room.roomId).toBe(roomId);
      joiner.close();

      const practice = await connect();
      const p = await send(practice, "room:create-practice", { firstName: "Solo", accessCode: "latke" });
      expect(p.room.practice).toBe(true);
      practice.close();
    } finally {
      access.setMode("open");
      ws.close();
    }
  });

  it("refuses everything in closed mode, even with a valid code", async () => {
    const ws = await connect();
    try {
      access.setCodes(["latke"]);
      access.setMode("closed");
      await expect(send(ws, "room:create", { firstName: "X", accessCode: "latke" })).rejects.toThrow("locked_down");
      await expect(send(ws, "room:create-practice", { firstName: "X", accessCode: "latke" })).rejects.toThrow(
        "locked_down"
      );
    } finally {
      access.setMode("open");
      ws.close();
    }
  });

  // The rule that matters most: a lockdown must not eject people mid-hand.
  it("never blocks room:resume, in either invite or closed mode", async () => {
    const host = await connect();
    try {
      access.setMode("open");
      const created = await send(host, "room:create", { firstName: "Seated" });
      const { roomId, playerId } = created.session;
      // resumePlayer rotates the session token on every successful resume, so
      // the second pass has to use the one the first pass handed back.
      let token: string = created.session.token;
      host.close();

      for (const mode of ["invite", "closed"] as const) {
        access.setCodes(["latke"]);
        access.setMode(mode);
        const back = await connect();
        const resumed = await send(back, "room:resume", { roomId, playerId, token });
        expect(resumed.room.roomId).toBe(roomId);
        token = resumed.session.token;
        back.close();
      }
    } finally {
      access.setMode("open");
    }
  });

  it("flips the same instance the admin route writes to", async () => {
    process.env.ADMIN_TOKEN = "wire-test-token";
    const app = createHttpServer(store, access);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/admin/access?token=wire-test-token",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        payload: "mode=closed",
      });
      expect(res.statusCode).toBe(302);
      expect(access.getMode()).toBe("closed");

      const ws = await connect();
      await expect(send(ws, "room:create", { firstName: "X" })).rejects.toThrow("locked_down");
      ws.close();

      await app.inject({
        method: "POST",
        url: "/admin/access?token=wire-test-token",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        payload: "codes=alpha%0Abeta",
      });
      // Saving codes must not have silently reset the mode.
      expect(access.getMode()).toBe("closed");
      expect(access.snapshot().codeCount).toBe(2);
    } finally {
      access.setMode("open");
      delete process.env.ADMIN_TOKEN;
      await app.close();
    }
  });

  it("refuses the admin route without a valid token", async () => {
    process.env.ADMIN_TOKEN = "wire-test-token";
    const app = createHttpServer(store, access);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/admin/access?token=nope",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        payload: "mode=closed",
      });
      expect(res.statusCode).toBe(404);
      expect(access.getMode()).toBe("open");
    } finally {
      delete process.env.ADMIN_TOKEN;
      await app.close();
    }
  });

  it("reports load and access mode on /health/detail", async () => {
    const app = createHttpServer(store, access);
    try {
      const res = await app.inject({ method: "GET", url: "/health/detail" });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe("ok");
      expect(body.accessMode).toBe("open");
      for (const key of ["rooms", "practiceRooms", "players", "activeRounds", "wsConnections", "eventLoopLagMs", "rssMb"]) {
        expect(typeof body[key]).toBe("number");
      }
    } finally {
      await app.close();
    }
  });
});
