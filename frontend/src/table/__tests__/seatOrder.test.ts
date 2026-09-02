import { describe, it, expect } from "vitest";
import { orderSeatsForViewer, orderTurnsBySeat, viewerSlotIndex } from "../layout";

// Seat position and turn order are two different things that were sharing one
// array. A tester at a live table reported players visibly changing seats
// between rounds; the cause was the client laying seats out by each turn's
// index in round.turns, which the server rotates every round on purpose.
//
// The rules these tests encode, stated as the game states them:
//   - turn order rotates each round: round 1 starts with the player to the
//     banker's left, round 2 with the next player along, and so on. The banker
//     acts last regardless.
//   - seat positions never move. A player's chair is fixed for their whole
//     session and changes only when someone joins or leaves.

type Player = { id: string; type: "player" | "admin" };
type Turn = { player: Player };

// The seating at the table, in join order. This is room.players, and nothing
// reorders it -- players are appended on join and removed on leave.
const PLAYERS: Player[] = [
  { id: "banker", type: "admin" },
  { id: "avi", type: "player" },
  { id: "berel", type: "player" },
  { id: "chaim", type: "player" },
  { id: "dovid", type: "player" },
];

// Mirrors backend/src/store.ts's startRound: the seated players are rotated by
// nextStart so a different one leads each round, and the banker is appended
// last. Duplicated deliberately -- the point of the test is that the CLIENT
// stays stable while this rotates underneath it, so the rotation has to be
// real rather than stubbed out.
function turnsForRound(roundIndex: number): Turn[] {
  const others = PLAYERS.filter((p) => p.type === "player");
  const start = roundIndex % others.length;
  const rotated = others.slice(start).concat(others.slice(0, start));
  const banker = PLAYERS.find((p) => p.type === "admin")!;
  return [...rotated, banker].map((player) => ({ player }));
}

const seatIds = (turns: Turn[]) => turns.map((t) => t.player.id);

describe("seat order is independent of turn order", () => {
  it("rotates the starting player each round, banker always last", () => {
    // The premise. If this ever stops being true the seat assertions below are
    // testing nothing, because there would be no rotation left to survive.
    expect(seatIds(turnsForRound(0))).toEqual(["avi", "berel", "chaim", "dovid", "banker"]);
    expect(seatIds(turnsForRound(1))).toEqual(["berel", "chaim", "dovid", "avi", "banker"]);
    expect(seatIds(turnsForRound(2))).toEqual(["chaim", "dovid", "avi", "berel", "banker"]);
    expect(seatIds(turnsForRound(3))).toEqual(["dovid", "avi", "berel", "chaim", "banker"]);
  });

  it("holds every seat still across a full rotation and beyond", () => {
    const first = seatIds(orderTurnsBySeat(turnsForRound(0), PLAYERS, (t) => t.player.id));
    expect(first).toEqual(["banker", "avi", "berel", "chaim", "dovid"]);
    // Eight rounds -- twice round the table, so a bug that only shows on the
    // wrap would still be caught.
    for (let round = 1; round < 8; round += 1) {
      const seats = seatIds(orderTurnsBySeat(turnsForRound(round), PLAYERS, (t) => t.player.id));
      expect(seats, `seats moved at round ${round + 1}`).toEqual(first);
    }
  });

  it("keeps the viewer bottom-centre without dragging the others round with them", () => {
    // The composition TableRoot actually renders: seat order first, then the
    // viewer pinned to the near edge. Both players below sit at a fixed slot
    // for every round, which is the property the tester saw violated.
    const seatOf = (round: number, viewer: string) => {
      const ordered = orderTurnsBySeat(turnsForRound(round), PLAYERS, (t) => t.player.id);
      const arranged = orderSeatsForViewer(ordered, (t) => t.player.id === viewer);
      return seatIds(arranged);
    };
    for (const viewer of ["avi", "dovid"]) {
      const first = seatOf(0, viewer);
      // The viewer really is at the bottom-centre slot, not merely stable.
      expect(first[viewerSlotIndex(first.length)]).toBe(viewer);
      for (let round = 1; round < 8; round += 1) {
        expect(seatOf(round, viewer), `${viewer}'s view moved at round ${round + 1}`).toEqual(first);
      }
    }
  });

  it("moves seats only when the table's membership changes", () => {
    const before = seatIds(orderTurnsBySeat(turnsForRound(3), PLAYERS, (t) => t.player.id));
    const withoutBerel = PLAYERS.filter((p) => p.id !== "berel");
    const turns = turnsForRound(3).filter((t) => t.player.id !== "berel");
    const after = seatIds(orderTurnsBySeat(turns, withoutBerel, (t) => t.player.id));
    expect(after).toEqual(before.filter((id) => id !== "berel"));
  });

  it("puts a turn for someone no longer seated last instead of throwing", () => {
    // Transient during a broadcast: round:state can carry a turn for a player
    // room:state has already dropped. Blanking the felt over that would be a
    // worse bug than a briefly odd seat.
    const ghost: Turn = { player: { id: "left-the-table", type: "player" } };
    const seats = seatIds(orderTurnsBySeat([ghost, ...turnsForRound(0)], PLAYERS, (t) => t.player.id));
    expect(seats[seats.length - 1]).toBe("left-the-table");
  });
});
