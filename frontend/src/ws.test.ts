import { describe, expect, it, vi, beforeEach } from "vitest";
import { WSClient } from "./ws";

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

    it("allows a fresh connect() after close()", () => {
      const client = new WSClient("ws://test");
      client.connect();
      MockWebSocket.instances[0].triggerOpen();
      client.close();
      client.connect();
      expect(MockWebSocket.instances).toHaveLength(2);
    });
  });
});
