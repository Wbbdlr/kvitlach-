/**
 * Kvitlach game simulation — run with: npm run simulate
 *
 * Section 1: Unit tests — verify rules with known inputs (deterministic)
 * Section 2: Statistical simulation — 50K rounds per deck count, checks sanity
 */

import { newDeck } from "./deck.js";
import { calcState, getSums } from "./turn.js";
import { createRound, handleBet, handleHit, handleStand, winningNumber, playerWon, calculateEndState } from "./round.js";
import type { RoundContext } from "./round.js";
import { Player, Turn, Card } from "./types.js";

// ─── helpers ─────────────────────────────────────────────────────────────────

let passed = 0, failed = 0;
function assert(cond: boolean, label: string, detail?: string) {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else       { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); failed++; }
}

function card(name: string, values: number[], type?: "rosier"): Card {
  return { name, attributes: type ? { values, type } : { values } };
}

const C1  = card("1",  [1]);
const C2  = card("2",  [2],  "rosier");
const C3  = card("3",  [3]);
const C4  = card("4",  [4]);
const C5  = card("5",  [5]);
const C6  = card("6",  [6]);
const C7  = card("7",  [7]);
const C8  = card("8",  [8]);
const C9  = card("9",  [9]);
const C10 = card("10", [10]);
const C11 = card("11", [11], "rosier");
const C12 = card("12", [12, 9, 10]);

function makePl(id: string, type: "player" | "admin" = "player"): Player {
  return { id, firstName: id, lastName: "", type, presence: "online" };
}
function makeTurn(pl: Player, cards: Card[], bet = 10, state: Turn["state"] = "standby"): Turn {
  return { player: pl, cards, bet, state };
}

// ─── Section 1: Unit tests ────────────────────────────────────────────────────

console.log("\n══════════════════════════════════════════");
console.log("  SECTION 1 — Rule unit tests");
console.log("══════════════════════════════════════════\n");

// Deck composition
console.log("── Deck composition ──");
{
  const deck = newDeck();
  assert(deck.length === 48, "Deck has exactly 48 cards");
  const counts = new Map<string, number>();
  deck.forEach((c) => counts.set(c.name, (counts.get(c.name) ?? 0) + 1));
  for (let i = 1; i <= 12; i++) {
    const n = counts.get(String(i)) ?? 0;
    assert(n === 4, `Card ${i}: exactly 4 copies`, `got ${n}`);
  }
  let identicalPairs = 0;
  for (let i = 0; i < 500; i++) {
    if (newDeck().map((c) => c.name).join() === newDeck().map((c) => c.name).join()) identicalPairs++;
  }
  assert(identicalPairs === 0, "Shuffle produces unique orderings across 500 pairs");
}

// Card 12 multi-value
console.log("\n── Card 12 values [12, 9, 10] ──");
{
  assert(JSON.stringify(getSums([C12])) === JSON.stringify([12, 9, 10]), "Card 12 alone → sums [12, 9, 10]");
  assert(calcState([C12, C9])  === "won",     "Card 12 + 9  = 21 → won");
  assert(calcState([C12, C10]) === "pending", "Card 12 + 10 = 20 → pending (best ≤ 21)");
  assert(calcState([C12, C12]) === "won",     "Card 12 + 12 → won (12+9=21 or 9+12=21)");
  assert(calcState([C12, C8])  === "pending", "Card 12 + 8  = 20 → pending");
  assert(calcState([C12, C6])  === "pending", "Card 12 + 6  = 18 → pending");
  // Card 12+12+3: 9+9+3=21 is reachable → won
  assert(calcState([C12, C12, C3]) === "won",  "Card 12+12+3 → won via 9+9+3=21");
  const sums12_12_3 = getSums([C12, C12, C3]);
  assert(sums12_12_3.includes(21), "Card 12+12+3: sums include 21", `sums: ${sums12_12_3.join(",")}`);
}

// Basic totals
console.log("\n── Basic totals ──");
{
  assert(calcState([C10, C8, C3]) === "won",     "10+8+3 = 21 → won");
  assert(calcState([C5,  C7])     === "pending", "5+7 = 12 → pending");
  assert(calcState([C10, C9])     === "pending", "10+9 = 19 → pending");
  assert(calcState([C10, C10, C5])=== "lost",    "10+10+5 = 25 → bust");
  assert(calcState([C10, C10, C1])=== "won",     "10+10+1 = 21 → won");
  assert(calcState([C9,  C9, C3]) === "won",     "9+9+3 = 21 → won");
  assert(calcState([C9,  C9, C4]) === "lost",    "9+9+4 = 22 → bust");
}

// Rosier pair
console.log("\n── Rosier pair (2 + 11) ──");
{
  assert(calcState([C2, C11]) === "won",  "2 + 11 → won (rosier pair)");
  assert(calcState([C11, C2]) === "won",  "11 + 2 → won (order reversed)");
  assert(winningNumber([C2, C11]) === 21, "Rosier pair winning number = 21");
  // Rosier beats a regular 21 — verified via calculateEndState (playerWon isn't
  // called for rosier hands; calcState returns "won" immediately so the player
  // never reaches standby state)
  {
    const banker = makePl("b", "admin");
    const player = makePl("p");
    const rTurns: Turn[] = [
      makeTurn(banker, [C10, C8, C3], 0,  "pending"), // banker 21
      makeTurn(player, [C2,  C11],    10, "won"),     // rosier pair already won
    ];
    const resolved = calculateEndState(rTurns);
    assert(resolved.find((t) => t.player.id === "p")?.state === "won",
      "Rosier pair wins even when banker has 21 (via calculateEndState)");
  }
  // Three cards with 2+11 is NOT auto-rosier; must be ≤21 or bust
  assert(calcState([C2, C11, C1]) !== "won" || getSums([C2, C11, C1]).includes(21),
    "Three-card 2+11+1: either busts or wins by total 21, not by rosier rule");
  // Non-rosier cards don't trigger it
  assert(calcState([C5, C6]) === "pending", "5+6 is not a rosier pair");
}

// Eleveroon
console.log("\n── Eleveroon ──");
{
  // NOTE: 11+11 is detected as a rosier pair (both have type:"rosier") → immediate win.
  // The eleveroon rule only fires for non-rosier paths, e.g. total=11 via other cards.
  assert(calcState([C11, C11]) === "won",
    "11+11 is a rosier pair → won (NOTE: also means eleveroon never fires on 11+11)");

  // Eleveroon scenario: reach 11 via non-rosier cards, then draw an 11
  // e.g. 3+8=11 (pending), then hit draws C11 → would be 3+8+11=22 bust, but eleveroon ignores it
  const ignored = { ...C11, attributes: { ...C11.attributes, eleveroonIgnored: true } };
  assert(getSums([C3, C8, ignored]).length === 1 && getSums([C3, C8, ignored])[0] === 11,
    "3+8 + eleveroon-ignored 11: getSums = [11]");
  assert(calcState([C3, C8, ignored]) === "pending",
    "3+8 + eleveroon-ignored 11 → hand stays pending at 11");
  // Without eleveroon: 3+8+11 = 22 → bust
  assert(calcState([C3, C8, C11]) === "lost", "3+8+11 = 22 → bust (no eleveroon)");
  // Card 12 + 11 can reach 21 (10+11), so no eleveroon needed
  assert(calcState([C12, C11]) === "won",
    "Card 12 + 11 → won via 10+11=21");
}

// Eleveroon via handleHit — full game path with controlled deck
console.log("\n── Eleveroon via handleHit (real game path) ──");
{
  // Helper: build a minimal round state with a specific deck and a player at a known total
  function makeRound(playerCards: Card[], deckTop: Card[]): RoundContext {
    const player = makePl("p");
    const banker = makePl("b", "admin");
    return {
      roundId: "test",
      roomId: "test",
      deckCount: 1,
      roundNumber: 1,
      state: "playing",
      deck: deckTop,
      turns: [
        { player, cards: playerCards, bet: 10, state: "pending" },
        { player: banker, cards: [C1],  bet: 0,  state: "pending" },
      ],
    };
  }

  // ── Scenario 1: Eleveroon ON, player at 11, draws an 11 → ignored, stays pending ──
  {
    const round = makeRound([C3, C8], [C11, C5]); // 3+8=11, deck top = 11
    const after = handleHit(round, "p", { eleveroon: true });
    const turn = after.turns.find((t) => t.player.id === "p")!;
    assert(turn.cards.length === 3,                      "Eleveroon ON + draws 11 at 11: card is added");
    assert(turn.cards[2].attributes.eleveroonIgnored === true, "Eleveroon ON + draws 11 at 11: card marked ignored");
    assert(turn.state === "pending",                     "Eleveroon ON + draws 11 at 11: hand stays pending");
    assert(winningNumber(turn.cards) === 11,             "Eleveroon ON + draws 11 at 11: winning number still 11");
  }

  // ── Scenario 2: Eleveroon ON, player at 11, draws a non-11 card → normal draw ──
  {
    const round = makeRound([C3, C8], [C5, C11]); // 3+8=11, deck top = 5 (not an 11)
    const after = handleHit(round, "p", { eleveroon: true });
    const turn = after.turns.find((t) => t.player.id === "p")!;
    assert(!turn.cards[2].attributes.eleveroonIgnored,   "Eleveroon ON + draws 5 at 11: card NOT ignored");
    assert(turn.state === "pending",                     "Eleveroon ON + draws 5 at 11: hand at 16, still pending");
    assert(winningNumber(turn.cards) === 16,             "Eleveroon ON + draws 5 at 11: total = 16");
  }

  // ── Scenario 3: Eleveroon OFF, player at 11, draws an 11 → busts ──
  {
    const round = makeRound([C3, C8], [C11, C5]); // 3+8=11, deck top = 11
    const after = handleHit(round, "p", { eleveroon: false });
    const turn = after.turns.find((t) => t.player.id === "p")!;
    assert(!turn.cards[2].attributes.eleveroonIgnored,   "Eleveroon OFF + draws 11 at 11: card NOT ignored");
    assert(turn.state === "lost",                        "Eleveroon OFF + draws 11 at 11: hand busts (3+8+11=22)");
    assert(winningNumber(turn.cards) === undefined,      "Eleveroon OFF + draws 11 at 11: no valid total (all > 21)");
  }

  // ── Scenario 4: Eleveroon ON, player at 12 (not 11), draws an 11 → no eleveroon ──
  {
    const round = makeRound([C4, C8], [C11, C5]); // 4+8=12, deck top = 11
    const after = handleHit(round, "p", { eleveroon: true });
    const turn = after.turns.find((t) => t.player.id === "p")!;
    // 4+8+11=23 bust; eleveroon does NOT fire because total wasn't exactly 11
    assert(!turn.cards[2].attributes.eleveroonIgnored,   "Eleveroon ON + draws 11 at 12: NOT ignored (must be at exactly 11)");
    assert(turn.state === "lost",                        "Eleveroon ON + draws 11 at 12: busts (not at 11)");
  }

  // ── Scenario 5: Eleveroon ON, player at 11, draws again after being saved → can continue ──
  {
    let round = makeRound([C3, C8], [C11, C7]); // 3+8=11, deck: [11, 7]
    round = handleHit(round, "p", { eleveroon: true });  // 11 ignored, still at 11
    round = handleHit(round, "p", { eleveroon: true });  // draws 7, total = 18
    const turn = round.turns.find((t) => t.player.id === "p")!;
    assert(turn.cards.length === 4,                      "Eleveroon save then continue: 4 cards total");
    assert(turn.state === "pending",                     "Eleveroon save then continue: still pending at 18");
    assert(winningNumber(turn.cards) === 18,             "Eleveroon save then continue: total = 18");
  }
}

// Tie-breaking
console.log("\n── Tie-breaking ──");
{
  const b21 = makeTurn(makePl("b", "admin"), [C10, C8, C3], 0);
  const p21 = makeTurn(makePl("p"),          [C10, C8, C3], 10);
  assert(!playerWon(b21, p21), "Equal totals (21 vs 21) → banker wins");

  const bLow  = makeTurn(makePl("b", "admin"), [C5, C6], 0);
  const pHigh = makeTurn(makePl("p"),          [C9, C8], 10);
  assert(playerWon(bLow, pHigh), "Player 17 > banker 11 → player wins");

  const bBust = makeTurn(makePl("b", "admin"), [C10, C9, C5], 0);
  const pOk   = makeTurn(makePl("p"),          [C8,  C7],     10);
  assert(playerWon(bBust, pOk), "Banker busts → player wins regardless of total");
}

// calculateEndState
console.log("\n── calculateEndState ──");
{
  const banker = makePl("b", "admin");
  const turns: Turn[] = [
    makeTurn(banker,       [C9, C10],        0,  "pending"), // banker 19
    makeTurn(makePl("p1"), [C10, C10],       10, "standby"), // 20 > 19 → wins
    makeTurn(makePl("p2"), [C8,  C10],       10, "standby"), // 18 < 19 → loses
    makeTurn(makePl("p3"), [C10, C10, C5],   10, "lost"),    // bust → stays lost
  ];
  const r = calculateEndState(turns);
  assert(r.find((t) => t.player.id === "p1")?.state === "won",  "p1 (20 vs 19) → won");
  assert(r.find((t) => t.player.id === "p2")?.state === "lost", "p2 (18 vs 19) → lost");
  assert(r.find((t) => t.player.id === "p3")?.state === "lost", "p3 (bust) → lost");
}

// ─── Section 2: Statistical simulation ────────────────────────────────────────

console.log("\n══════════════════════════════════════════");
console.log("  SECTION 2 — Statistical simulation");
console.log("══════════════════════════════════════════\n");

const DECK_COUNTS = [1, 2, 3];
const ROUNDS_PER_CONFIG = 50_000;
const PLAYER_STAND_TARGET = 17;
const BANKER_STAND_TARGET = 17;
const BASE_BET = 10;
const NUM_PLAYERS = 3;

function buildPlayers(seats: number): Player[] {
  const players: Player[] = [];
  for (let i = 0; i < seats; i++)
    players.push({ id: `p${i}`, firstName: `P${i}`, lastName: "", type: "player", presence: "online" });
  players.push({ id: "banker", firstName: "Banker", lastName: "", type: "admin", presence: "online" });
  return players;
}

for (const deckCount of DECK_COUNTS) {
  const players = buildPlayers(NUM_PLAYERS);
  let wins = 0, losses = 0, hands = 0;
  let rosierHands = 0, eleveroonFires = 0, card12Starts = 0, bustHands = 0, naturalWins = 0;

  for (let r = 0; r < ROUNDS_PER_CONFIG; r++) {
    let round = createRound(players, "SIM", deckCount);

    // Each player: bet once, then hit until ≥ target or bust; use eleveroon
    for (const p of players) {
      if (p.type === "admin") continue;
      let safety = 0;
      while (safety++ < 30) {
        const turn = round.turns.find((t) => t.player.id === p.id)!;
        if (turn.state !== "pending") break;
        if (turn.bet === 0) { round = handleBet(round, p.id, BASE_BET); continue; }
        const total = winningNumber(turn.cards);
        if (total !== undefined && total >= PLAYER_STAND_TARGET) {
          round = handleStand(round, p.id);
          break;
        }
        round = handleHit(round, p.id, { eleveroon: true });
      }
    }

    // Banker: hit until ≥ target; always uses eleveroon
    let bSafety = 0;
    while (bSafety++ < 30 && round.state !== "terminate") {
      const bTurn = round.turns.find((t) => t.player.type === "admin");
      if (!bTurn || bTurn.state !== "pending") break;
      const total = winningNumber(bTurn.cards);
      if (total !== undefined && total >= BANKER_STAND_TARGET) {
        round = handleStand(round, bTurn.player.id);
        break;
      }
      round = handleHit(round, bTurn.player.id, { eleveroon: true });
    }

    // Tally per player
    for (const turn of round.turns) {
      if (turn.player.type === "admin" || (turn.bet ?? 0) === 0) continue;
      hands++;

      const startCard = turn.cards[0];
      if (startCard.name === "12") card12Starts++;

      const isRosier = turn.cards.length === 2 &&
        turn.cards.every((c) => c.attributes.type === "rosier");
      if (isRosier) { rosierHands++; }

      if (turn.cards.some((c) => c.attributes.eleveroonIgnored)) eleveroonFires++;
      if (winningNumber(turn.cards) === undefined && turn.state === "lost") bustHands++;
      if (turn.cards.length === 2 && winningNumber(turn.cards) === 21) naturalWins++;

      if (turn.state === "won")  wins++;
      if (turn.state === "lost") losses++;
    }
  }

  const winPct     = (wins / hands * 100).toFixed(1);
  const lossPct    = (losses / hands * 100).toFixed(1);
  const rosierPct  = (rosierHands / hands * 100).toFixed(2);
  const bustPct    = (bustHands / hands * 100).toFixed(1);
  const c12Pct     = (card12Starts / hands * 100).toFixed(1);
  const elevPct    = (eleveroonFires / hands * 100).toFixed(2);
  const naturalPct = (naturalWins / hands * 100).toFixed(2);

  console.log(`── ${deckCount} deck${deckCount > 1 ? "s" : ""}, ${ROUNDS_PER_CONFIG.toLocaleString()} rounds, ${NUM_PLAYERS} players ──`);
  console.log(`  Hands          : ${hands.toLocaleString()}`);
  console.log(`  Player win     : ${winPct}%   (expected: ~40–50%)`);
  console.log(`  Player loss    : ${lossPct}%`);
  console.log(`  Bust           : ${bustPct}%   (expected: 15–35%)`);
  console.log(`  Rosier pair    : ${rosierPct}% (expected: ~2.5% — 8 rosier cards: P=8/48×7/47)`);
  console.log(`  Natural 2-card : ${naturalPct}% (includes rosier + any 2-card 21)`);
  console.log(`  Card 12 start  : ${c12Pct}%   (expected: ~8.3%)`);
  console.log(`  Eleveroon fires: ${elevPct}% of hands`);

  // Sanity assertions
  assert(parseFloat(winPct) >= 30 && parseFloat(winPct) <= 60,
    `Win rate ${winPct}% in sane range (30–60%)`);
  assert(parseFloat(rosierPct) >= 1.8 && parseFloat(rosierPct) <= 3.2,
    `Rosier rate ${rosierPct}% near expected ~2.5%`);
  assert(Math.abs(parseFloat(c12Pct) - 8.33) < 2.0,
    `Card 12 start rate ${c12Pct}% near expected 8.3%`);
  console.log();
}

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log("══════════════════════════════════════════");
console.log(`  Unit tests: ${passed} passed, ${failed} failed`);
console.log("══════════════════════════════════════════\n");
if (failed > 0) process.exit(1);
