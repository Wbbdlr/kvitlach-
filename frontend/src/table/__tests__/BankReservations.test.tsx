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
});
