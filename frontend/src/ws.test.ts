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
});
