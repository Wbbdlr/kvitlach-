import { GameStore } from "./dist/store.js";
const store = new GameStore();
const { room, player: human } = store.createPracticeRoom({ firstName: "Solo", botCount: 2, buyIn: 100, bankBuyIn: 100 });
const r = store.startRound(room.roomId, human.id);
console.log("turns:", r.turns.map((t, i) => `${i}:${t.player.firstName}${t.player.type === "admin" ? "(BANKER)" : ""}${t.player.isBot ? "[bot]" : "[HUMAN]"} ${t.state}`).join("\n       "));
