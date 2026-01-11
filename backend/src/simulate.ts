import { createRound, handleBet, handleHit, handleStand, winningNumber } from "./round.js";
import { Player, Turn } from "./types.js";

interface SimulationConfig {
  deckCounts: number[];
  playerSeats: number;
  roundsPerDeck: number;
  baseBet: number;
  playerTarget: number;
  bankerTarget: number;
}

interface Aggregate {
  deck: number;
  rounds: number;
  bankerNet: number;
  playerNet: number;
  bankerWinRounds: number;
  playerWinRounds: number;
  pushRounds: number;
  playerWins: number;
  playerLosses: number;
  playerBlackjacks: number;
  playerBusts: number;
  playerHands: number;
}

const DEFAULT_CONFIG: SimulationConfig = {
  deckCounts: [1, 2, 3, 4, 5, 6],
  playerSeats: 3,
  roundsPerDeck: 100_000,
  baseBet: 10,
  playerTarget: 17,
  bankerTarget: 17,
};

function buildPlayers(seats: number): Player[] {
  const players: Player[] = [];
  for (let i = 0; i < seats; i += 1) {
    players.push({
      id: `player-${i}`,
      firstName: `Player ${i + 1}`,
      lastName: "",
      type: "player",
      presence: "online",
    });
  }
  players.push({
    id: "banker",
    firstName: "Banker",
    lastName: "",
    type: "admin",
    presence: "online",
  });
  return players;
}

function turnLookup(round: ReturnType<typeof createRound>, id: string): Turn {
  const turn = round.turns.find((t) => t.player.id === id);
  if (!turn) throw new Error(`turn not found for ${id}`);
  return turn;
}

function playPlayer(
  round: ReturnType<typeof createRound>,
  playerId: string,
  cfg: SimulationConfig
) {
  let safety = 0;
  while (safety < 20) {
    safety += 1;
    const turn = turnLookup(round, playerId);
    if (turn.state !== "pending") return round;

    if (turn.bet === 0) {
      round = handleBet(round, playerId, cfg.baseBet);
      continue;
    }
    const best = winningNumber(turn.cards);
    if (best === undefined) return round;

    if (best < cfg.playerTarget) {
      round = handleHit(round, playerId);
      continue;
    }

    round = handleStand(round, playerId);
    return round;
  }
  throw new Error(`player loop exceeded safety guard for ${playerId}`);
}

function playBanker(round: ReturnType<typeof createRound>, cfg: SimulationConfig) {
  let safety = 0;
  while (safety < 40) {
    safety += 1;
    if (round.state === "terminate") return round;
    const bankerTurn = round.turns.find((t) => t.player.type === "admin");
    if (!bankerTurn) return round;

    if (bankerTurn.state !== "pending") {
      round = handleStand(round, bankerTurn.player.id);
      continue;
    }

    const best = winningNumber(bankerTurn.cards);
    if (best === undefined) {
      round = handleStand(round, bankerTurn.player.id);
      continue;
    }

    if (best < cfg.bankerTarget) {
      round = handleHit(round, bankerTurn.player.id);
    } else {
      round = handleStand(round, bankerTurn.player.id);
    }
  }
  throw new Error("banker loop exceeded safety guard");
}

function runSimulation(cfg: SimulationConfig): Aggregate[] {
  const players = buildPlayers(cfg.playerSeats);
  const aggregates: Aggregate[] = [];

  for (const deck of cfg.deckCounts) {
    const tally: Aggregate = {
      deck,
      rounds: 0,
      bankerNet: 0,
      playerNet: 0,
      bankerWinRounds: 0,
      playerWinRounds: 0,
      pushRounds: 0,
      playerWins: 0,
      playerLosses: 0,
      playerBlackjacks: 0,
      playerBusts: 0,
      playerHands: 0,
    };

    for (let r = 0; r < cfg.roundsPerDeck; r += 1) {
      let round = createRound(players, "SIM", deck);

      for (const p of players) {
        if (p.type === "admin") continue;
        round = playPlayer(round, p.id, cfg);
      }

      round = playBanker(round, cfg);
      if (round.state !== "terminate") {
        // Ensure final scoring
        round = handleStand(round, "banker");
      }

      const bankerTurn = round.turns.find((t) => t.player.type === "admin");
      if (!bankerTurn) continue;

      const roundBankerNet = bankerTurn.bet ?? 0;
      let roundPlayerNet = 0;

      for (const turn of round.turns) {
        if (turn.player.type === "admin") continue;
        if (turn.bet <= 0) continue;
        tally.playerHands += 1;

        if (turn.state === "won") {
          tally.playerWins += 1;
          roundPlayerNet += turn.bet;
          if (turn.cards.length === 2 && winningNumber(turn.cards) === 21) {
            tally.playerBlackjacks += 1;
          }
        } else if (turn.state === "lost") {
          tally.playerLosses += 1;
          roundPlayerNet -= turn.bet;
          if (winningNumber(turn.cards) === undefined) {
            tally.playerBusts += 1;
          }
        } else {
          // Any unresolved state is treated via compare at finalization
          const best = winningNumber(turn.cards);
          if (best === undefined) tally.playerBusts += 1;
        }
      }

      tally.rounds += 1;
      tally.bankerNet += roundBankerNet;
      tally.playerNet += roundPlayerNet;

      if (roundBankerNet > 0) tally.bankerWinRounds += 1;
      else if (roundBankerNet < 0) tally.playerWinRounds += 1;
      else tally.pushRounds += 1;
    }

    aggregates.push(tally);
  }

  return aggregates;
}

function formatResult(row: Aggregate, cfg: SimulationConfig): string {
  const perRoundBanker = row.bankerNet / row.rounds;
  const perSeatPlayer = row.playerNet / (row.rounds * cfg.playerSeats);
  const playerWinRate = row.playerWins / row.playerHands;
  const playerBustRate = row.playerBusts / row.playerHands;
  return [
    `Decks: ${row.deck}`,
    `  Rounds simulated: ${row.rounds.toLocaleString()}`,
    `  Banker net per round: ${perRoundBanker.toFixed(2)}`,
    `  Player net per seat: ${perSeatPlayer.toFixed(2)}`,
    `  Banker round win rate: ${(row.bankerWinRounds / row.rounds * 100).toFixed(2)}%`,
    `  Player round win rate: ${(row.playerWinRounds / row.rounds * 100).toFixed(2)}%`,
    `  Player hand success: ${(playerWinRate * 100).toFixed(2)}%`,
    `  Player bust rate: ${(playerBustRate * 100).toFixed(2)}%`,
    `  Player blackjacks: ${row.playerBlackjacks.toLocaleString()}`,
  ].join("\n");
}

export function main() {
  const cfg = DEFAULT_CONFIG;
  const results = runSimulation(cfg);
  results.forEach((row) => {
    console.log(formatResult(row, cfg));
    console.log("---");
  });
}

main();