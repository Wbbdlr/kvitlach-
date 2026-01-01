# Daily Change Summary (2026-01-01)

- backend/src/store.ts: added 24h session TTL, expiry check on resume, and refreshed session issuance on reconnect.
- backend/src/store.ts: sanitized first/last names and notes with length caps; applied to room creation/join, rename requests, buy-in notes, and banker top-ups.
- backend/src/store.ts: locked `switchAdmin` to existing banker, blocked self-targets and admin-to-admin transfers, and audited the handoff.
- backend/src/store.ts: audited admin actions (kick, wallet-adjust, buy-in approve/reject, rename approve/reject, banker top-up) via structured console logs.
- backend/src/store.ts: banker top-up now records sanitized note and writes to audit log.
- Tests: not run in this window.
