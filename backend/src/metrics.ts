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
  private loopLagMs = 0;
  private gauges = { rooms: 0, practiceRooms: 0, players: 0, activeRounds: 0 };

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

  // Read by /health/detail, which has to answer "is it drowning" in JSON
  // rather than in the Prometheus text render() produces.
  get currentWsConnections(): number {
    return this.wsConnectionsCurrent;
  }

  // Event-loop lag is the single most useful "is this box actually coping"
  // number for a server like this one: every room's timers, every WS frame
  // and every broadcast runs on the one loop, so when it climbs, players are
  // ALREADY seeing turns land late -- well before CPU or memory look alarming.
  // A setInterval sampled against its own scheduled time costs nothing and
  // needs no native module.
  get eventLoopLagMs(): number {
    return this.loopLagMs;
  }

  // unref()'d so this timer alone can never hold the process open -- a server
  // that will not exit on SIGTERM because of a metrics ticker is a deploy
  // that hangs for its full stop-timeout on every restart.
  startEventLoopSampler(intervalMs = 500): () => void {
    let expected = Date.now() + intervalMs;
    const timer = setInterval(() => {
      const now = Date.now();
      this.loopLagMs = Math.max(0, now - expected);
      expected = now + intervalMs;
    }, intervalMs);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  // Set from GameStore on each /metrics or /health/detail read rather than
  // pushed on every mutation -- these are derived counts, and sampling them
  // at read time cannot drift out of sync with the store the way a
  // separately-incremented copy can.
  setRoomGauges(g: { rooms: number; practiceRooms: number; players: number; activeRounds: number }): void {
    this.gauges = g;
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

    lines.push("# HELP kvitlach_event_loop_lag_ms How late the event loop is running its own timer.");
    lines.push("# TYPE kvitlach_event_loop_lag_ms gauge");
    lines.push(`kvitlach_event_loop_lag_ms ${Math.round(this.loopLagMs)}`);

    lines.push("# HELP kvitlach_rooms_current Rooms currently held in memory.");
    lines.push("# TYPE kvitlach_rooms_current gauge");
    lines.push(`kvitlach_rooms_current ${this.gauges.rooms}`);

    lines.push("# HELP kvitlach_practice_rooms_current Practice rooms currently held in memory.");
    lines.push("# TYPE kvitlach_practice_rooms_current gauge");
    lines.push(`kvitlach_practice_rooms_current ${this.gauges.practiceRooms}`);

    lines.push("# HELP kvitlach_players_current Players seated across all rooms.");
    lines.push("# TYPE kvitlach_players_current gauge");
    lines.push(`kvitlach_players_current ${this.gauges.players}`);

    lines.push("# HELP kvitlach_active_rounds_current Rounds currently in play.");
    lines.push("# TYPE kvitlach_active_rounds_current gauge");
    lines.push(`kvitlach_active_rounds_current ${this.gauges.activeRounds}`);

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
