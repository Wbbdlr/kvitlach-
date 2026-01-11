import { createHttpServer } from "./http-server.js";
import { GameStore } from "./store.js";
import { WSServer } from "./ws-server.js";

const PORT_WS = Number(process.env.WS_PORT || 3001);
const PORT_HTTP = Number(process.env.PORT || 3000);

async function main() {
  const store = new GameStore();
  new WSServer(store, PORT_WS);

  const app = createHttpServer();
  await app.listen({ port: PORT_HTTP, host: "0.0.0.0" });
  console.log(`HTTP listening on http://0.0.0.0:${PORT_HTTP}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
