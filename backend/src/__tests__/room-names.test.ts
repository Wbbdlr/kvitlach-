import { describe, expect, it } from "vitest";
import { GameStore } from "../store.js";

// "Practice Table" outlived the mode it named. This is "Play Against the
// Computer" now -- a real standalone way to play, not a tutorial -- and a
// table labelled "Practice" reads like something the player is stuck inside.
// A solo table is named from the same pithy pool a hosted one draws from, so
// nothing about playing alone announces itself as the lesser option.
//
// A fresh store per table on purpose: both creation paths are capacity-limited
// (and practice rooms rightly so), and this is asserting naming, not capacity.
const soloName = (roomName?: string) =>
  new GameStore().createPracticeRoom({ firstName: "Solo", botCount: 2, roomName }).room.name ?? "";

const hostedName = () =>
  new GameStore().createRoom({ firstName: "Banker", buyIn: 10, bankerBankroll: 100 }).room.name ?? "";

describe("what a table is called when nobody picks", () => {
  it("never calls a computer table Practice Table again", () => {
    for (let i = 0; i < 30; i++) expect(soloName()).not.toBe("Practice Table");
  });

  it("draws solo names from the same bag as hosted ones", () => {
    // Not pinning specific names -- the pool is content and will grow. That
    // the two paths share one bag is the invariant worth holding.
    const hosted = new Set<string>();
    for (let i = 0; i < 60; i++) hosted.add(hostedName());
    const solo = new Set<string>();
    for (let i = 0; i < 60; i++) solo.add(soloName());
    expect(solo.size, "every solo table got the same name").toBeGreaterThan(1);
    for (const name of solo) expect(hosted.has(name), `${name} is not in the shared pool`).toBe(true);
  });

  it("keeps a name the player actually typed", () => {
    expect(soloName("Zeide's Tish")).toBe("Zeide's Tish");
  });

  it("treats a blank or whitespace name as no name at all", () => {
    for (const blank of ["", "   ", "\t"]) {
      const name = soloName(blank);
      expect(name.trim(), `"${blank}" was taken as a name`).toBe(name);
      expect(name.length).toBeGreaterThan(3);
    }
  });
});
