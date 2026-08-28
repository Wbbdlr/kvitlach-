import { createHttpServer } from "./http-server.js";
import { GameStore } from "./store.js";
import { WSServer } from "./ws-server.js";
import { Database } from "./db.js";

const PORT_WS = Number(process.env.WS_PORT || 3001);
const PORT_HTTP = Number(process.env.PORT || 3000);

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  const db = dbUrl ? new Database(dbUrl) : undefined;
  if (!db) console.warn("DATABASE_URL not set; connection logs disabled");
  if (db) await db.init();
  const store = new GameStore(db);
  await store.loadFromDB();
  new WSServer(store, PORT_WS);

  const app = createHttpServer(store);
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
