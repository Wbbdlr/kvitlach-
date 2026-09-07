import { describe, expect, it, vi, beforeEach } from "vitest";

// turnTimerExpiresAt is an absolute epoch timestamp made on the SERVER, and
// the felt was subtracting it from the DEVICE's Date.now(). That assumes the
// two machines agree about what time it is, and a phone with a hand-set clock
// does not. As a bar the error was invisible -- a constant offset just shifts
// the fill a little -- but the bar now carries a number, and a device a
// minute out would read "0s" to a player who still has their whole turn.
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

beforeEach(() => {
  MockWebSocket.instances = [];
  (globalThis as any).WebSocket = MockWebSocket as any;
  window.localStorage.clear();
});

async function connected() {
  vi.resetModules();
  const { useGameStore } = await import("./state");
  useGameStore.getState().init();
  const socket = MockWebSocket.instances[0];
  socket.triggerOpen();
  return { useGameStore, socket };
}

const roundWith = (serverNow: number | undefined) => ({
  roundId: "r1",
  roomId: "AAA",
  state: "active",
  turns: [],
  ...(serverNow === undefined ? {} : { serverNow }),
});

describe("the device's clock against the server's", () => {
  it("measures the offset off a round snapshot", async () => {
    const { useGameStore, socket } = await connected();
    const now = Date.now();
    socket.onmessage?.({ data: JSON.stringify({ type: "round:state", payload: roundWith(now + 45_000) }) });
    // ~45s fast server, i.e. this device is 45s slow. Loose bound: real time
    // passes between the stamp above and the read below.
    expect(useGameStore.getState().clockSkewMs).toBeGreaterThan(44_000);
    expect(useGameStore.getState().clockSkewMs).toBeLessThan(46_000);
  });

  it("reads ~0 on a device that agrees with the server, which is almost all of them", async () => {
    const { useGameStore, socket } = await connected();
    socket.onmessage?.({ data: JSON.stringify({ type: "round:state", payload: roundWith(Date.now()) }) });
    expect(Math.abs(useGameStore.getState().clockSkewMs)).toBeLessThan(2_000);
  });

  // Re-measured every snapshot, not once at connect: a device whose clock is
  // corrected mid-game (an NTP sync, a manual fix) would otherwise carry the
  // stale offset for the rest of the night.
  it("re-measures rather than latching the first value", async () => {
    const { useGameStore, socket } = await connected();
    socket.onmessage?.({ data: JSON.stringify({ type: "round:state", payload: roundWith(Date.now() + 60_000) }) });
    expect(useGameStore.getState().clockSkewMs).toBeGreaterThan(59_000);
    socket.onmessage?.({ data: JSON.stringify({ type: "round:state", payload: roundWith(Date.now()) }) });
    expect(Math.abs(useGameStore.getState().clockSkewMs)).toBeLessThan(2_000);
  });

  // A round arriving on an ack (a join, a resume) is the same information.
  it("takes the stamp from a round carried on an ack too", async () => {
    const { useGameStore, socket } = await connected();
    socket.onmessage?.({
      data: JSON.stringify({ type: "ack", requestId: "x", payload: { round: roundWith(Date.now() + 30_000) } }),
    });
    expect(useGameStore.getState().clockSkewMs).toBeGreaterThan(29_000);
  });

  // A round persisted before the field existed comes back without it. That
  // must leave the offset alone rather than resetting it to nonsense.
  it("ignores a snapshot with no server stamp", async () => {
    const { useGameStore, socket } = await connected();
    socket.onmessage?.({ data: JSON.stringify({ type: "round:state", payload: roundWith(Date.now() + 40_000) }) });
    const measured = useGameStore.getState().clockSkewMs;
    socket.onmessage?.({ data: JSON.stringify({ type: "round:state", payload: roundWith(undefined) }) });
    expect(useGameStore.getState().clockSkewMs).toBe(measured);
  });
});
