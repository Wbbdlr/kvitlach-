import { describe, expect, it } from "vitest";
import { totalDisplay } from "../selectors";
import { Player, Turn } from "../../types";

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
