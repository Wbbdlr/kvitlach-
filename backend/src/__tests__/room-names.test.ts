import { describe, expect, it } from "vitest";
import { GameStore, ROOM_NAME_POOL } from "../store.js";

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
    // Checked against the POOL, not against a sample of hosted names.
    //
    // This used to draw 60 hosted names and 60 solo ones and assert every
    // solo name appeared among the hosted -- which is a coupon-collector
    // problem, not an invariant. With 19 names in the bag a single name is
    // absent from 60 draws about 4% of the time, so the whole assertion held
    // only about 40% of the time: it failed on roughly three runs in five,
    // for reasons that had nothing to do with the code under test. Measured,
    // not guessed -- eight runs at the commit that shipped it went 3/5.
    //
    // The invariant worth holding is that neither path can produce a name
    // from outside the shared bag, and that is exact.
    const pool = new Set(ROOM_NAME_POOL);
    const solo = new Set<string>();
    const hosted = new Set<string>();
    for (let i = 0; i < 60; i++) {
      solo.add(soloName());
      hosted.add(hostedName());
    }
    expect(solo.size, "every solo table got the same name").toBeGreaterThan(1);
    expect(hosted.size, "every hosted table got the same name").toBeGreaterThan(1);
    for (const name of solo) expect(pool.has(name), `${name} is not in the shared pool`).toBe(true);
    for (const name of hosted) expect(pool.has(name), `${name} is not in the shared pool`).toBe(true);
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
