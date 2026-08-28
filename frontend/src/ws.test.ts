import { describe, expect, it, vi, beforeEach } from "vitest";
import { WSClient, computeReconnectDelay } from "./ws";

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;
  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: (() => void) | null = null;
  closeCalls = 0;

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }

  triggerOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  triggerClose() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  send() {}

  // Real browsers fire "close" asynchronously and only look up the current
  // onclose handler at dispatch time -- mimic that here (rather than no-op)
  // so a test can prove WSClient.close() nulled the handler BEFORE this runs.
  close() {
    this.closeCalls += 1;
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
}

describe("WSClient", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    // @ts-expect-error test stub, only the members WSClient touches are implemented
    global.WebSocket = MockWebSocket;
  });

  it("does not open a second socket if connect() is called again before the first one opens", () => {
    // Regression test: React StrictMode double-invokes effects in dev, which called
    // client.connect() twice in a row. Two live sockets both attempted to resume the
    // same session token; the loser's invalid_session error wiped the winner's
    // just-restored room/round state. connect() must be a no-op while already connecting.
    const client = new WSClient("ws://test");
    client.connect();
    client.connect();
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("allows a fresh connect() once the previous socket has opened and later closed", () => {
    const client = new WSClient("ws://test");
    client.connect();
    MockWebSocket.instances[0].triggerOpen();
    MockWebSocket.instances[0].triggerClose();
    // onclose schedules its own retry via setTimeout, so an explicit connect() here
    // would be a no-op only while genuinely mid-connect/open — after a real close,
    // a fresh manual connect() should be allowed to create a new socket.
    client.connect();
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it("fires onOpen only once per socket even when connect() is called redundantly", () => {
    const client = new WSClient("ws://test");
    const openSpy = vi.fn();
    client.onOpen(openSpy);
    client.connect();
    client.connect();
    client.connect();
    MockWebSocket.instances[0].triggerOpen();
    expect(openSpy).toHaveBeenCalledTimes(1);
  });

  describe("close()", () => {
    it("closes the underlying socket and does not schedule a reconnect", () => {
      vi.useFakeTimers();
      const client = new WSClient("ws://test");
      const reconnectSpy = vi.fn();
      client.connect(reconnectSpy);
      MockWebSocket.instances[0].triggerOpen();

      client.close();

      expect(MockWebSocket.instances[0].closeCalls).toBe(1);
      // The mock's close() invokes onclose synchronously, exactly like a real
      // socket eventually would -- if WSClient.close() didn't null the
      // handler first, this would schedule a reconnect via setTimeout.
      vi.advanceTimersByTime(5000);
      expect(MockWebSocket.instances).toHaveLength(1);
      expect(reconnectSpy).not.toHaveBeenCalled();
      vi.useRealTimers();
    });

    it("cancels a reconnect that was ALREADY counting down when close() was called", () => {
      // The test above proves close() stops a reconnect by nulling onclose on
      // a live socket. This is the other order, and the one that actually
      // happens: the network drops first, onclose schedules a retry, and the
      // player hits Leave somewhere in the 1.5-15s backoff. close() used to
      // not keep the timer handle at all, so nothing cancelled it -- it fired
      // afterwards, flipped the UI to "connecting" and opened a socket for a
      // table the player had already walked away from. state.ts's
      // teardownRoomSession calls close() specifically to prevent a late
      // resume from undoing a leave, so this gap defeated that guarantee.
      vi.useFakeTimers();
      const client = new WSClient("ws://test");
      const reconnectSpy = vi.fn();
      client.connect(reconnectSpy);
      MockWebSocket.instances[0].triggerOpen();

      MockWebSocket.instances[0].triggerClose(); // the network drops
      client.close(); // the player leaves, mid-backoff

      // Well past MAX_RECONNECT_DELAY_MS, so a surviving timer has to fire.
      vi.advanceTimersByTime(30_000);
      expect(MockWebSocket.instances).toHaveLength(1);
      expect(reconnectSpy).not.toHaveBeenCalled();
      vi.useRealTimers();
    });

    it("delivers no further messages after close(), even if one was already in flight", () => {
      const client = new WSClient("ws://test");
      const messageSpy = vi.fn();
      client.onMessage(messageSpy);
      client.connect();
      const socket = MockWebSocket.instances[0];
      socket.triggerOpen();

      client.close();
      // Simulate a message that was already in transit when close() ran --
      // event-handler IDL attributes are read at dispatch time, so nulling
      // onmessage in close() must win even here.
      socket.onmessage?.({ data: JSON.stringify({ type: "ack" }) });

      expect(messageSpy).not.toHaveBeenCalled();
    });
  });

  describe("onmessage", () => {
    // Regression: onmessage's JSON.parse had no try/catch. The server always
    // sends its own valid JSON.stringify output, but a proxy/tunnel hiccup or
    // a truncated frame over a live connection is a real possibility -- and
    // an uncaught throw there would skip calling every listener for that
    // message, with no chance to recover, rather than just dropping the one
    // malformed message and carrying on.
    it("drops a malformed message without throwing, and still delivers the next valid one", () => {
      const client = new WSClient("ws://test");
      const messageSpy = vi.fn();
      client.onMessage(messageSpy);
      client.connect();
      const socket = MockWebSocket.instances[0];
      socket.triggerOpen();

      expect(() => socket.onmessage?.({ data: "{not valid json" })).not.toThrow();
      expect(messageSpy).not.toHaveBeenCalled();

      socket.onmessage?.({ data: JSON.stringify({ type: "ack" }) });
      expect(messageSpy).toHaveBeenCalledTimes(1);
      expect(messageSpy).toHaveBeenCalledWith({ type: "ack" });
    });
  });

  it("allows a fresh connect() after close()", () => {
    const client = new WSClient("ws://test");
    client.connect();
    MockWebSocket.instances[0].triggerOpen();
    client.close();
    client.connect();
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  describe("reconnect backoff", () => {
    it("computeReconnectDelay grows with each attempt, capped, with jitter bounded to +/-20%", () => {
      const noJitter = () => 0.5; // random()=0.5 -> jitter term is exactly 0
      expect(computeReconnectDelay(0, noJitter)).toBe(1500);
      expect(computeReconnectDelay(1, noJitter)).toBe(3000);
      expect(computeReconnectDelay(2, noJitter)).toBe(6000);
      expect(computeReconnectDelay(3, noJitter)).toBe(12000);
      expect(computeReconnectDelay(4, noJitter)).toBe(15000); // capped, would otherwise be 24000
      expect(computeReconnectDelay(10, noJitter)).toBe(15000); // stays capped

      // random()=1 -> maximum positive jitter (+20% of the capped value)
      expect(computeReconnectDelay(0, () => 1)).toBe(1800);
      // random()=0 -> maximum negative jitter (-20% of the capped value)
      expect(computeReconnectDelay(0, () => 0)).toBe(1200);
    });

    it("schedules each successive failed reconnect with a growing delay", () => {
      vi.useFakeTimers();
      const setTimeoutSpy = vi.spyOn(global, "setTimeout");
      const client = new WSClient("ws://test");
      client.connect();
      MockWebSocket.instances[0].triggerClose(); // 1st failure -> attempt 0
      vi.advanceTimersByTime(computeReconnectDelay(0, () => 0.5) * 2); // generously clear jitter range
      MockWebSocket.instances[1].triggerClose(); // 2nd failure -> attempt 1

      const delays = setTimeoutSpy.mock.calls.map((call) => call[1] as number);
      // First scheduled reconnect (~1500ms band) came before the second (~3000ms band).
      expect(delays[0]).toBeGreaterThanOrEqual(1200);
      expect(delays[0]).toBeLessThanOrEqual(1800);
      expect(delays[1]).toBeGreaterThanOrEqual(2400);
      expect(delays[1]).toBeLessThanOrEqual(3600);
      vi.useRealTimers();
    });

    it("resets the backoff once a connection successfully opens", () => {
      vi.useFakeTimers();
      const setTimeoutSpy = vi.spyOn(global, "setTimeout");
      const client = new WSClient("ws://test");
      client.connect();
      MockWebSocket.instances[0].triggerClose(); // attempt 0 used up
      vi.advanceTimersByTime(2000);
      MockWebSocket.instances[1].triggerOpen(); // success resets the counter
      MockWebSocket.instances[1].triggerClose(); // should be back to attempt 0's delay band

      const lastDelay = setTimeoutSpy.mock.calls.at(-1)?.[1] as number;
      expect(lastDelay).toBeGreaterThanOrEqual(1200);
      expect(lastDelay).toBeLessThanOrEqual(1800);
      vi.useRealTimers();
    });
  });
});
