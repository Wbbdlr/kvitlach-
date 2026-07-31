import { describe, expect, it } from "vitest";
import {
  createRound,
  buildRoundHistoryEntry,
  calculateBalances,
  calculateEndState,
  getGameState,
  handleBet,
  handleHit,
  handleSkip,
  handleStand,
  playerWon,
} from "../round";
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

  it("never costs a Blatt hand money, but ends the turn once it overshoots 21", () => {
    // A blatt draw risks nothing, so overshooting can't bust the player into a
    // loss -- but it can't be played on either: betting deals another card,
    // which would futch it. So the turn resolves as a push instead of staying
    // live for more wasted draws.
    const round = makeRound();
    const playerTurn = round.turns.find((t) => t.player.id === p1.id)!;

    playerTurn.cards = [
      { name: "10", attributes: { values: [10] } },
      { name: "10", attributes: { values: [10] } },
    ];
    round.deck = [{ name: "12", attributes: { values: [12, 10, 9] } }, ...round.deck];

    const resolved = handleHit(round, playerTurn.player.id);
    const updated = resolved.turns.find((t) => t.player.id === playerTurn.player.id)!;

    expect(updated.state).not.toBe("pending"); // no more wasted draws
    expect(updated.state).not.toBe("lost"); // and not a loss -- nothing was staked
    expect(updated.bet).toBe(0);
    expect(updated.settledBet).toBe(0); // bet 0 + settled 0 == a push, see isPushTurn
  });

  it("keeps a busted Blatt hand a push through settlement instead of relabelling it a loss", () => {
    // calculateEndState re-derives outcomes from the cards, which used to
    // stamp LOST on a hand the player never wagered on.
    const round = makeRound();
    const adminTurn = round.turns.find((t) => t.player.type === "admin")!;
    const playerTurn = round.turns.find((t) => t.player.id === p1.id)!;
    const otherTurn = round.turns.find((t) => t.player.id === p2.id)!;

    adminTurn.cards = [{ name: "10", attributes: { values: [10] } }, { name: "9", attributes: { values: [9] } }];
    adminTurn.state = "standby";
    // A blatt hand that overshot: no wager, cards over 21.
    playerTurn.cards = [
      { name: "10", attributes: { values: [10] } },
      { name: "10", attributes: { values: [10] } },
      { name: "5", attributes: { values: [5] } },
    ];
    playerTurn.state = "won";
    playerTurn.bet = 0;
    playerTurn.settledBet = 0;
    otherTurn.state = "skipped";

    const resolved = calculateEndState(round.turns);
    const settled = resolved.find((t) => t.player.id === p1.id)!;

    expect(settled.state).toBe("won"); // $0 "win" is how a push is represented
    expect(settled.bet).toBe(0);
    // The banker takes nothing from a hand that staked nothing.
    expect(resolved.find((t) => t.player.type === "admin")!.bet).toBe(0);
  });

  it("pushes immediately when standing with no wager", () => {
    const round = createRound([admin, p1], "room1");
    const playerTurn = round.turns.find((t) => t.player.type !== "admin")!;

    playerTurn.cards = [
      { name: "5", attributes: { values: [5] } },
      { name: "7", attributes: { values: [7] } },
    ];

    const resolved = handleStand(round, playerTurn.player.id);
    const updatedPlayer = resolved.turns.find((t) => t.player.id === playerTurn.player.id)!;
    const banker = resolved.turns.find((t) => t.player.type === "admin")!;

    expect(updatedPlayer.state).toBe("won");
    expect(updatedPlayer.bet).toBe(0);
    expect(resolved.state).toBe("terminate");
    expect(banker.state).toBe("standby");
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

describe("buildRoundHistoryEntry", () => {
  it("summarizes a resolved round with names, bets, net, and outcome per player", () => {
    const round = makeRound();
    const adminTurn = round.turns.find((t) => t.player.type === "admin")!;
    const winner = round.turns.find((t) => t.player.id === p1.id)!;
    const loser = round.turns.find((t) => t.player.id === p2.id)!;

    adminTurn.cards = [{ name: "10", attributes: { values: [10] } }, { name: "Queen", attributes: { values: [10] } }];
    winner.cards = [{ name: "9", attributes: { values: [9] } }, { name: "12", attributes: { values: [12, 10, 9] } }];
    winner.bet = 10;
    loser.cards = [{ name: "5", attributes: { values: [5] } }, { name: "9", attributes: { values: [9] } }, { name: "9", attributes: { values: [9] } }];
    loser.bet = 8;

    const resolved = { ...round, turns: calculateEndState([adminTurn, winner, loser]) };
    const historyEntry = buildRoundHistoryEntry(resolved);

    expect(historyEntry.roundId).toBe(round.roundId);
    expect(historyEntry.roundNumber).toBe(round.roundNumber);
    const winnerEntry = historyEntry.entries.find((e) => e.playerId === p1.id)!;
    const loserEntry = historyEntry.entries.find((e) => e.playerId === p2.id)!;
    const bankerEntry = historyEntry.entries.find((e) => e.playerId === admin.id)!;

    expect(winnerEntry).toMatchObject({ name: "P 1", role: "player", bet: 10, net: 10, outcome: "won" });
    // loser's [5,9,9] sums to 23 -- a genuine bust, not just a lower total than the banker.
    expect(loserEntry).toMatchObject({ name: "P 2", role: "player", bet: 8, net: -8, outcome: "lost", busted: true });
    // Banker's `bet` is already the signed net balance post-calculateEndState (won 8, paid out 10).
    expect(bankerEntry).toMatchObject({ role: "admin", net: bankerEntry.bet });
  });

  it("nets a live-settled turn using settledBet, not a later-grown bet", () => {
    const round = makeRound();
    const playerTurn = round.turns.find((t) => t.player.id === p1.id)!;
    playerTurn.state = "lost";
    playerTurn.bet = 5;
    playerTurn.settled = true;
    playerTurn.settledBet = 5;

    const entry = buildRoundHistoryEntry(round);
    const found = entry.entries.find((e) => e.playerId === p1.id)!;
    expect(found.net).toBe(-5);
  });

  it("distinguishes losing by comparison (not busted) from an actual bust", () => {
    const round = createRound([admin, p1], "room1");
    const adminTurn = round.turns.find((t) => t.player.type === "admin")!;
    const playerTurn = round.turns.find((t) => t.player.type !== "admin")!;

    adminTurn.cards = [{ name: "9", attributes: { values: [9] } }, { name: "9", attributes: { values: [9] } }]; // 18
    playerTurn.cards = [{ name: "8", attributes: { values: [8] } }, { name: "7", attributes: { values: [7] } }]; // 15, valid but lower
    playerTurn.bet = 5;
    playerTurn.state = "standby"; // stood -- only a "standby" turn gets compared against the banker at all

    const resolved = { ...round, turns: calculateEndState([adminTurn, playerTurn]) };
    const entry = buildRoundHistoryEntry(resolved);
    const found = entry.entries.find((e) => e.playerId === p1.id)!;
    expect(found).toMatchObject({ outcome: "lost", busted: false });
  });
});

describe("turn-state guard", () => {
  // Enforcement used to be UI-only: nothing server-side stopped a player from
  // re-acting on a turn that had already resolved (e.g. a double-tap race,
  // or a stale/replayed action arriving after the turn moved on). Each
  // handler now requires turn.state === "pending" before doing anything.
  it("rejects a hit on a turn that has already busted", () => {
    const round = makeRound();
    const playerTurn = round.turns.find((t) => t.player.id === p1.id)!;
    playerTurn.state = "lost";

    expect(() => handleHit(round, playerTurn.player.id)).toThrow("turn_not_pending");
  });

  it("rejects a bet on a turn that already won", () => {
    const round = makeRound();
    const playerTurn = round.turns.find((t) => t.player.id === p1.id)!;
    playerTurn.state = "won";

    expect(() => handleBet(round, playerTurn.player.id, 5)).toThrow("turn_not_pending");
  });

  it("rejects standing again on a turn already in standby", () => {
    const round = makeRound();
    const playerTurn = round.turns.find((t) => t.player.id === p1.id)!;
    playerTurn.state = "standby";

    expect(() => handleStand(round, playerTurn.player.id)).toThrow("turn_not_pending");
  });

  it("rejects skipping a turn that's already skipped", () => {
    const round = makeRound();
    const playerTurn = round.turns.find((t) => t.player.id === p1.id)!;
    playerTurn.state = "skipped";

    expect(() => handleSkip(round, playerTurn.player.id)).toThrow("turn_not_pending");
  });

  it("still allows the legitimate first action on a pending turn", () => {
    const round = makeRound();
    const playerTurn = round.turns.find((t) => t.player.id === p1.id)!;
    expect(playerTurn.state).toBe("pending");

    expect(() => handleSkip(round, playerTurn.player.id)).not.toThrow();
  });
});
