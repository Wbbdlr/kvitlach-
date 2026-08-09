import { describe, expect, it, vi } from "vitest";
import { Metrics } from "../metrics.js";

describe("Metrics", () => {
  it("starts every counter and gauge at zero", () => {
    const m = new Metrics();
    const text = m.render();
    expect(text).toContain("kvitlach_http_requests_total 0");
    expect(text).toContain("kvitlach_ws_connections_current 0");
    expect(text).toContain("kvitlach_ws_connections_total 0");
    expect(text).toContain("kvitlach_ws_messages_total 0");
    expect(text).toContain("kvitlach_rounds_completed_total 0");
    expect(text).toContain("kvitlach_round_duration_seconds_count 0");
  });

  it("counts HTTP requests, WS messages, and WS connection opens", () => {
    const m = new Metrics();
    m.recordHttpRequest();
    m.recordHttpRequest();
    m.wsMessageReceived();
    m.wsConnectionOpened();
    m.wsConnectionOpened();
    const text = m.render();
    expect(text).toContain("kvitlach_http_requests_total 2");
    expect(text).toContain("kvitlach_ws_messages_total 1");
    expect(text).toContain("kvitlach_ws_connections_total 2");
    expect(text).toContain("kvitlach_ws_connections_current 2");
  });

  it("tracks the current WS connection gauge up and down, never below zero", () => {
    const m = new Metrics();
    m.wsConnectionOpened();
    m.wsConnectionOpened();
    m.wsConnectionClosed();
    expect(m.render()).toContain("kvitlach_ws_connections_current 1");

    // A stray extra close (shouldn't happen given ws-server.ts's 1:1 open/close
    // wiring, but the gauge must not go negative if it ever did).
    m.wsConnectionClosed();
    m.wsConnectionClosed();
    expect(m.render()).toContain("kvitlach_ws_connections_current 0");
  });

  it("measures round duration from recordRoundStart to recordRoundEnd", () => {
    const m = new Metrics();
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValue(1_000_000);
    m.recordRoundStart("round-1");
    nowSpy.mockReturnValue(1_000_000 + 45_000); // 45 seconds later
    m.recordRoundEnd("round-1");
    nowSpy.mockRestore();

    const text = m.render();
    expect(text).toContain("kvitlach_rounds_completed_total 1");
    expect(text).toContain("kvitlach_round_duration_seconds_count 1");
    expect(text).toContain("kvitlach_round_duration_seconds_sum 45");
    // 45s qualifies for the 60/120/300/600/1200/1800/+Inf buckets, not the 30s one.
    expect(text).toContain('kvitlach_round_duration_seconds_bucket{le="30"} 0');
    expect(text).toContain('kvitlach_round_duration_seconds_bucket{le="60"} 1');
    expect(text).toContain('kvitlach_round_duration_seconds_bucket{le="+Inf"} 1');
  });

  it("still counts a round as completed even with no matching start (e.g. rehydrated mid-round after a restart)", () => {
    const m = new Metrics();
    m.recordRoundEnd("orphan-round");
    const text = m.render();
    expect(text).toContain("kvitlach_rounds_completed_total 1");
    // No duration observation recorded for it.
    expect(text).toContain("kvitlach_round_duration_seconds_count 0");
  });

  it("clears a round's start time after recordRoundEnd, so a duplicate end doesn't double-count duration", () => {
    const m = new Metrics();
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValue(0);
    m.recordRoundStart("round-1");
    nowSpy.mockReturnValue(10_000);
    m.recordRoundEnd("round-1");
    m.recordRoundEnd("round-1"); // defensive: should not happen, but must not crash or re-measure
    nowSpy.mockRestore();

    const text = m.render();
    expect(text).toContain("kvitlach_rounds_completed_total 2");
    expect(text).toContain("kvitlach_round_duration_seconds_count 1");
  });
});
