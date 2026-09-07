import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DISCLAIMER_HEADINGS,
  DISCLAIMER_MAX,
  DISCLAIMER_SLUGS,
  DisclaimerContent,
  isDisclaimerSlug,
  normalizeDisclaimerText,
} from "../disclaimer.js";
import { createHttpServer } from "../http-server.js";
import { GameStore } from "../store.js";

describe("normalizeDisclaimerText", () => {
  it("keeps the only formatting this field has", () => {
    expect(normalizeDisclaimerText("Line one\n\nLine two", DISCLAIMER_MAX.body)).toBe("Line one\n\nLine two");
  });

  it("collapses CRLF so a Windows paste does not double every break", () => {
    expect(normalizeDisclaimerText("one\r\n\r\ntwo\rthree", DISCLAIMER_MAX.body)).toBe("one\n\ntwo\nthree");
  });

  it("strips control characters a terminal paste carries", () => {
    const esc = String.fromCharCode(0x1b);
    const nul = String.fromCharCode(0);
    expect(normalizeDisclaimerText(`Sara${esc}[31m${nul} Yossi`, DISCLAIMER_MAX.body)).toBe("Sara[31m Yossi");
  });

  it("trims and bounds", () => {
    expect(normalizeDisclaimerText("   padded   ", DISCLAIMER_MAX.body)).toBe("padded");
    expect(normalizeDisclaimerText("x".repeat(9000), DISCLAIMER_MAX.body)).toHaveLength(DISCLAIMER_MAX.body);
  });

  it("returns empty for anything that is not a string", () => {
    for (const bad of [null, undefined, 42, {}, [], true]) {
      expect(normalizeDisclaimerText(bad, DISCLAIMER_MAX.body)).toBe("");
    }
  });

  it("does not escape HTML", () => {
    expect(normalizeDisclaimerText("<b>bold</b> & plain", DISCLAIMER_MAX.body)).toBe("<b>bold</b> & plain");
  });
});

describe("isDisclaimerSlug", () => {
  it("accepts every known slug", () => {
    for (const slug of DISCLAIMER_SLUGS) expect(isDisclaimerSlug(slug)).toBe(true);
  });

  it("rejects anything else, including a plausible-looking guess", () => {
    for (const bad of ["gambling ", "Gambling", "credits", "", 5, null, undefined, {}]) {
      expect(isDisclaimerSlug(bad)).toBe(false);
    }
  });
});

describe("DisclaimerContent", () => {
  it("starts with every section empty, so the page shows only its built-in wording", () => {
    const disclaimer = new DisclaimerContent();
    expect(disclaimer.isEmpty()).toBe(true);
    const record = disclaimer.toRecord();
    for (const slug of DISCLAIMER_SLUGS) expect(record[slug]).toEqual({ body: "", updatedAt: 0 });
  });

  it("overriding one section leaves every other section untouched", () => {
    const disclaimer = new DisclaimerContent();
    expect(disclaimer.set("liability", "New liability wording.")).toBe(true);
    expect(disclaimer.isEmpty()).toBe(false);
    const record = disclaimer.toRecord();
    expect(record.liability.body).toBe("New liability wording.");
    for (const slug of DISCLAIMER_SLUGS) {
      if (slug === "liability") continue;
      expect(record[slug]).toEqual({ body: "", updatedAt: 0 });
    }
  });

  it("persists through onChange only when that section actually changed", () => {
    const onChange = vi.fn();
    const disclaimer = new DisclaimerContent(onChange);
    expect(disclaimer.set("ownership", "New ownership wording.")).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].ownership).toMatchObject({ body: "New ownership wording." });

    expect(disclaimer.set("ownership", "New ownership wording.")).toBe(false);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("rejects an unrecognised slug -- no route to create a new section", () => {
    const onChange = vi.fn();
    const disclaimer = new DisclaimerContent(onChange);
    expect(disclaimer.set("bogus-section", "text")).toBe(false);
    expect(disclaimer.set(undefined, "text")).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
    expect(disclaimer.isEmpty()).toBe(true);
  });

  it("clears one section back to empty without touching the rest", () => {
    const disclaimer = new DisclaimerContent();
    disclaimer.set("gambling", "override");
    disclaimer.set("liability", "override");
    expect(disclaimer.clear("gambling")).toBe(true);
    expect(disclaimer.toRecord().gambling.body).toBe("");
    expect(disclaimer.toRecord().liability.body).toBe("override");
    expect(disclaimer.clear("gambling")).toBe(false);
  });

  it("normalizes on the way in, not just on the way out", () => {
    const disclaimer = new DisclaimerContent();
    disclaimer.set("warranties", "  line\r\nline  ");
    expect(disclaimer.toRecord().warranties.body).toBe("line\nline");
  });

  it("re-normalizes on hydrate and does not write back what it just read", () => {
    const onChange = vi.fn();
    const disclaimer = new DisclaimerContent(onChange);
    disclaimer.hydrate({ ownership: { body: "z".repeat(9000), updatedAt: 1234 } });
    expect(onChange).not.toHaveBeenCalled();
    expect(disclaimer.toRecord().ownership.body).toHaveLength(DISCLAIMER_MAX.body);
    expect(disclaimer.toRecord().ownership.updatedAt).toBe(1234);
    expect(disclaimer.toRecord().liability).toEqual({ body: "", updatedAt: 0 });
  });

  it("ignores an unknown key in a hand-edited row rather than throwing", () => {
    const disclaimer = new DisclaimerContent();
    expect(() => disclaimer.hydrate({ "not-a-real-section": { body: "x", updatedAt: 1 } } as never)).not.toThrow();
    expect(disclaimer.isEmpty()).toBe(true);
  });

  it("survives a row that is missing, partial or garbage", () => {
    const disclaimer = new DisclaimerContent();
    disclaimer.hydrate(undefined);
    disclaimer.hydrate(null);
    disclaimer.hydrate({});
    disclaimer.hydrate({ liability: { body: 5 as unknown as string, updatedAt: NaN } });
    expect(disclaimer.isEmpty()).toBe(true);
  });

  it("returns a copy from toRecord, not a live reference", () => {
    const disclaimer = new DisclaimerContent();
    disclaimer.set("gambling", "override");
    const record = disclaimer.toRecord();
    record.gambling.body = "tampered";
    expect(disclaimer.toRecord().gambling.body).toBe("override");
  });
});

describe("DISCLAIMER_HEADINGS", () => {
  it("names every slug, and only known slugs", () => {
    expect(Object.keys(DISCLAIMER_HEADINGS).sort()).toEqual([...DISCLAIMER_SLUGS].sort());
    for (const heading of Object.values(DISCLAIMER_HEADINGS)) {
      expect(typeof heading).toBe("string");
      expect(heading.length).toBeGreaterThan(0);
    }
  });
});

describe("the Disclaimer routes", () => {
  const originalToken = process.env.ADMIN_TOKEN;
  afterEach(() => {
    process.env.ADMIN_TOKEN = originalToken;
  });

  it("serves the full per-section record publicly, with no token and no auth", async () => {
    delete process.env.ADMIN_TOKEN;
    const disclaimer = new DisclaimerContent();
    disclaimer.set("liability", "New liability wording.");
    const app = createHttpServer(new GameStore(), { disclaimer });
    const res = await app.inject({ method: "GET", url: "/api/disclaimer" });
    expect(res.statusCode).toBe(200);
    expect(res.json().liability).toMatchObject({ body: "New liability wording." });
    expect(res.json().gambling).toMatchObject({ body: "" });
    expect(res.headers["cache-control"]).toBe("public, max-age=60");
  });

  it("serves all-empty rather than 404 when nothing is set", async () => {
    const app = createHttpServer(new GameStore());
    const res = await app.inject({ method: "GET", url: "/api/disclaimer" });
    expect(res.statusCode).toBe(200);
    for (const slug of DISCLAIMER_SLUGS) expect(res.json()[slug]).toEqual({ body: "", updatedAt: 0 });
  });

  it("refuses a write without the admin token", async () => {
    process.env.ADMIN_TOKEN = "correct-secret";
    const disclaimer = new DisclaimerContent();
    const app = createHttpServer(new GameStore(), { disclaimer });
    const res = await app.inject({
      method: "POST",
      url: "/admin/disclaimer",
      payload: { slug: "liability", body: "Hacked" },
    });
    expect(res.statusCode).toBe(404);
    expect(disclaimer.isEmpty()).toBe(true);
  });

  it("writes one section with the admin token, and the public route shows it alone changed", async () => {
    process.env.ADMIN_TOKEN = "correct-secret";
    const disclaimer = new DisclaimerContent();
    const app = createHttpServer(new GameStore(), { disclaimer });

    const post = await app.inject({
      method: "POST",
      url: "/admin/disclaimer?token=correct-secret",
      payload: { slug: "ownership", body: "Revised ownership text." },
    });
    expect(post.statusCode).toBe(302);
    expect(post.headers.location).toContain("/admin/disclaimer");

    const get = await app.inject({ method: "GET", url: "/api/disclaimer" });
    expect(get.json().ownership).toMatchObject({ body: "Revised ownership text." });
    for (const slug of DISCLAIMER_SLUGS) {
      if (slug === "ownership") continue;
      expect(get.json()[slug]).toMatchObject({ body: "" });
    }

    const clear = await app.inject({
      method: "POST",
      url: "/admin/disclaimer?token=correct-secret",
      payload: { slug: "ownership", clear: "1" },
    });
    expect(clear.statusCode).toBe(302);
    expect((await app.inject({ method: "GET", url: "/api/disclaimer" })).json().ownership).toMatchObject({
      body: "",
    });
  });

  it("rejects a POST with an unrecognised slug rather than creating a new section", async () => {
    process.env.ADMIN_TOKEN = "correct-secret";
    const disclaimer = new DisclaimerContent();
    const app = createHttpServer(new GameStore(), { disclaimer });
    const res = await app.inject({
      method: "POST",
      url: "/admin/disclaimer?token=correct-secret",
      payload: { slug: "bogus-section", body: "text" },
    });
    // Still redirects (the guard passed; the write itself is a no-op) -- the
    // route never 500s on a bad slug, it just changes nothing.
    expect(res.statusCode).toBe(302);
    expect(disclaimer.isEmpty()).toBe(true);
  });

  it("shows an overridden-section count on the panel and links to the editor", async () => {
    process.env.ADMIN_TOKEN = "correct-secret";
    const disclaimer = new DisclaimerContent();
    disclaimer.set("gambling", "override");
    const app = createHttpServer(new GameStore(), { disclaimer });
    const res = await app.inject({ method: "GET", url: "/admin?token=correct-secret" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("/admin/disclaimer");
    expect(res.body).toContain("1 of 6 section(s) overridden");
  });

  it("serves the editor with no auto-refresh, a fieldset per section, and every heading", async () => {
    process.env.ADMIN_TOKEN = "correct-secret";
    const disclaimer = new DisclaimerContent();
    disclaimer.set("liability", "Revised liability text.");
    const app = createHttpServer(new GameStore(), { disclaimer });

    const editor = await app.inject({ method: "GET", url: "/admin/disclaimer?token=correct-secret" });
    expect(editor.statusCode).toBe(200);
    expect(editor.body).not.toContain('http-equiv="refresh"');
    expect(editor.body).toContain("Revised liability text.");
    for (const heading of Object.values(DISCLAIMER_HEADINGS)) {
      expect(editor.body).toContain(heading);
    }
    // One <textarea> per section, not one shared field.
    expect(editor.body.match(/<textarea/g)?.length).toBe(DISCLAIMER_SLUGS.length);
  });

  it("keeps the editor behind the admin guard", async () => {
    process.env.ADMIN_TOKEN = "correct-secret";
    const app = createHttpServer(new GameStore(), { disclaimer: new DisclaimerContent() });
    expect((await app.inject({ method: "GET", url: "/admin/disclaimer" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/admin/disclaimer?token=wrong" })).statusCode).toBe(404);
  });
});
