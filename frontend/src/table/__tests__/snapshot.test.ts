import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { snapshotFilename } from "../snapshot";

const SOURCE = readFileSync(resolve(__dirname, "../snapshot.ts"), "utf8");

describe("snapshotFilename", () => {
  const at = new Date(2026, 0, 5);

  it("names the file after the table, the round and the date", () => {
    expect(snapshotFilename("Chanukah night 3", 7, at)).toBe("Kvitlach - Chanukah night 3 - round 7 - 2026-01-05.png");
  });

  it("drops the round when there isn't one", () => {
    expect(snapshotFilename("Chanukah night 3", undefined, at)).toBe("Kvitlach - Chanukah night 3 - 2026-01-05.png");
  });

  it("strips characters Windows will not save", () => {
    // A download that silently fails to save is worse than an ugly filename,
    // and room names are player-authored.
    const name = snapshotFilename('Zaidy: "the big one" <night 4/5>', 2, at);
    expect(name).not.toMatch(/[\/:*?"<>|]/);
    expect(name).toContain("Zaidy");
  });

  it("survives an empty room name rather than producing a nameless file", () => {
    expect(snapshotFilename("", undefined, at)).toBe("Kvitlach - Kvitlach - 2026-01-05.png");
  });
});

describe("what a snapshot is allowed to show", () => {
  // The point of drawing this by hand instead of rasterizing the DOM is that
  // concealment becomes a decision this file makes, not a side effect of which
  // cards happened to be face-down on screen. A snapshot taken mid-round and
  // sent to a player still deciding their hand is the leak that matters, and
  // these pin the two things that prevent it.
  //
  // Asserted at the source level on purpose: jsdom has no canvas, so there is
  // no rendered pixel to inspect, and the invariant is about which function
  // decides -- which is exactly what source can answer and a mock cannot.

  it("reads totals through totalDisplay, never off turn.cards", () => {
    expect(SOURCE).toContain("totalDisplay(");
    // bestTotal is the raw, unconcealed calculation. Calling it here would
    // compute the true total and print it regardless of who is looking.
    expect(SOURCE).not.toContain("bestTotal(");
  });

  it("keeps the bank's hole card down unless the viewer is the banker or the round resolved", () => {
    expect(SOURCE).toContain("const isOwner = viewerId === bankerTurn.player.id;");
    expect(SOURCE).toContain('const resolved = bankerTurn.state !== "pending";');
    expect(SOURCE).toContain("drawHand(ctx, bankerTurn.cards, images, cx, y, !isOwner && !resolved)");
  });

  it("draws an unknown face as a card back rather than skipping it", () => {
    // A hand that silently loses a card is a snapshot that misrepresents the
    // round -- worse than an obviously unrendered one.
    expect(SOURCE).toContain("// Face-down, or a face that failed to load.");
  });
});
