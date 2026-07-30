import { describe, expect, it } from "vitest";
import { totalDisplay, tagVariant, allTotals, bestTotal } from "../selectors";
import { Card, Player, Turn } from "../../types";

const banker: Player = { id: "bank", firstName: "Bank", lastName: "", type: "admin", presence: "online" };
const p1: Player = { id: "p1", firstName: "P1", lastName: "", type: "player", presence: "online" };
const p2: Player = { id: "p2", firstName: "P2", lastName: "", type: "player", presence: "online" };

function makeTurn(player: Player, overrides: Partial<Turn> = {}): Turn {
  return { player, state: "pending", cards: [{ name: "9", attributes: { values: [9] } }], bet: 5, ...overrides };
}

describe("totalDisplay -- a standing player's total must not leak before resolution", () => {
  it("hides a standing (not yet resolved) player's total from other viewers", () => {
    const turn = makeTurn(p1, { state: "standby" });
    const info = totalDisplay(turn, p2.id); // p2 viewing p1
    expect(info.value).toBe("hidden");
  });

  it("still shows the owner their own total the moment they stand", () => {
    const turn = makeTurn(p1, { state: "standby" });
    const info = totalDisplay(turn, p1.id); // p1 viewing themselves
    expect(info.value).toBe("9");
  });

  it("reveals the total to everyone once the round actually resolves the turn to won", () => {
    const turn = makeTurn(p1, { state: "won" });
    const info = totalDisplay(turn, p2.id);
    expect(info.value).toBe("9");
  });

  it("reveals the total to everyone once the round actually resolves the turn to lost", () => {
    const turn = makeTurn(p1, { state: "lost", cards: [{ name: "10", attributes: { values: [10] } }, { name: "9", attributes: { values: [9] } }, { name: "9", attributes: { values: [9] } }] });
    const info = totalDisplay(turn, p2.id);
    expect(info.value).toBe("28"); // a genuine bust total, still shown once lost
  });

  it("still hides a merely-pending (never stood) player's total from other viewers", () => {
    const turn = makeTurn(p1, { state: "pending" });
    const info = totalDisplay(turn, p2.id);
    expect(info.value).toBe("hidden");
  });

  it("does not affect the banker's own hole-card reveal timing", () => {
    // Banker's own turn resolves to "standby" at round end (see round.ts's
    // calculateEndState) -- forceBankerReveal (driven by roundState ===
    // "terminate" in Seat.tsx) is what reveals it then, not the removed
    // isPublicStandby path this fix touched.
    const turn = makeTurn(banker, { state: "standby", cards: [{ name: "9", attributes: { values: [9] } }, { name: "7", attributes: { values: [7] } }] });
    const hiddenInfo = totalDisplay(turn, p1.id, "playing", { forceBankerReveal: false });
    expect(hiddenInfo.value).toBe("hidden");
    const revealedInfo = totalDisplay(turn, p1.id, "terminate", { forceBankerReveal: true });
    expect(revealedInfo.value).toBe("16");
  });
});

// This is the client-side mirror of backend/src/turn.ts's calcSums. The rule
// lives in two places, so these expectations are deliberately the same ones
// the backend's own simulate.ts asserts -- if the two ever drift, the total a
// player SEES stops matching the total they're settled on.
describe("allTotals/bestTotal -- the 12 re-reads itself at every point in the round", () => {
  const c = (name: string, values: number[]): Card => ({ name, attributes: { values } });
  const C12 = c("12", [12, 9, 10]);
  const C10 = c("10", [10]);
  const C2 = c("2", [2]);
  const C9 = c("9", [9]);

  it("reads a lone 12 as its highest value", () => {
    expect(bestTotal([C12]).total).toBe(12);
  });

  it("drops the same 12 to a 10 rather than busting the hand at 22", () => {
    expect(allTotals([C12, C10]).sort((a, b) => a - b)).toContain(20);
    expect(bestTotal([C12, C10]).total).toBe(20);
  });

  it("drops that 12 again to a 9 when a third card makes 21 reachable", () => {
    expect(bestTotal([C12, C10, C2]).total).toBe(21);
  });

  it("only reports a bust when every reading is over 21, and shows the smallest", () => {
    const busted = bestTotal([C12, C12, C12]);
    expect(busted.total).toBeUndefined();
    expect(busted.bustedTotal).toBe(27); // 9+9+9, the kindest reading available
  });

  it("stays bounded rather than tripling per 12, so a long hand can't hang the tab", () => {
    const totals = allTotals(Array.from({ length: 20 }, () => C12));
    expect(totals.length).toBeLessThanOrEqual(22);
    expect(new Set(totals).size).toBe(totals.length);
  });

  it("shows the owner the re-read total, not a fixed-value one", () => {
    const owner: Player = { id: "me", firstName: "Me", lastName: "", type: "player", presence: "online" };
    const turn: Turn = { player: owner, state: "pending", cards: [C12, C9], bet: 5 };
    expect(totalDisplay(turn, owner.id).value).toBe("21");
  });
});

describe("tagVariant -- the banker's own status pill must match a player's", () => {
  // Dealer.tsx used to compute this inline with only "turn"/"stand"/"muted",
  // silently dropping WON/FUTCHED! to a dull grey "muted" pill for the
  // banker's own bust or win. Both seats now share this one mapping.
  it("shows the same red 'bust' variant for FUTCHED! as for a plain LOST", () => {
    expect(tagVariant("FUTCHED!", false)).toBe("bust");
    expect(tagVariant("LOST", false)).toBe("bust");
  });

  it("shows the green 'won' variant for WON", () => {
    expect(tagVariant("WON", false)).toBe("won");
  });

  it("prioritizes the active-turn variant over the label", () => {
    expect(tagVariant("FUTCHED!", true)).toBe("turn");
  });

  it("falls back to muted for anything else", () => {
    expect(tagVariant("PUSH", false)).toBe("muted");
    expect(tagVariant("Waiting...", false)).toBe("muted");
  });
});
