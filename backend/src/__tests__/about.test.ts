import { afterEach, describe, expect, it, vi } from "vitest";
import { ABOUT_MAX, AboutContent, normalizeAboutText } from "../about.js";
import { createHttpServer } from "../http-server.js";
import { GameStore } from "../store.js";

describe("normalizeAboutText", () => {
  it("keeps the only formatting this field has", () => {
    expect(normalizeAboutText("Thanks to:\n\n- Sara\n- Yossi", ABOUT_MAX.body)).toBe(
      "Thanks to:\n\n- Sara\n- Yossi"
    );
    expect(normalizeAboutText("a\tb", ABOUT_MAX.body)).toBe("a\tb");
  });

  // A Windows paste is the normal case here, not the edge case: the operator
  // is on Windows and will paste a list out of Notepad or an email.
  it("collapses CRLF so a Windows paste does not double every break", () => {
    expect(normalizeAboutText("one\r\n\r\ntwo\rthree", ABOUT_MAX.body)).toBe("one\n\ntwo\nthree");
  });

  it("strips control characters a terminal paste carries", () => {
    const esc = String.fromCharCode(0x1b);
    const nul = String.fromCharCode(0);
    expect(normalizeAboutText(`Sara${esc}[31m${nul} Yossi`, ABOUT_MAX.body)).toBe("Sara[31m Yossi");
  });

  it("trims and bounds", () => {
    expect(normalizeAboutText("   padded   ", ABOUT_MAX.body)).toBe("padded");
    expect(normalizeAboutText("x".repeat(9000), ABOUT_MAX.body)).toHaveLength(ABOUT_MAX.body);
    expect(normalizeAboutText("y".repeat(400), ABOUT_MAX.heading)).toHaveLength(ABOUT_MAX.heading);
  });

  it("returns empty for anything that is not a string", () => {
    for (const bad of [null, undefined, 42, {}, [], true]) {
      expect(normalizeAboutText(bad, ABOUT_MAX.body)).toBe("");
    }
  });

  // Deliberate, and the reason is in about.ts: escaping here would be a guess
  // about the renderer, and About.tsx renders text as text. If this test starts
  // failing because someone added escaping, the renderer is the thing to check
  // -- double-escaping is the visible symptom; stored XSS is the invisible one
  // if the renderer changed instead.
  it("does not escape HTML", () => {
    expect(normalizeAboutText("<b>Sara</b> & Yossi", ABOUT_MAX.body)).toBe("<b>Sara</b> & Yossi");
  });
});

describe("AboutContent", () => {
  it("starts empty, so About.tsx shows only its built-in copy", () => {
    const about = new AboutContent();
    expect(about.isEmpty()).toBe(true);
    expect(about.toRecord()).toEqual({ heading: "", body: "", updatedAt: 0 });
  });

  it("persists through onChange when something actually changed", () => {
    const onChange = vi.fn();
    const about = new AboutContent(onChange);
    expect(about.set("Thanks", "To the testers")).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toMatchObject({ heading: "Thanks", body: "To the testers" });

    // Re-saving the form unchanged must not move updatedAt or rewrite the row.
    expect(about.set("Thanks", "To the testers")).toBe(false);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("normalizes on the way in, not just on the way out", () => {
    const about = new AboutContent();
    about.set("  Credits   ", "  line\r\nline  ");
    expect(about.toRecord()).toMatchObject({ heading: "Credits", body: "line\nline" });
  });

  it("clears back to empty and reports the change", () => {
    const about = new AboutContent();
    about.set("Credits", "body");
    expect(about.clear()).toBe(true);
    expect(about.isEmpty()).toBe(true);
    expect(about.clear()).toBe(false);
  });

  // A hand-edited settings row must not be able to put 200KB or a control
  // character onto a public page, so boot re-normalizes rather than trusts.
  it("re-normalizes on hydrate and does not write back what it just read", () => {
    const onChange = vi.fn();
    const about = new AboutContent(onChange);
    about.hydrate({ heading: "  Big  ", body: "z".repeat(20_000), updatedAt: 1234 });
    expect(onChange).not.toHaveBeenCalled();
    expect(about.toRecord().heading).toBe("Big");
    expect(about.toRecord().body).toHaveLength(ABOUT_MAX.body);
    expect(about.toRecord().updatedAt).toBe(1234);
  });

  it("survives a row that is missing, partial or garbage", () => {
    const about = new AboutContent();
    about.hydrate(undefined);
    about.hydrate(null);
    about.hydrate({});
    about.hydrate({ heading: 5 as unknown as string, updatedAt: NaN });
    expect(about.isEmpty()).toBe(true);
    expect(about.toRecord().updatedAt).toBe(0);
  });
});

describe("the About routes", () => {
  const originalToken = process.env.ADMIN_TOKEN;
  afterEach(() => {
    process.env.ADMIN_TOKEN = originalToken;
  });

  it("serves the record publicly, with no token and no auth", async () => {
    delete process.env.ADMIN_TOKEN;
    const about = new AboutContent();
    about.set("Beta testers", "Sara\n\nYossi");
    const app = createHttpServer(new GameStore(), { about });
    const res = await app.inject({ method: "GET", url: "/api/about" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ heading: "Beta testers", body: "Sara\n\nYossi" });
    expect(res.headers["cache-control"]).toBe("public, max-age=60");
  });

  it("serves an empty record rather than 404 when nothing is set", async () => {
    const app = createHttpServer(new GameStore());
    const res = await app.inject({ method: "GET", url: "/api/about" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ heading: "", body: "", updatedAt: 0 });
  });

  // The write side is admin-only. The public proxy is GET-only as well
  // (frontend/nginx.conf), so this is the second of two locks, not the first.
  it("refuses a write without the admin token", async () => {
    process.env.ADMIN_TOKEN = "correct-secret";
    const about = new AboutContent();
    const app = createHttpServer(new GameStore(), { about });
    const res = await app.inject({
      method: "POST",
      url: "/admin/about",
      payload: { heading: "Hacked", body: "Hacked" },
    });
    expect(res.statusCode).toBe(404);
    expect(about.isEmpty()).toBe(true);
  });

  it("writes with the admin token, and the public route shows it", async () => {
    process.env.ADMIN_TOKEN = "correct-secret";
    const about = new AboutContent();
    const app = createHttpServer(new GameStore(), { about });

    const post = await app.inject({
      method: "POST",
      url: "/admin/about?token=correct-secret",
      payload: { heading: "Beta testers", body: "Sara\r\nYossi" },
    });
    expect(post.statusCode).toBe(302);

    const get = await app.inject({ method: "GET", url: "/api/about" });
    expect(get.json()).toMatchObject({ heading: "Beta testers", body: "Sara\nYossi" });

    const clear = await app.inject({
      method: "POST",
      url: "/admin/about?token=correct-secret",
      payload: { clear: "1" },
    });
    expect(clear.statusCode).toBe(302);
    expect((await app.inject({ method: "GET", url: "/api/about" })).json()).toMatchObject({
      heading: "",
      body: "",
    });
  });

  it("shows the current copy on the panel and links to the editor", async () => {
    process.env.ADMIN_TOKEN = "correct-secret";
    const about = new AboutContent();
    about.set("Beta testers", "Sara and Yossi");
    const app = createHttpServer(new GameStore(), { about });
    const res = await app.inject({ method: "GET", url: "/admin?token=correct-secret" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Beta testers");
    expect(res.body).toContain("/admin/about");
  });

  // The whole point of the separate page. /admin carries a <meta refresh>,
  // which cannot be cancelled without script, so a 15-second reload eats
  // whatever is half-typed in a field. The editor must never carry one.
  it("serves the editor with no auto-refresh, unlike the panel", async () => {
    process.env.ADMIN_TOKEN = "correct-secret";
    const about = new AboutContent();
    about.set("Beta testers", "Sara and Yossi");
    const app = createHttpServer(new GameStore(), { about });

    const panel = await app.inject({ method: "GET", url: "/admin?token=correct-secret" });
    expect(panel.body, "the panel still refreshes -- that is deliberate").toContain("http-equiv=\"refresh\"");

    const editor = await app.inject({ method: "GET", url: "/admin/about?token=correct-secret" });
    expect(editor.statusCode).toBe(200);
    expect(editor.body).not.toContain("http-equiv=\"refresh\"");
    expect(editor.body).toContain("<textarea");
    expect(editor.body).toContain("Sara and Yossi");
  });

  it("keeps the editor behind the admin guard", async () => {
    process.env.ADMIN_TOKEN = "correct-secret";
    const app = createHttpServer(new GameStore(), { about: new AboutContent() });
    expect((await app.inject({ method: "GET", url: "/admin/about" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/admin/about?token=wrong" })).statusCode).toBe(404);
  });

  it("returns to the editor after a save, not to the panel", async () => {
    process.env.ADMIN_TOKEN = "correct-secret";
    const app = createHttpServer(new GameStore(), { about: new AboutContent() });
    const res = await app.inject({
      method: "POST",
      url: "/admin/about?token=correct-secret",
      payload: { heading: "Beta testers", body: "Sara" },
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain("/admin/about");
  });
});
