// Minimal in-process telemetry, exposed as Prometheus text-exposition format
// via http-server.ts's /metrics route. Deliberately not the `prom-client`
// package -- a handful of counters/gauges for a single-tenant home deploy
// doesn't need a registry/dependency for this. If real per-route or
// per-room breakdowns are ever needed, that's the point to reach for it.
//
// A class (like GameStore), not a plain module of mutable state, so tests
// can construct isolated instances instead of fighting shared singleton
// state -- the actual server wires up the one `metrics` instance below.
//
// All state here is in-memory and resets on restart, same as GameStore's
// own room/round maps -- there is no persistence story for telemetry, and
// none is needed (a scraper polls periodically; a gap across a restart is
// invisible to it).

// A round is anywhere from a quick heads-up hand to a full ~11-seat table
// working through everyone plus the banker, so this spans well under a
// minute to half an hour rather than the sub-second buckets a typical
// HTTP-latency histogram would use.
const ROUND_DURATION_BUCKETS_SECONDS = [30, 60, 120, 300, 600, 1200, 1800];

export class Metrics {
  private roundStartedAt = new Map<string, number>();
  private httpRequestsTotal = 0;
  private wsConnectionsTotal = 0;
  private wsConnectionsCurrent = 0;
  private wsMessagesTotal = 0;
  private roundsCompletedTotal = 0;
  private roundDurationSecondsSum = 0;
  private roundDurationSecondsCount = 0;
  // Prometheus buckets are cumulative (le="60" includes everything le="30"
  // too) -- recordRoundEnd relies on that by incrementing every bucket a
  // duration qualifies for, so this can be emitted as-is in render().
  private roundDurationBucketCounts = new Array(ROUND_DURATION_BUCKETS_SECONDS.length).fill(0);

  recordHttpRequest(): void {
    this.httpRequestsTotal += 1;
  }

  wsConnectionOpened(): void {
    this.wsConnectionsTotal += 1;
    this.wsConnectionsCurrent += 1;
  }

  wsConnectionClosed(): void {
    this.wsConnectionsCurrent = Math.max(0, this.wsConnectionsCurrent - 1);
  }

  wsMessageReceived(): void {
    this.wsMessagesTotal += 1;
  }

  // Called once from GameStore.startRound, right after createRound succeeds.
  recordRoundStart(roundId: string): void {
    this.roundStartedAt.set(roundId, Date.now());
  }

  // Called once from GameStore.finalizeRound -- the single chokepoint every
  // round (normal completion, banker-end, or void-abandoned) funnels
  // through in ws-server.ts's handleRoundUpdate, so this fires exactly once
  // per round regardless of how it ended.
  recordRoundEnd(roundId: string): void {
    const startedAt = this.roundStartedAt.get(roundId);
    this.roundStartedAt.delete(roundId);
    this.roundsCompletedTotal += 1;
    // No start time on record (e.g. the round was rehydrated from Postgres
    // after a server restart mid-round) -- count it as completed, but it
    // has no measurable duration to fold into the histogram.
    if (startedAt === undefined) return;
    const seconds = (Date.now() - startedAt) / 1000;
    this.roundDurationSecondsSum += seconds;
    this.roundDurationSecondsCount += 1;
    for (let i = 0; i < ROUND_DURATION_BUCKETS_SECONDS.length; i += 1) {
      if (seconds <= ROUND_DURATION_BUCKETS_SECONDS[i]) this.roundDurationBucketCounts[i] += 1;
    }
  }

  render(): string {
    const lines: string[] = [];

    lines.push("# HELP kvitlach_http_requests_total Total HTTP responses sent.");
    lines.push("# TYPE kvitlach_http_requests_total counter");
    lines.push(`kvitlach_http_requests_total ${this.httpRequestsTotal}`);

    lines.push("# HELP kvitlach_ws_connections_current Currently open WebSocket connections.");
    lines.push("# TYPE kvitlach_ws_connections_current gauge");
    lines.push(`kvitlach_ws_connections_current ${this.wsConnectionsCurrent}`);

    lines.push("# HELP kvitlach_ws_connections_total Total WebSocket connections accepted since process start.");
    lines.push("# TYPE kvitlach_ws_connections_total counter");
    lines.push(`kvitlach_ws_connections_total ${this.wsConnectionsTotal}`);

    lines.push("# HELP kvitlach_ws_messages_total Total WebSocket messages received.");
    lines.push("# TYPE kvitlach_ws_messages_total counter");
    lines.push(`kvitlach_ws_messages_total ${this.wsMessagesTotal}`);

    lines.push("# HELP kvitlach_rounds_completed_total Total rounds finalized (won/lost/voided).");
    lines.push("# TYPE kvitlach_rounds_completed_total counter");
    lines.push(`kvitlach_rounds_completed_total ${this.roundsCompletedTotal}`);

    lines.push("# HELP kvitlach_round_duration_seconds Wall-clock duration of a round, deal to finalize.");
    lines.push("# TYPE kvitlach_round_duration_seconds histogram");
    ROUND_DURATION_BUCKETS_SECONDS.forEach((bound, i) => {
      lines.push(`kvitlach_round_duration_seconds_bucket{le="${bound}"} ${this.roundDurationBucketCounts[i]}`);
    });
    lines.push(`kvitlach_round_duration_seconds_bucket{le="+Inf"} ${this.roundDurationSecondsCount}`);
    lines.push(`kvitlach_round_duration_seconds_sum ${this.roundDurationSecondsSum}`);
    lines.push(`kvitlach_round_duration_seconds_count ${this.roundDurationSecondsCount}`);

    return `${lines.join("\n")}\n`;
  }
}

export const metrics = new Metrics();
