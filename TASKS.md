# Current Backlog

- Add automated frontend coverage (Vitest/Playwright) for key flows: join/create room, bet/hit/stand, banker approvals.
- Instrument server with basic telemetry (request counts, WS connections, round durations) and surface a /metrics endpoint (Prometheus-friendly).
- Provide production deploy recipe samples (systemd/compose) alongside Cloudflare Tunnel notes.
- Optional: persistence layer for sessions/rooms so tables survive process restarts.
