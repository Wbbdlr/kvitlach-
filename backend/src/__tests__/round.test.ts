import { describe, expect, it } from "vitest";
import { createRound, calculateBalances, calculateEndState, getGameState, handleBet, handleHit, playerWon } from "../round";
import { Player } from "../types";

const admin: Player = { id: "a", firstName: "A", lastName: "Admin", type: "admin", presence: "online" };
const p1: Player = { id: "p1", firstName: "P", lastName: "1", type: "player", presence: "online" };
const p2: Player = { id: "p2", firstName: "P", lastName: "2", type: "player", presence: "online" };

function makeRound() {
  return createRound([admin, p1, p2], "room1");
}

describe("round state", () => {
  it("starts in playing with pending turns", () => {
    const round = makeRound();
    expect(round.turns.every((t) => t.state === "pending")).toBe(true);
    expect(round.state).toBe("playing");
  });

  it("moves to final when only admin pending", () => {
    const round = makeRound();
    const turns = round.turns.map((t) => (t.player.type === "admin" ? t : { ...t, state: "standby" as const }));
    expect(getGameState(turns)).toBe("final");
  });

  it("calculates end state and balances", () => {
    const round = makeRound();
    const adminTurn = round.turns.find((t) => t.player.type === "admin")!;
    const playerTurn = round.turns.find((t) => t.player.type !== "admin")!;

    adminTurn.cards = [{ name: "10", attributes: { values: [10] } }];
    playerTurn.cards = [
      { name: "12", attributes: { values: [12, 9, 10] } },
      { name: "9", attributes: { values: [9] } },
    ];
    playerTurn.bet = 5;
    playerTurn.state = "standby";

    const resolved = calculateEndState([adminTurn, playerTurn]);
    expect(resolved.find((t) => t.player.id === playerTurn.player.id)?.state).toBe("won");

    const balances = calculateBalances(resolved);
    expect(balances).toEqual([{ amount: 5, payer: admin.id, payee: playerTurn.player.id }]);
  });

  it("playerWon respects winning number", () => {
    const a = makeRound();
    const adminTurn = a.turns.find((t) => t.player.type === "admin")!;
    const playerTurn = a.turns.find((t) => t.player.type !== "admin")!;

    adminTurn.cards = [{ name: "10", attributes: { values: [10] } }, { name: "10", attributes: { values: [10] } }];
    playerTurn.cards = [{ name: "12", attributes: { values: [12, 9, 10] } }];
    // Banker keeps ties; player needs a higher winning total to beat 20 here.
    expect(playerWon(adminTurn, playerTurn)).toBe(false);
  });

  it("rechecks card totals when resolving end state", () => {
    const round = makeRound();
    const adminTurn = round.turns.find((t) => t.player.type === "admin")!;
    const bustingPlayer = round.turns.find((t) => t.player.id === p1.id)!;
    const skippedPlayer = round.turns.find((t) => t.player.id === p2.id)!;

    adminTurn.cards = [
      { name: "5", attributes: { values: [5] } },
      { name: "9", attributes: { values: [9] } },
    ];
    adminTurn.state = "standby";

    bustingPlayer.cards = [
      { name: "X", attributes: { values: [12] } },
      { name: "Y", attributes: { values: [10] } },
    ];
    bustingPlayer.bet = 10;
    bustingPlayer.state = "won";

    skippedPlayer.state = "skipped";

    const resolved = calculateEndState([adminTurn, bustingPlayer, skippedPlayer]);
    const updatedPlayer = resolved.find((t) => t.player.id === bustingPlayer.player.id)!;
    const bankerResult = resolved.find((t) => t.player.type === "admin")!;

    expect(updatedPlayer.state).toBe("lost");
    expect(bankerResult.state).toBe("standby");
    expect(bankerResult.bet).toBe(10);
  });

  it("terminates immediately when all non-bankers bust", () => {
    const round = makeRound();
    const adminTurn = round.turns.find((t) => t.player.type === "admin")!;
    const firstPlayer = round.turns.find((t) => t.player.id === p1.id)!;
    const secondPlayer = round.turns.find((t) => t.player.id === p2.id)!;

    firstPlayer.cards = [{ name: "BUST", attributes: { values: [22] } }];
    firstPlayer.state = "lost";
    firstPlayer.bet = 5;

    secondPlayer.cards = [{ name: "BASE", attributes: { values: [15] } }];
    secondPlayer.state = "pending";
    secondPlayer.bet = 5;

    adminTurn.cards = [{ name: "BANKER", attributes: { values: [7] } }];

    round.deck = [{ name: "BUST-HIT", attributes: { values: [9] } }, ...round.deck];

    const resolved = handleBet(round, secondPlayer.player.id, 1);

    expect(resolved.state).toBe("terminate");
    expect(resolved.turns.find((t) => t.player.id === secondPlayer.player.id)?.state).toBe("lost");
    expect(resolved.turns.find((t) => t.player.type === "admin")?.state).toBe("standby");
  });

  it("keeps banker neutral when wins and losses offset", () => {
    const round = makeRound();
    const adminTurn = round.turns.find((t) => t.player.type === "admin")!;
    const winner = round.turns.find((t) => t.player.id === p1.id)!;
    const loser = round.turns.find((t) => t.player.id === p2.id)!;

    adminTurn.cards = [
      { name: "10", attributes: { values: [10] } },
      { name: "Queen", attributes: { values: [10] } },
    ];
    adminTurn.state = "standby";

    winner.cards = [
      { name: "9", attributes: { values: [9] } },
      { name: "12", attributes: { values: [12, 10, 9] } },
    ];
    winner.bet = 10;
    winner.state = "won";

    loser.cards = [
      { name: "5", attributes: { values: [5] } },
      { name: "9", attributes: { values: [9] } },
      { name: "5", attributes: { values: [5] } },
    ];
    loser.bet = 10;
    loser.state = "standby";

    const resolved = calculateEndState([adminTurn, winner, loser]);
    const banker = resolved.find((t) => t.player.type === "admin")!;
    const resolvedLoser = resolved.find((t) => t.player.id === loser.player.id)!;

    expect(banker.state).toBe("standby");
    expect(banker.bet).toBe(0);
    expect(resolvedLoser.state).toBe("lost");
  });

  it("auto stands Blatt hands once they reach twenty", () => {
    const round = makeRound();
    const playerTurn = round.turns.find((t) => t.player.id === p1.id)!;

    playerTurn.cards = [{ name: "10", attributes: { values: [10] } }];
    round.deck = [{ name: "10", attributes: { values: [10] } }, ...round.deck];

    const resolved = handleHit(round, playerTurn.player.id);
    const updated = resolved.turns.find((t) => t.player.id === playerTurn.player.id)!;

    expect(updated.state).toBe("standby");
    expect(updated.bet).toBe(0);
  });

  it("does not bust Blatt hands with no wager", () => {
    const round = makeRound();
    const playerTurn = round.turns.find((t) => t.player.id === p1.id)!;

    playerTurn.cards = [
      { name: "10", attributes: { values: [10] } },
      { name: "10", attributes: { values: [10] } },
    ];
    round.deck = [{ name: "12", attributes: { values: [12, 10, 9] } }, ...round.deck];

    const resolved = handleHit(round, playerTurn.player.id);
    const updated = resolved.turns.find((t) => t.player.id === playerTurn.player.id)!;

    expect(updated.state).toBe("pending");
    expect(updated.bet).toBe(0);
  });

  it("keeps players pending when they have wagered", () => {
    const round = makeRound();
    const playerTurn = round.turns.find((t) => t.player.id === p1.id)!;

    playerTurn.cards = [{ name: "9", attributes: { values: [9] } }];
    playerTurn.bet = 5;
    round.deck = [{ name: "10", attributes: { values: [10] } }, ...round.deck];

    const resolved = handleHit(round, playerTurn.player.id);
    const updated = resolved.turns.find((t) => t.player.id === playerTurn.player.id)!;

    expect(updated.state).toBe("pending");
    expect(updated.bet).toBe(5);
  });
});
