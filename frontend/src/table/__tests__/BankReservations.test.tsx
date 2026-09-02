import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { BankReservations } from "../BankReservations";
import { reservedAgainst } from "../selectors";
import { seatPositions } from "../layout";
import { Player, Turn } from "../../types";

const player = (id: string): Player => ({ id, firstName: id, lastName: "", type: "player", presence: "online" });
const banker: Player = { id: "bank", firstName: "Bank", lastName: "", type: "admin", presence: "online" };

function turn(overrides: Partial<Turn> & { player: Player }): Turn {
  return { state: "pending", cards: [], bet: 0, ...overrides };
}

describe("reservedAgainst -- what the bank has tied up", () => {
  it("reserves a live wager", () => {
    expect(reservedAgainst(turn({ player: player("p1"), bet: 25 }))).toBe(25);
  });

  it("releases once the bank has won the hand or the seat was skipped", () => {
    expect(reservedAgainst(turn({ player: player("p1"), bet: 25, state: "lost" }))).toBe(0);
    expect(reservedAgainst(turn({ player: player("p1"), bet: 25, state: "skipped" }))).toBe(0);
  });

  it("releases once the hand has been settled live", () => {
    expect(reservedAgainst(turn({ player: player("p1"), bet: 25, state: "won", settled: true }))).toBe(0);
  });

  it("still reserves a standing hand -- the bank owes it until the banker plays", () => {
    expect(reservedAgainst(turn({ player: player("p1"), bet: 25, state: "standby" }))).toBe(25);
  });

  it("never reserves against the banker's own seat", () => {
    expect(reservedAgainst(turn({ player: banker, bet: 500 }))).toBe(0);
  });

  it("treats a blatt hand as reserving nothing", () => {
    expect(reservedAgainst(turn({ player: player("p1"), bet: 0 }))).toBe(0);
  });
});

describe("BankReservations placement", () => {
  const positions = seatPositions(6);
  const reservations = positions.map((position, i) => ({
    playerId: `p${i}`,
    amount: (i + 1) * 7,
    position,
  }));

  it("draws one chip badge and one connector per reservation", () => {
    const { container } = render(<BankReservations reservations={reservations} />);
    expect(container.querySelectorAll(".k-resv")).toHaveLength(6);
    expect(container.querySelectorAll(".k-resv-line")).toHaveLength(6);
  });

  it("renders nothing at all when the bank has nothing committed", () => {
    const { container } = render(<BankReservations reservations={[]} />);
    expect(container.querySelector(".k-resv")).toBeNull();
    expect(container.querySelector(".k-resv-lines")).toBeNull();
  });

  it("rests every badge the same distance back from its seat, however far away that seat is", () => {
    // Seats sit at very different distances from the pot on this ellipse, so
    // a fixed fraction crowded the near seat and stranded the far ones. The
    // clearance is what keeps a badge from being clipped by the seat painted
    // over it.
    const { container } = render(<BankReservations reservations={reservations} />);
    const lines = Array.from(container.querySelectorAll(".k-resv-line"));

    const clearances = lines.map((line, i) => {
      const x2 = Number(line.getAttribute("x2"));
      const y2 = Number(line.getAttribute("y2"));
      return Math.hypot(positions[i].x - x2, positions[i].y - y2);
    });

    clearances.forEach((gap) => {
      expect(gap).toBeGreaterThan(60); // never lands on the seat
      expect(gap).toBeLessThan(200); // nor strands the chips back at the pot
    });
  });

  it("keeps a full table's badges from stacking on top of each other", () => {
    const { container } = render(<BankReservations reservations={reservations} />);
    const points = Array.from(container.querySelectorAll(".k-resv-line")).map((line) => ({
      x: Number(line.getAttribute("x2")),
      y: Number(line.getAttribute("y2")),
    }));

    for (let i = 0; i < points.length; i += 1) {
      for (let j = i + 1; j < points.length; j += 1) {
        const gap = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y);
        expect(gap).toBeGreaterThan(40); // wider than a badge, so none overlap
      }
    }
  });

  it("shows the amount the bank is holding for each seat", () => {
    const { getByText } = render(<BankReservations reservations={reservations} />);
    expect(getByText("$7")).toBeInTheDocument();
    expect(getByText("$42")).toBeInTheDocument();
  });

  // This used to assert the OPPOSITE: that a seat too close to the pot had its
  // badge SKIPPED rather than forced into a collision. That was the right call
  // while a badge lived on the line between the bank and the seat, where a
  // short line genuinely has nowhere to put one -- but it meant the seat
  // closest to the pot never showed a badge, and the seat closest to the pot
  // is the viewer's own, by construction. The one reservation a player goes
  // looking for was the one guaranteed to be missing.
  //
  // A badge is now anchored above its own seat and never on that line, so
  // "there is no room" cannot arise: there is no seat whose own top edge is
  // unreachable. The old behaviour is inverted deliberately, not lost.
  it("places a badge even for a seat close to the pot, where it used to skip one", () => {
    const flattenedPositions = seatPositions(6, 0.54, 0);
    const closeSeat = flattenedPositions[Math.floor(flattenedPositions.length / 2)];
    const flattenedReservations = [{ playerId: "close", amount: 5, position: closeSeat }];

    const { container, getByText } = render(<BankReservations reservations={flattenedReservations} />);
    expect(container.querySelectorAll(".k-resv")).toHaveLength(1);
    expect(getByText("$5")).toBeInTheDocument();
  });

  // The anchoring contract itself: a badge sits directly above the seat it
  // belongs to. Asserted as a relationship to the seat rather than as
  // coordinates, so it keeps meaning if the ellipse or the offset changes.
  it("anchors every badge above its own seat, on that seat's centre line", () => {
    const positions = seatPositions(5, 1, 0);
    const reservations = positions.map((position, i) => ({ playerId: `p${i}`, amount: (i + 1) * 5, position }));

    const { container } = render(<BankReservations reservations={reservations} />);
    const badges = [...container.querySelectorAll<HTMLElement>(".k-resv")];
    expect(badges).toHaveLength(positions.length);

    badges.forEach((badge, i) => {
      const left = parseFloat(badge.style.left);
      const top = parseFloat(badge.style.top);
      expect(left, `badge ${i} should share its seat's x`).toBeCloseTo(positions[i].x, 5);
      expect(top, `badge ${i} should sit ABOVE its seat`).toBeLessThan(positions[i].y);
    });
  });

  it("still places a badge for a seat that has room, even on the same flattened table", () => {
    const flattenedPositions = seatPositions(6, 0.54, 0);
    const flankSeat = flattenedPositions[0]; // furthest from the pot on this ellipse
    const flattenedReservations = [{ playerId: "flank", amount: 5, position: flankSeat }];

    const { container } = render(<BankReservations reservations={flattenedReservations} />);
    expect(container.querySelectorAll(".k-resv")).toHaveLength(1);
  });

  // Regression: found live at a 7-player table (real seats measured ~60px
  // half-extent on screen, seatShrink well under 1). SEAT_CLEARANCE is
  // nominal (unscaled) stage-px, matching seatPositions()'s own output, but
  // the seat's REAL on-screen footprint shrinks with `scale` while the
  // clearance didn't -- so every badge floated a measured ~70px past its own
  // seat's edge, reading as unrelated to any particular player rather than
  // "this player's wager." The gap must shrink in step with `scale`.
  it("pulls a badge closer to its seat as the table shrinks the seat itself", () => {
    const flankSeat = positions[0];
    const oneReservation = [{ playerId: "flank", amount: 5, position: flankSeat }];

    const fullSize = render(<BankReservations reservations={oneReservation} scale={1} />);
    const shrunk = render(<BankReservations reservations={oneReservation} scale={0.5} />);

    const gapFromSeat = (container: HTMLElement) => {
      const line = container.querySelector(".k-resv-line")!;
      const x2 = Number(line.getAttribute("x2"));
      const y2 = Number(line.getAttribute("y2"));
      return Math.hypot(flankSeat.x - x2, flankSeat.y - y2);
    };

    const fullGap = gapFromSeat(fullSize.container);
    const shrunkGap = gapFromSeat(shrunk.container);
    expect(shrunkGap).toBeLessThan(fullGap);
  });
});
