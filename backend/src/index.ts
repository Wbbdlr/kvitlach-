import { createHttpServer } from "./http-server.js";
import { GameStore } from "./store.js";
import { WSServer } from "./ws-server.js";
import { Database } from "./db.js";
import { AccessControl, accessFromEnv, type AccessRecord } from "./access.js";
import { RuntimeLimits, limitsFromEnv, type LimitsRecord } from "./limits.js";
import { adminAuthFromEnv } from "./admin-auth.js";
import { metrics } from "./metrics.js";

const PORT_WS = Number(process.env.WS_PORT || 3001);
const PORT_HTTP = Number(process.env.PORT || 3000);
const ACCESS_SETTING_KEY = "access";
const LIMITS_SETTING_KEY = "limits";

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  const db = dbUrl ? new Database(dbUrl) : undefined;
  if (!db) console.warn("DATABASE_URL not set; connection logs disabled");
  if (db) await db.init();
  // Same shape as the access record below: env is the boot default, the
  // settings row is the more recent decision and wins.
  const limits = new RuntimeLimits((record) => {
    void db?.putSetting(LIMITS_SETTING_KEY, record).catch((e) => console.error("db putSetting(limits)", e));
  });
  limits.hydrate(limitsFromEnv());
  const store = new GameStore(db, limits);
  await store.loadFromDB();

  // ONE AccessControl, shared by the HTTP admin page that mutates it and the
  // WS server that enforces it. Two instances would mean an operator
  // flipping the lockdown switch and gameplay never hearing about it.
  const access = new AccessControl((record) => {
    void db
      ?.putSetting(ACCESS_SETTING_KEY, record)
      .catch((e) => console.error("db putSetting(access)", e));
  });
  access.hydrate(accessFromEnv());
  // Storage wins over env: env is the boot default, but a lockdown flipped at
  // 2am from the admin page is the more recent decision and the one that has
  // to survive the restart that follows.
  if (db) {
    try {
      access.hydrate(await db.getSetting<AccessRecord>(ACCESS_SETTING_KEY));
    } catch (e) {
      console.error("db getSetting(access); falling back to env defaults", e);
    }
  }
  if (db) {
    try {
      limits.hydrate(await db.getSetting<LimitsRecord>(LIMITS_SETTING_KEY));
    } catch (e) {
      console.error("db getSetting(limits); falling back to env defaults", e);
    }
  }
  console.log(`access mode: ${access.getMode()} (${access.snapshot().codeCount} code(s))`);
  console.log(`limits: ${limits.maxRooms} rooms, ${limits.maxPracticeRooms} practice, ${limits.maxPlayersPerRoom} players/room`);

  const auth = adminAuthFromEnv();
  if (!auth.enabled && !process.env.ADMIN_TOKEN) {
    console.warn("admin panel disabled: set ADMIN_USERNAME + ADMIN_PASSWORD_HASH (or ADMIN_TOKEN)");
  }
  // A plaintext password works, but says so every boot. On a box where the
  // panel is now reachable from other machines, "it was only ever meant to be
  // temporary" is exactly the thing that needs a recurring reminder.
  if (process.env.ADMIN_PASSWORD && !process.env.ADMIN_PASSWORD_HASH) {
    console.warn("ADMIN_PASSWORD is plaintext; prefer ADMIN_PASSWORD_HASH (npm run hash-password)");
  }

  metrics.startEventLoopSampler();
  const ws = new WSServer(store, PORT_WS, access);

  const app = createHttpServer(store, {
    access,
    limits,
    auth,
    broadcast: (text, level, roomId) => ws.broadcastNotice(text, level, roomId),
    // Where the player-facing app lives, for the panel's Watch links. The
    // panel answers on 25000 and the app is served by nginx behind the
    // tunnel, so it cannot infer this from its own request host.
    appUrl: process.env.PUBLIC_APP_URL || "https://kvitlach.us",
  });
  await app.listen({ port: PORT_HTTP, host: "0.0.0.0" });
  console.log(`HTTP listening on http://0.0.0.0:${PORT_HTTP}`);
}

// Backstop, not a strategy: every known fire-and-forget path catches at its
// own call site, and those catches are what actually keep things running. This
// exists because the default for an unhandled rejection on Node 20 is to kill
// the process, and one stray promise in one player's disconnect should not end
// the night for everyone else. Logged loudly so a rejection that lands here is
// treated as a bug to fix at its source rather than quietly swallowed forever.
process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION (backstopped, not crashing)", reason);
});

// uncaughtException is different and deliberately still fatal: by then the
// process may hold half-applied state, and compose restarts us anyway. Logging
// first only buys a readable cause -- the default handler prints a bare stack
// with no marker saying it was what took the server down.
process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION (exiting; compose will restart)", err);
  process.exit(1);
});

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
