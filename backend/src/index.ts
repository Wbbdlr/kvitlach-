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
  new WSServer(store, PORT_WS);

  const app = createHttpServer();
  await app.listen({ port: PORT_HTTP, host: "0.0.0.0" });
  console.log(`HTTP listening on http://0.0.0.0:${PORT_HTTP}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
