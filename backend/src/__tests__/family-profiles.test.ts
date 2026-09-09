import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHttpServer } from "../http-server.js";
import { GameStore } from "../store.js";
import { AdminAuth, hashPassword } from "../admin-auth.js";
import {
  CHIP_NAMES,
  FELT_NAMES,
  FamilyProfiles,
  HOUSE,
  HOUSE_SLUG,
  normalizeMark,
  normalizeProfile,
  normalizeSlug,
} from "../family-profiles.js";

// A family opens kvitlach.us/m/dov and their table looks like theirs.
//
// The design rule this file mostly exists to hold: THE HOUSE LOOK IS A PROFILE
// TOO. If it were "what happens when no profile is set", every read site would
// need a profile-or-default branch and family mode would be a second code path
// that rots the first time somebody forgets it. get() therefore never returns
// undefined, and nothing in the app asks "is this a family table".

const PORT = 39791;
const families = new FamilyProfiles();
const store = new GameStore(undefined, undefined, undefined, families);
const app = createHttpServer(store, {
  auth: new AdminAuth({ username: "admin", password: hashPassword("pw"), secret: "secret" }),
  families,
});
const base = `http://127.0.0.1:${PORT}`;
let cookie = "";

const DOV = {
  slug: "dov",
  name: "Dov",
  greeting: "Welcome, Dov Family",
  feltPrint: "משפחת דב קוויטלעך",
  cardMark: "DOV",
  felt: "spruce",
  chip: "gold",
  bankerNames: "Zeide Dov",
  playerNames: "Shloimy\nRuchie",
  accessCode: "chanukah",
};

beforeAll(async () => {
  await app.listen({ port: PORT, host: "127.0.0.1" });
  const res = await fetch(`${base}/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: "admin", password: "pw" }),
    redirect: "manual",
  });
  cookie = res.headers.get("set-cookie")?.split(";")[0] ?? "";
});

afterAll(async () => {
  await app.close();
});

describe("the house look is a profile", () => {
  it("answers for an unknown slug rather than returning nothing", () => {
    // The point of the whole design. A caller holding "the active profile"
    // never has to decide what to do without one.
    const empty = new FamilyProfiles();
    expect(empty.get("nobody").slug).toBe(HOUSE_SLUG);
    expect(empty.get(undefined).cardMark).toBe("SCHLESINGER");
    expect(empty.get("").felt).toBe("navy");
  });

  it("cannot be overwritten by a family calling itself house", () => {
    const p = new FamilyProfiles();
    expect(p.save({ ...DOV, slug: HOUSE_SLUG })).toBe(false);
    expect(p.get(HOUSE_SLUG)).toEqual(HOUSE);
  });

  it("is not reachable over the public lookup", async () => {
    // Serving it would only tell a prober the difference between "no such
    // family" and "the server is fine". The client already renders it.
    expect((await fetch(`${base}/api/family?slug=${HOUSE_SLUG}`)).status).toBe(404);
  });
});

describe("normalizing", () => {
  it("takes only a URL-safe slug", () => {
    expect(normalizeSlug("Dov")).toBe("dov");
    expect(normalizeSlug("  dov family ")).toBe("dov-family");
    for (const junk of ["../etc", "dov/", "dov?x=1", "-dov", "דב", "", null, 7]) {
      expect(normalizeSlug(junk), String(junk)).toBe("");
    }
  });

  it("refuses Hebrew in the card mark, because the face has no Hebrew glyphs", () => {
    // Hebrew here would draw literally nothing on the card, which a family
    // would find out mid-game rather than at the form. The felt print is the
    // field that takes it.
    expect(normalizeMark("דב")).toBe("");
    expect(normalizeMark("dov")).toBe("DOV");
  });

  it("keeps Hebrew in the felt print, which is where it belongs", () => {
    expect(normalizeProfile(DOV)!.feltPrint).toBe("משפחת דב קוויטלעך");
  });

  it("leaves the colour EMPTY rather than asserting one, when none was picked", () => {
    // Empty means "no opinion", which the client reads as "use the house look"
    // -- and it keeps following the house look when the operator changes it.
    // Filling in the shipped navy here instead pinned every family to navy, so
    // an operator who set a house felt found it reaching everybody except the
    // families. Found by an operator, not by a test, which is why this one now
    // exists.
    const blank = normalizeProfile({ ...DOV, felt: "", chip: "" })!;
    expect(blank.felt).toBe("");
    expect(blank.chip).toBe("");
  });

  it("inherits rather than guessing when the colour is one this build lacks", () => {
    const p = normalizeProfile({ ...DOV, felt: "plaid", chip: "bronze" })!;
    expect(p.felt).toBe("");
    expect(p.chip).toBe("");
  });

  it("keeps a colour the family DID pick", () => {
    expect(normalizeProfile(DOV)!.felt).toBe("spruce");
  });

  it("refuses a profile with no usable address at all", () => {
    expect(normalizeProfile({ ...DOV, slug: "!!" })).toBeUndefined();
  });
});

describe("the felt and chip lists", () => {
  // Restated on the backend because there is no shared package between the two
  // halves of this repo. Restating is fine; diverging is not -- a felt the
  // panel offers and the client has never heard of would silently do nothing.
  const THEME = readFileSync(resolve(__dirname, "../../../frontend/src/theme.ts"), "utf8");

  const namesIn = (constant: string) => {
    const start = THEME.indexOf(`export const ${constant}: Record<`);
    if (start === -1) throw new Error(`${constant} moved in frontend/src/theme.ts`);
    const block = THEME.slice(start, THEME.indexOf("\n};", start));
    return [...block.matchAll(/^ {2}([a-z]+): \{/gm)].map((m) => m[1]).sort();
  };

  it("matches the felts the client actually has", () => {
    expect([...FELT_NAMES].sort()).toEqual(namesIn("FELTS"));
  });

  it("matches the chip themes the client actually has", () => {
    expect([...CHIP_NAMES].sort()).toEqual(namesIn("CHIPS"));
  });

  it("keeps two felts out of the switcher for families to use", () => {
    // Reserved by a flag on the felt, not by a "family felts" list -- so
    // nothing has to ask whether a family is present. See Felt.listed.
    expect(THEME).toMatch(/spruce:.*listed: false/);
    expect(THEME).toMatch(/plum:.*listed: false/);
    expect(THEME).toMatch(/navy:.*listed: true/);
  });
});

describe("the public lookup", () => {
  it("serves one family by slug", async () => {
    families.save(DOV);
    const res = await fetch(`${base}/api/family?slug=dov`);
    expect(res.status).toBe(200);
    const doc = (await res.json()) as Record<string, unknown>;
    expect(doc.cardMark).toBe("DOV");
    expect(doc.feltPrint).toBe(DOV.feltPrint);
    expect(doc.felt).toBe("spruce");
  });

  it("404s an unknown slug with no body to read", async () => {
    // Nothing to walk: the answer for a slug that does not exist is the same
    // as for one that never could.
    const res = await fetch(`${base}/api/family?slug=cohen`);
    expect(res.status).toBe(404);
    expect((await res.text()).length).toBe(0);
  });

  it("has no route that lists families", async () => {
    // A profile carries a surname. A directory of them is not something an
    // unauthenticated browser should be able to page through.
    for (const path of ["/api/family", "/api/families", "/api/family?slug=", "/api/config"]) {
      const body = await (await fetch(`${base}${path}`)).text();
      expect(body, path).not.toContain("dov");
    }
  });

  it("keeps the editor behind the admin session", async () => {
    const page = await fetch(`${base}/admin/families`, { redirect: "manual" });
    expect([401, 404]).toContain(page.status);
  });
});

describe("stamping a table", () => {
  it("puts the banker's family on the room, for everyone who joins", () => {
    families.save(DOV);
    const { room } = store.createRoom({ firstName: "B", buyIn: 10, bankerBankroll: 100, familyProfile: "dov" });
    expect(room.familyProfile).toBe("dov");
    // And it reaches a joiner, because it rides in the room state they get.
    expect(store.getRoom(room.roomId)!.familyProfile).toBe("dov");
  });

  it("deals a table anyway when the link was mistyped", () => {
    // A bad family link should still get you a game. The house look is the
    // right answer and is itself a profile.
    const { room } = store.createRoom({ firstName: "B", buyIn: 10, bankerBankroll: 100, familyProfile: "nope" });
    expect(room.familyProfile).toBeUndefined();
  });

  it("deals a family's own bot names at their practice table", () => {
    families.save(DOV);
    const { room } = store.createPracticeRoom({ firstName: "Solo", botCount: 2, familyProfile: "dov" });
    const state = store.getRoom(room.roomId)!;
    expect(state.players.find((p) => p.type === "admin")!.firstName).toBe("Zeide Dov");
    const bots = state.players.filter((p) => p.isBot && p.type === "player").map((p) => p.firstName);
    for (const name of bots) expect(["Shloimy", "Ruchie"]).toContain(name.replace(/ \d+$/, ""));
  });

  it("falls back per list, not all or nothing", () => {
    // A family that named their bankers but not their players gets their
    // bankers and the built-in seats.
    families.save({ ...DOV, slug: "half", playerNames: "" });
    const { room } = store.createPracticeRoom({ firstName: "Solo", botCount: 2, familyProfile: "half" });
    const state = store.getRoom(room.roomId)!;
    expect(state.players.find((p) => p.type === "admin")!.firstName).toBe("Zeide Dov");
    const bots = state.players.filter((p) => p.isBot && p.type === "player").map((p) => p.firstName);
    expect(bots).not.toContain("Shloimy");
  });

  it("uses the built-in names for a table with no family", () => {
    const { room } = store.createPracticeRoom({ firstName: "Solo", botCount: 2 });
    const state = store.getRoom(room.roomId)!;
    expect(state.players.find((p) => p.type === "admin")!.firstName).not.toBe("Zeide Dov");
  });
});
