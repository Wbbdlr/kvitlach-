import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyProfile, fetchProfile, leaveFamily, slugFromPath, storedSlug, activeProfile } from "../familyProfile";
import { DEFAULT_FELT, loadFelt, saveFelt } from "../theme";

// The client half of kvitlach.us/m/dov.
//
// The precedence is the feature, and it is a decision rather than an accident:
//
//   a player's own saved felt  >  the table's profile  >  this device's profile
//
// A family look never overrules somebody's own choice. Somebody who picked
// burgundy in December opens their family's table in burgundy.

const DOV = {
  slug: "dov",
  name: "Dov",
  greeting: "Welcome, Dov Family",
  feltPrint: "משפחת דב קוויטלעך",
  cardMark: "DOV",
  felt: "spruce",
  chip: "gold",
  accessCode: "",
};

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("style");
  applyProfile(null);
  vi.restoreAllMocks();
});

describe("reading the link", () => {
  it("takes the slug off /m/<slug>", () => {
    expect(slugFromPath("/m/dov")).toBe("dov");
    expect(slugFromPath("/m/dov/")).toBe("dov");
    expect(slugFromPath("/m/DOV")).toBe("dov");
  });

  it("ignores every other path, including the ones the app already owns", () => {
    // /m/ is a namespace precisely so a family can never collide with a page,
    // now or when a new page is added later.
    for (const path of ["/", "/about", "/table/ABC123", "/m/", "/m/a/b", "/mm/dov", "/m/../etc"]) {
      expect(slugFromPath(path), path).toBe("");
    }
  });
});

describe("applying a profile", () => {
  it("repaints the felt for somebody who has never chosen one", () => {
    applyProfile(DOV);
    expect(loadFelt()).toBe("spruce");
    expect(document.documentElement.style.getPropertyValue("--felt-hi")).toBe("#1f4a44");
  });

  it("leaves a player who HAS chosen exactly where they were", () => {
    // The rule the whole feature turns on.
    saveFelt("burgundy");
    applyProfile(DOV);
    expect(loadFelt()).toBe("burgundy");
    expect(document.documentElement.style.getPropertyValue("--felt-hi")).toBe("#5a2733");
  });

  it("does not write the family's felt into storage", () => {
    // Storing it would record a choice nobody made, and would then immunise
    // them against ever seeing a change to their family's own look.
    applyProfile(DOV);
    loadFelt();
    expect(localStorage.getItem("kvitlach.felt")).toBeNull();
  });

  it("puts the profile back to the house look when cleared", () => {
    applyProfile(DOV);
    expect(activeProfile()?.slug).toBe("dov");
    applyProfile(null);
    expect(activeProfile()).toBeNull();
    expect(loadFelt()).toBe(DEFAULT_FELT);
  });
});

describe("fetching one", () => {
  it("asks for exactly one slug and takes what comes back", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => DOV });
    vi.stubGlobal("fetch", fetchMock);

    const profile = await fetchProfile("dov");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/family?slug=dov");
    expect(profile?.cardMark).toBe("DOV");
  });

  it("treats a 404 as the ordinary answer for a mistyped link", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    expect(await fetchProfile("cohen")).toBeNull();
  });

  it("never throws when the network is gone", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await fetchProfile("dov")).toBeNull();
  });

  it("refuses a slug that is not URL-safe without asking the server", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchProfile("../api/config")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ignores a payload that is not a profile", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ felt: "spruce" }) }));
    expect(await fetchProfile("dov")).toBeNull();
  });
});

describe("what the device remembers", () => {
  it("only trusts a stored slug that still looks like one", () => {
    localStorage.setItem("kvitlach.family", "dov");
    expect(storedSlug()).toBe("dov");
    localStorage.setItem("kvitlach.family", "../etc/passwd");
    expect(storedSlug()).toBe("");
  });
});

describe("leaving", () => {
  // The way in rewrites the address bar to "/", so without an exit the mode was
  // enterable, invisible and permanent -- reported from a real session.
  it("forgets the family and goes back to the house look", () => {
    localStorage.setItem("kvitlach.family", "dov");
    applyProfile(DOV);
    leaveFamily();
    expect(activeProfile()).toBeNull();
    expect(storedSlug()).toBe("");
    expect(loadFelt()).toBe(DEFAULT_FELT);
  });

  it("leaves a player's own felt alone", () => {
    // Leaving family mode is not "reset my preferences".
    saveFelt("burgundy");
    applyProfile(DOV);
    leaveFamily();
    expect(loadFelt()).toBe("burgundy");
  });

  it("stays gone across a reload", () => {
    applyProfile(DOV);
    leaveFamily();
    expect(storedSlug()).toBe("");
  });
});
