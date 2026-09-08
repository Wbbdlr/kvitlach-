import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import { GameStore } from "../store.js";
import { WSServer } from "../ws-server.js";

// The panel's Protections page is only worth having if its numbers are the
// numbers being enforced. So this drives the real limiter over a real socket
// and then reads the snapshot, rather than asserting against a counter poked
// by hand -- the failure this guards against is a page that reports a quiet
// night while the server is refusing connections.

const PORT = 39781;
const URL = `ws://127.0.0.1:${PORT}`;

let store: GameStore;
let server: WSServer;

beforeAll(() => {
  store = new GameStore();
  server = new WSServer(store, PORT);
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

let reqCounter = 0;
function send(ws: WebSocket, type: string, payload: unknown): Promise<any> {
  const requestId = `r${++reqCounter}`;
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

describe("protection snapshot", () => {
  it("reports the limits actually in force, not a remembered copy", () => {
    const snap = server.protectionSnapshot();
    expect(snap.kinds.map((k) => k.kind)).toEqual(["connections", "messages", "roomCreates", "practiceCreates"]);
    // These are the module constants in ws-server.ts. If one is changed and
    // this test is not, that is the right kind of failure: it means the page
    // and the limiter are still reading the same thing.
    expect(snap.kinds.find((k) => k.kind === "connections")!.limit).toBe(80);
    expect(snap.kinds.find((k) => k.kind === "messages")!.limit).toBe(30);
    expect(snap.kinds.find((k) => k.kind === "roomCreates")!.limit).toBe(5);
  });

  it("counts an open socket against the IP that holds it, and forgets it on close", async () => {
    const before = server.protectionSnapshot().connectionsByIp.reduce((n, row) => n + row.count, 0);
    const ws = await connect();
    await new Promise((r) => setTimeout(r, 50));
    const during = server.protectionSnapshot().connectionsByIp.reduce((n, row) => n + row.count, 0);
    expect(during).toBe(before + 1);

    ws.close();
    await new Promise((r) => setTimeout(r, 100));
    const after = server.protectionSnapshot().connectionsByIp.reduce((n, row) => n + row.count, 0);
    expect(after).toBe(before);
  });

  it("counts a throttled room creation, which nothing recorded before", async () => {
    expect(server.protectionSnapshot().kinds.find((k) => k.kind === "roomCreates")!.rejected).toBe(0);

    const ws = await connect();
    // Five is the window's allowance; the sixth is the one that gets refused.
    for (let i = 0; i < 5; i++) {
      await send(ws, "room:create", { firstName: `Banker${i}` });
    }
    await expect(send(ws, "room:create", { firstName: "OneTooMany" })).rejects.toThrow("room_create_throttled");

    const kind = server.protectionSnapshot().kinds.find((k) => k.kind === "roomCreates")!;
    expect(kind.rejected).toBe(1);
    expect(kind.lastAt).toBeGreaterThan(0);
    expect(kind.lastIp).toBeTruthy();

    // The window itself is visible while it is open -- five successful
    // creations against one address is what an operator would want to see.
    const window = server.protectionSnapshot().createWindows.find((w) => w.kind === "roomCreates");
    expect(window?.count).toBe(5);
    expect(window?.resetAt).toBeGreaterThan(Date.now());

    ws.close();
  });
});
