import { describe, expect, it } from "vitest";
import { GameStore } from "../store.js";

// Randomized whole-game harness. Not a replacement for the scripted suites --
// it exists to reach states nobody thought to script: odd bet sizes against a
// nearly-empty bank, BANK! wagers landing on a bust, blatt hands, skips, and
// long sessions where the shoe drains.

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const total = (w: Record<string, number>) => Object.values(w).reduce((a, b) => a + b, 0);

interface Violation {
  seed: number;
  kind: string;
  detail: string;
}

function playGame(seed: number, violations: Violation[]) {
  const rand = rng(seed);
  const pick = <T,>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];
  const store = new GameStore();
  const playerCount = 1 + Math.floor(rand() * 4);
  const bankroll = 20 + Math.floor(rand() * 200);
  const buyIn = 20 + Math.floor(rand() * 100);

  const created = store.createRoom({ firstName: "Banker", buyIn, bankerBankroll: bankroll });
  const roomId = created.room.roomId;
  const bankerId = created.player.id;
  for (let i = 0; i < playerCount; i += 1) store.joinRoom(roomId, { firstName: `P${i}` });

  const room = () => store.getRoom(roomId)!;
  // Not const: a banker top-up is new money entering the room, so the target
  // moves with it. Everything else must only ever move chips between seats.
  let expectedTotal = bankroll + playerCount * buyIn;

  const check = (label: string) => {
    const wallets = room().wallets;
    if (total(wallets) !== expectedTotal) {
      violations.push({ seed, kind: "conservation", detail: `${label}: ${total(wallets)} != ${expectedTotal}` });
      return false;
    }
    for (const [id, amount] of Object.entries(wallets)) {
      if (amount < 0) {
        violations.push({ seed, kind: "negative-wallet", detail: `${label}: ${id.slice(0, 6)} = ${amount}` });
        return false;
      }
    }
    return true;
  };

  // Mirrors GameStore.getActiveTurnId, which is private -- the harness has to
  // drive turns the way the server believes they run.
  const activeId = (r: any): string | undefined => {
    if (r.state === "terminate") return undefined;
    if (r.bankLock?.stage === "decision") return undefined;
    const banker = r.turns.find((t: any) => t.player.type === "admin");
    if ((r.state === "final" || r.bankLock?.stage === "banker") && banker) return banker.player.id;
    if (r.bankLock?.stage === "player") return r.bankLock.playerId;
    return r.turns.find((t: any) => t.state === "pending")?.player.id;
  };

  const EXPECTED = new Set([
    "insufficient_funds", "bank_limit", "bank_empty", "invalid_bet", "deck_empty",
    "turn_not_pending", "bank_locked", "banker_deciding", "invalid_bank_amount", "deck_low",
  ]);
  const tolerated = (e: unknown) => {
    const m = (e as Error).message ?? "";
    return EXPECTED.has(m) || m.startsWith("bank_limit");
  };

  for (let roundNo = 0; roundNo < 6; roundNo += 1) {
    let round: any;
    try {
      round = store.startRound(roomId, bankerId);
    } catch (e) {
      if ((e as Error).message === "deck_low") {
        store.reshuffleDeck(roomId, bankerId);
        continue;
      }
      if ((e as Error).message === "not_enough_players") break;
      throw e;
    }

    for (let step = 0; step < 400; step += 1) {
      round = store.getRound(round.roundId);
      if (!round || round.state === "terminate") break;

      if (round.bankLock?.stage === "decision") {
        // The banker is out of money mid-round: top up, or end the round.
        if (rand() < 0.5) {
          try {
            store.topUpBanker(roomId, bankerId, 50);
            expectedTotal += 50;
          } catch (e) {
            if (!tolerated(e)) throw e;
            store.endRoundAfterBankDecision(roomId, bankerId);
          }
        } else {
          store.endRoundAfterBankDecision(roomId, bankerId);
        }
        if (!check(`round ${roundNo} bank-decision`)) return;
        continue;
      }

      const turnId = activeId(round);
      if (!turnId) break;
      const turn = round.turns.find((t: any) => t.player.id === turnId);
      if (!turn || turn.state !== "pending") break;

      const isBanker = turn.player.type === "admin";
      const wallet = room().wallets[turnId] ?? 0;
      const hasBet = (turn.bet ?? 0) > 0;

      try {
        if (isBanker) {
          if (rand() < 0.55) store.applyHit(round.roundId, turnId);
          else store.applyStand(round.roundId, turnId);
        } else if (!hasBet) {
          const roll = rand();
          if (roll < 0.6) {
            store.applyBet(round.roundId, turnId, 1 + Math.floor(rand() * Math.max(1, Math.min(wallet, 30))));
          } else if (roll < 0.75) {
            store.applyBet(round.roundId, turnId, Math.max(1, wallet), { bank: true }); // BANK! attempt
          } else if (roll < 0.9) {
            store.applyHit(round.roundId, turnId); // blatt -- free draw
          } else {
            store.applySkip(round.roundId, turnId);
          }
        } else {
          if (rand() < 0.45) store.applyHit(round.roundId, turnId);
          else store.applyStand(round.roundId, turnId);
        }
      } catch (e) {
        if (!tolerated(e)) throw e;
        // A refused action must not leave the actor able to do nothing at all.
        try {
          store.applyStand(round.roundId, turnId);
        } catch (inner) {
          if (!tolerated(inner)) throw inner;
          try {
            store.applySkip(round.roundId, turnId);
          } catch (last) {
            if (!tolerated(last)) throw last;
            violations.push({ seed, kind: "stuck-turn", detail: `${turnId.slice(0, 6)}: ${(e as Error).message}` });
            return;
          }
        }
      }

      if (!check(`round ${roundNo} step ${step}`)) return;
    }

    const live = store.getRound(round.roundId);
    if (live && live.state !== "terminate") {
      violations.push({ seed, kind: "round-never-ended", detail: `round ${roundNo} stuck in ${live.state}` });
      return;
    }
    store.finalizeRound(round.roundId);
    if (!check(`round ${roundNo} finalized`)) return;

    const stillPending = (live ?? round).turns.filter((t: any) => t.state === "pending");
    if (stillPending.length > 0) {
      const who = stillPending
        .map((t: any) => `${t.player.type}/${t.player.firstName} bet=${t.bet} settled=${!!t.settled} cards=${t.cards.map((c: any) => c.name).join("+")}`)
        .join(" | ");
      violations.push({
        seed,
        kind: "pending-at-end",
        detail: `${who} || roundState=${(live ?? round).state} lock=${JSON.stringify((live ?? round).bankLock)} all=${(live ?? round).turns.map((t: any) => `${t.player.firstName}:${t.state}:${t.bet}`).join(",")}`,
      });
      return;
    }
  }
}

describe("randomized whole-game fuzz", () => {
  // Deliberately not seeded end-to-end: the shoe shuffles from Math.random,
  // so each run explores fresh card sequences on top of the seeded action
  // choices. That is the point -- this is a net, not a fixture. Anything it
  // catches gets pinned as its own named test (see turn-order.test.ts, which
  // exists because this found a BANK! settlement dealing the banker a card
  // into an already-finished round).
  it("keeps every chip accounted for, never lets a wallet go negative, and always finishes the round", () => {
    const violations: Violation[] = [];
    for (let seed = 1; seed <= 300; seed += 1) playGame(seed, violations);
    expect(violations.slice(0, 8)).toEqual([]);
  }, 120000);
});
