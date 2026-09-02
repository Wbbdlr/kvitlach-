import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
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
  // Every client is registered so it can be torn down: WSClient attaches
  // visibilitychange/online/pageshow handlers to the shared jsdom document
  // (see bindLifecycle), so a client left alive by one test goes on opening
  // sockets in response to the NEXT test's events. Harmless in a browser,
  // where there is one client for the life of the page; not harmless here.
  const created: WSClient[] = [];
  function newClient(url = "ws://test") {
    const client = new WSClient(url);
    created.push(client);
    return client;
  }
  afterEach(() => {
    while (created.length) created.pop()!.close();
  });

  beforeEach(() => {
    MockWebSocket.instances = [];
    // The backoff tests below spy on global.setTimeout and swap in fake
    // timers. Neither was being undone, so both leaked into whatever ran
    // next -- harmless while they were the last tests in the file, and a
    // "setTimeout is not defined" in every test added after them. Restored
    // here rather than in each test: this is the state every test in this
    // file wants to start from.
    vi.restoreAllMocks();
    vi.useRealTimers();
    // @ts-expect-error test stub, only the members WSClient touches are implemented
    global.WebSocket = MockWebSocket;
  });

  it("does not open a second socket if connect() is called again before the first one opens", () => {
    // Regression test: React StrictMode double-invokes effects in dev, which called
    // client.connect() twice in a row. Two live sockets both attempted to resume the
    // same session token; the loser's invalid_session error wiped the winner's
    // just-restored room/round state. connect() must be a no-op while already connecting.
    const client = newClient();
    client.connect();
    client.connect();
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("allows a fresh connect() once the previous socket has opened and later closed", () => {
    const client = newClient();
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
    const client = newClient();
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
      const client = newClient();
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
      const client = newClient();
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
      const client = newClient();
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
      const client = newClient();
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
    const client = newClient();
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
      const client = newClient();
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
      const client = newClient();
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

  // Backgrounding the browser was reported as breaking the game outright: a
  // player leaves the app mid-hand, comes back, and the table is dead. None of
  // the reconnect machinery is broken -- it is asleep, and it wakes up holding
  // a backoff earned while the radio was off.
  describe("waking from a backgrounded tab", () => {
    function hide() {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    }
    function show() {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
    }

    it("reconnects immediately instead of waiting out a backoff it earned while asleep", () => {
      vi.useFakeTimers();
      try {
        const client = newClient();
        client.connect();
        // Four failed attempts puts the next retry at the 15s ceiling.
        for (let i = 0; i < 4; i += 1) {
          MockWebSocket.instances[MockWebSocket.instances.length - 1].triggerClose();
          vi.advanceTimersByTime(30_000);
        }
        const beforeWake = MockWebSocket.instances.length;
        MockWebSocket.instances[beforeWake - 1].triggerClose();

        hide();
        show();

        // A new socket NOW, with no timer advanced at all -- the point of the
        // fix. Before it, this player waited up to 15 more seconds.
        expect(MockWebSocket.instances.length).toBe(beforeWake + 1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("leaves a healthy socket alone on an ordinary tab switch", () => {
      const client = newClient();
      client.connect();
      MockWebSocket.instances[0].triggerOpen();
      hide();
      show();
      // No reconnect, no flash of "connecting": nothing was wrong.
      expect(MockWebSocket.instances.length).toBe(1);
      expect(MockWebSocket.instances[0].closeCalls).toBe(0);
    });

    it("replaces a socket that still claims OPEN after a long absence", () => {
      // The half-open case: the phone was away long enough for the server to
      // have hung up, but this tab was frozen and never saw the close. It
      // cannot be detected, only assumed -- see STALE_AFTER_HIDDEN_MS.
      vi.useFakeTimers();
      try {
        const client = newClient();
        client.connect();
        MockWebSocket.instances[0].triggerOpen();
        hide();
        vi.advanceTimersByTime(60_000);
        show();
        expect(MockWebSocket.instances.length).toBe(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it("keeps queued messages across the wake", () => {
      // discardSocket(), not close(): an action taken just before the drop
      // should still go out on the socket that replaces the dead one.
      const client = newClient();
      client.connect();
      MockWebSocket.instances[0].triggerClose();
      client.send("turn:stand");
      hide();
      show();
      const fresh = MockWebSocket.instances[MockWebSocket.instances.length - 1];
      const sent = vi.spyOn(fresh, "send");
      fresh.triggerOpen();
      expect(sent).toHaveBeenCalledTimes(1);
      expect(sent.mock.calls[0][0]).toContain("turn:stand");
    });

    it("leaves a socket that is still opening alone", () => {
      // A socket mid-handshake has not had its chance yet. Discarding it to
      // start another puts two sockets in a race to resume one session token,
      // and the loser's invalid_session wipes out the winner's restored state
      // -- seen as a player who reloaded mid-round coming back with no seat.
      const client = newClient();
      client.connect();
      expect(MockWebSocket.instances[0].readyState).toBe(MockWebSocket.CONNECTING);
      hide();
      show();
      window.dispatchEvent(new Event("online"));
      expect(MockWebSocket.instances).toHaveLength(1);
      expect(MockWebSocket.instances[0].closeCalls).toBe(0);
    });

    it("does not resurrect a session the player deliberately left", () => {
      // close() is the Leave button. It leaves no socket and no timer, which
      // is indistinguishable from a drop -- so without an explicit guard the
      // first tab switch afterwards would reopen the room they walked out of.
      const client = newClient();
      client.connect();
      MockWebSocket.instances[0].triggerOpen();
      client.close();
      const afterClose = MockWebSocket.instances.length;
      hide();
      show();
      window.dispatchEvent(new Event("online"));
      expect(MockWebSocket.instances.length).toBe(afterClose);
    });

    it("reconnects when the network comes back, without a tab switch", () => {
      const client = newClient();
      client.connect();
      MockWebSocket.instances[0].triggerClose();
      const before = MockWebSocket.instances.length;
      window.dispatchEvent(new Event("online"));
      expect(MockWebSocket.instances.length).toBe(before + 1);
    });

    it("tells the UI it is reconnecting rather than silently reopening", () => {
      const client = newClient();
      const onReconnect = vi.fn();
      client.connect(onReconnect);
      MockWebSocket.instances[0].triggerClose();
      onReconnect.mockClear();
      hide();
      show();
      expect(onReconnect).toHaveBeenCalled();
    });
  });
});
