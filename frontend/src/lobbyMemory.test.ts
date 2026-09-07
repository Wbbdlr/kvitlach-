import { describe, expect, it, vi, beforeEach } from "vitest";

// The lobby prefills the Game ID box from the last table you played
// (App.tsx's loadLastRoomId). That is right when the table is still there and
// only your session went stale -- you reload, your token has expired, and the
// code you need is already typed in.
//
// It is wrong once the ROOM is gone. Seen on a fresh visit: the Game ID box
// held a code from a table that no longer existed, and pressing Join answered
// "Room not found" about something the player never typed. The auto-resume
// that discovered the room was gone cleared the seat and left the memory of
// the table behind.

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static CONNECTING = 0; static OPEN = 1; static CLOSED = 3;
  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  onclose: (() => void) | null = null;
  sent: Array<{ type: string; payload?: any; requestId: string }> = [];
  constructor(public url: string) { MockWebSocket.instances.push(this); }
  send(d: string) { this.sent.push(JSON.parse(d)); }
  close() { this.readyState = MockWebSocket.CLOSED; this.onclose?.(); }
  triggerOpen() { this.readyState = MockWebSocket.OPEN; this.onopen?.(); }
}

const SESSION_KEY = "kvitlach.session";
const LAST_ROOM_KEY = "kvitlach.lastRoomId";

beforeEach(() => {
  MockWebSocket.instances = [];
  (globalThis as any).WebSocket = MockWebSocket as any;
  window.localStorage.clear();
});

async function resumeInto(errorCode: string) {
  window.localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({ roomId: "GONE1", playerId: "p1", token: "t", savedAt: Date.now() })
  );
  window.localStorage.setItem(LAST_ROOM_KEY, "GONE1");

  vi.resetModules();
  const { useGameStore } = await import("./state");
  useGameStore.getState().init();
  const socket = MockWebSocket.instances[0];
  socket.triggerOpen();

  const resume = socket.sent.find((m) => m.type === "room:resume");
  expect(resume, "the store should have tried to resume the saved seat").toBeTruthy();
  socket.onmessage?.({
    data: JSON.stringify({ type: "error", requestId: resume!.requestId, error: { message: errorCode } }),
  });
  return useGameStore;
}

describe("what the lobby remembers after a failed auto-resume", () => {
  it("forgets a table the server says no longer exists", async () => {
    await resumeInto("room_not_found");
    expect(window.localStorage.getItem(LAST_ROOM_KEY)).toBeNull();
    expect(window.localStorage.getItem(SESSION_KEY)).toBeNull();
  });

  // The opposite case, and it is deliberate: the table is still there, only
  // the token expired, so the code the player needs is exactly the one to
  // leave in the box.
  it("keeps the table when it is only the session that expired", async () => {
    await resumeInto("invalid_session");
    expect(window.localStorage.getItem(LAST_ROOM_KEY)).toBe("GONE1");
  });
});

// The auto-resume branch only runs while a session still exists. Once it does
// not (the token expired, and the branch above deliberately kept the room id
// so the lobby could prefill it), nothing ever discovered the table had since
// ended -- so the code sat in the Game ID box on every visit from then on.
// Seen live months after the table it named had gone.
describe("a remembered table the player tries to rejoin by hand", () => {
  async function manualJoin(code: string, errorCode: string) {
    window.localStorage.setItem(LAST_ROOM_KEY, "GONE1");
    vi.resetModules();
    const { useGameStore } = await import("./state");
    useGameStore.getState().init();
    const socket = MockWebSocket.instances[0];
    socket.triggerOpen();

    useGameStore.getState().joinRoom(code, "Rivka");
    const join = socket.sent.find((m) => m.type === "room:join")!;
    socket.onmessage?.({
      data: JSON.stringify({ type: "error", requestId: join.requestId, error: { message: errorCode } }),
    });
  }

  it("forgets it once the server says that room is gone", async () => {
    await manualJoin("GONE1", "room_not_found");
    expect(window.localStorage.getItem(LAST_ROOM_KEY)).toBeNull();
  });

  it("keeps it when the player simply mistyped a different code", async () => {
    await manualJoin("TYPO9", "room_not_found");
    expect(window.localStorage.getItem(LAST_ROOM_KEY)).toBe("GONE1");
  });

  it("keeps it when the room is there and the password was wrong", async () => {
    await manualJoin("GONE1", "invalid_password");
    expect(window.localStorage.getItem(LAST_ROOM_KEY)).toBe("GONE1");
  });
});
