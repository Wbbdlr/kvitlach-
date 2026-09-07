import { afterEach, describe, expect, it, vi } from "vitest";
import { CONTACT_MAX, ContactContent, normalizeContactText } from "../contact.js";
import { createHttpServer } from "../http-server.js";
import { GameStore } from "../store.js";

// Mirrors about.test.ts almost line for line -- ContactContent is the exact
// same shape as AboutContent, on purpose (see contact.ts's own comment).

describe("normalizeContactText", () => {
  it("keeps the only formatting this field has", () => {
    expect(normalizeContactText("Closed for the holiday\n\n- back Sunday", CONTACT_MAX.body)).toBe(
      "Closed for the holiday\n\n- back Sunday"
    );
    expect(normalizeContactText("a\tb", CONTACT_MAX.body)).toBe("a\tb");
  });

  it("collapses CRLF so a Windows paste does not double every break", () => {
    expect(normalizeContactText("one\r\n\r\ntwo\rthree", CONTACT_MAX.body)).toBe("one\n\ntwo\nthree");
  });

  it("strips control characters a terminal paste carries", () => {
    const esc = String.fromCharCode(0x1b);
    const nul = String.fromCharCode(0);
    expect(normalizeContactText(`Sara${esc}[31m${nul} Yossi`, CONTACT_MAX.body)).toBe("Sara[31m Yossi");
  });

  it("trims and bounds", () => {
    expect(normalizeContactText("   padded   ", CONTACT_MAX.body)).toBe("padded");
    expect(normalizeContactText("x".repeat(9000), CONTACT_MAX.body)).toHaveLength(CONTACT_MAX.body);
    expect(normalizeContactText("y".repeat(400), CONTACT_MAX.heading)).toHaveLength(CONTACT_MAX.heading);
  });

  it("returns empty for anything that is not a string", () => {
    for (const bad of [null, undefined, 42, {}, [], true]) {
      expect(normalizeContactText(bad, CONTACT_MAX.body)).toBe("");
    }
  });

  it("does not escape HTML", () => {
    expect(normalizeContactText("<b>Sara</b> & Yossi", CONTACT_MAX.body)).toBe("<b>Sara</b> & Yossi");
  });
});

describe("ContactContent", () => {
  it("starts empty, so Contact.tsx shows only its built-in copy", () => {
    const contact = new ContactContent();
    expect(contact.isEmpty()).toBe(true);
    expect(contact.toRecord()).toEqual({ heading: "", body: "", updatedAt: 0 });
  });

  it("persists through onChange when something actually changed", () => {
    const onChange = vi.fn();
    const contact = new ContactContent(onChange);
    expect(contact.set("Holiday hours", "Closed through Sunday")).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toMatchObject({ heading: "Holiday hours", body: "Closed through Sunday" });

    expect(contact.set("Holiday hours", "Closed through Sunday")).toBe(false);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("normalizes on the way in, not just on the way out", () => {
    const contact = new ContactContent();
    contact.set("  Hours   ", "  line\r\nline  ");
    expect(contact.toRecord()).toMatchObject({ heading: "Hours", body: "line\nline" });
  });

  it("clears back to empty and reports the change", () => {
    const contact = new ContactContent();
    contact.set("Hours", "body");
    expect(contact.clear()).toBe(true);
    expect(contact.isEmpty()).toBe(true);
    expect(contact.clear()).toBe(false);
  });

  it("re-normalizes on hydrate and does not write back what it just read", () => {
    const onChange = vi.fn();
    const contact = new ContactContent(onChange);
    contact.hydrate({ heading: "  Big  ", body: "z".repeat(20_000), updatedAt: 1234 });
    expect(onChange).not.toHaveBeenCalled();
    expect(contact.toRecord().heading).toBe("Big");
    expect(contact.toRecord().body).toHaveLength(CONTACT_MAX.body);
    expect(contact.toRecord().updatedAt).toBe(1234);
  });

  it("survives a row that is missing, partial or garbage", () => {
    const contact = new ContactContent();
    contact.hydrate(undefined);
    contact.hydrate(null);
    contact.hydrate({});
    contact.hydrate({ heading: 5 as unknown as string, updatedAt: NaN });
    expect(contact.isEmpty()).toBe(true);
    expect(contact.toRecord().updatedAt).toBe(0);
  });
});

describe("the Contact routes", () => {
  const originalToken = process.env.ADMIN_TOKEN;
  afterEach(() => {
    process.env.ADMIN_TOKEN = originalToken;
  });

  it("serves the record publicly, with no token and no auth", async () => {
    delete process.env.ADMIN_TOKEN;
    const contact = new ContactContent();
    contact.set("Holiday hours", "Closed\n\nBack Sunday");
    const app = createHttpServer(new GameStore(), { contact });
    const res = await app.inject({ method: "GET", url: "/api/contact" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ heading: "Holiday hours", body: "Closed\n\nBack Sunday" });
    expect(res.headers["cache-control"]).toBe("public, max-age=60");
  });

  it("serves an empty record rather than 404 when nothing is set", async () => {
    const app = createHttpServer(new GameStore());
    const res = await app.inject({ method: "GET", url: "/api/contact" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ heading: "", body: "", updatedAt: 0 });
  });

  it("refuses a write without the admin token", async () => {
    process.env.ADMIN_TOKEN = "correct-secret";
    const contact = new ContactContent();
    const app = createHttpServer(new GameStore(), { contact });
    const res = await app.inject({
      method: "POST",
      url: "/admin/contact",
      payload: { heading: "Hacked", body: "Hacked" },
    });
    expect(res.statusCode).toBe(404);
    expect(contact.isEmpty()).toBe(true);
  });

  it("writes with the admin token, and the public route shows it", async () => {
    process.env.ADMIN_TOKEN = "correct-secret";
    const contact = new ContactContent();
    const app = createHttpServer(new GameStore(), { contact });

    const post = await app.inject({
      method: "POST",
      url: "/admin/contact?token=correct-secret",
      payload: { heading: "Holiday hours", body: "Closed\r\nBack Sunday" },
    });
    expect(post.statusCode).toBe(302);

    const get = await app.inject({ method: "GET", url: "/api/contact" });
    expect(get.json()).toMatchObject({ heading: "Holiday hours", body: "Closed\nBack Sunday" });

    const clear = await app.inject({
      method: "POST",
      url: "/admin/contact?token=correct-secret",
      payload: { clear: "1" },
    });
    expect(clear.statusCode).toBe(302);
    expect((await app.inject({ method: "GET", url: "/api/contact" })).json()).toMatchObject({
      heading: "",
      body: "",
    });
  });

  it("shows the current copy on the panel and links to the editor", async () => {
    process.env.ADMIN_TOKEN = "correct-secret";
    const contact = new ContactContent();
    contact.set("Holiday hours", "Closed through Sunday");
    const app = createHttpServer(new GameStore(), { contact });
    const res = await app.inject({ method: "GET", url: "/admin?token=correct-secret" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Holiday hours");
    expect(res.body).toContain("/admin/contact");
  });

  it("serves the editor with no auto-refresh, unlike the panel", async () => {
    process.env.ADMIN_TOKEN = "correct-secret";
    const contact = new ContactContent();
    contact.set("Holiday hours", "Closed through Sunday");
    const app = createHttpServer(new GameStore(), { contact });

    const editor = await app.inject({ method: "GET", url: "/admin/contact?token=correct-secret" });
    expect(editor.statusCode).toBe(200);
    expect(editor.body).not.toContain('http-equiv="refresh"');
    expect(editor.body).toContain("<textarea");
    expect(editor.body).toContain("Closed through Sunday");
  });

  it("keeps the editor behind the admin guard", async () => {
    process.env.ADMIN_TOKEN = "correct-secret";
    const app = createHttpServer(new GameStore(), { contact: new ContactContent() });
    expect((await app.inject({ method: "GET", url: "/admin/contact" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/admin/contact?token=wrong" })).statusCode).toBe(404);
  });

  it("returns to the editor after a save, not to the panel", async () => {
    process.env.ADMIN_TOKEN = "correct-secret";
    const app = createHttpServer(new GameStore(), { contact: new ContactContent() });
    const res = await app.inject({
      method: "POST",
      url: "/admin/contact?token=correct-secret",
      payload: { heading: "Holiday hours", body: "Closed" },
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain("/admin/contact");
  });
});
