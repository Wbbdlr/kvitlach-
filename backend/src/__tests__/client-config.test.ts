import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHttpServer } from "../http-server.js";
import { GameStore } from "../store.js";
import { AdminAuth, hashPassword } from "../admin-auth.js";
import type { ClientConfigRecord } from "../client-config.js";
import {
  CARD_EFFECT_BOUNDS,
  CARD_EFFECT_DEFAULTS,
  ClientConfig,
  normalizeCardEffects,
  normalizeHexColor,
} from "../client-config.js";

// The first channel by which this server tells a browser anything about how the
// game should LOOK. Two things are worth pinning: that the values survive the
// round trip at all (the whole point -- a control that saves a colour the game
// does not use is the failure this feature was written to avoid), and that the
// public endpoint stays public-safe.

const PORT = 39771;
const store = new GameStore();
const clientConfig = new ClientConfig();
const app = createHttpServer(store, {
  auth: new AdminAuth({ username: "admin", password: hashPassword("pw"), secret: "secret" }),
  clientConfig,
});
const base = `http://127.0.0.1:${PORT}`;
let cookie = "";

const save = (fields: Record<string, string>) =>
  fetch(`${base}/admin/card-effects`, {
    method: "POST",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
    redirect: "manual",
  });

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

describe("normalizing a colour", () => {
  // The strict end of this is the point. The value is written into a CSS custom
  // property on the player's page, and a custom property is not parsed until it
  // is substituted -- so anything that gets through here can author CSS on every
  // table.
  it("refuses everything that is not a hex colour", () => {
    for (const junk of [
      "red",
      "rgb(1,2,3)",
      "var(--x)",
      "#e6a44b; background: url(http://evil)",
      "#gggggg",
      "#e6a44b7",
      "",
      42,
      null,
      undefined,
      { toString: () => "#e6a44b" },
    ]) {
      expect(normalizeHexColor(junk, "#000000")).toBe("#000000");
    }
  });

  it("takes the two forms a person actually types", () => {
    expect(normalizeHexColor("#E6A44B", "#000000")).toBe("#e6a44b");
    expect(normalizeHexColor("  #abc  ", "#000000")).toBe("#aabbcc");
  });
});

describe("normalizing the effects record", () => {
  it("clamps to the bounds rather than trusting the number", () => {
    const fx = normalizeCardEffects({ winScalePeak: 99, futchScale: 0.01, futchSaturate: -5 });
    expect(fx.winScalePeak).toBe(CARD_EFFECT_BOUNDS.winScalePeak[1]);
    expect(fx.futchScale).toBe(CARD_EFFECT_BOUNDS.futchScale[0]);
    expect(fx.futchSaturate).toBe(CARD_EFFECT_BOUNDS.futchSaturate[0]);
  });

  it("keeps the good fields when one is unusable", () => {
    // A form that discards five valid edits because the sixth box was empty is
    // worse to operate than one that shows you what it kept.
    const fx = normalizeCardEffects({ winColor: "not a colour", futchColor: "#123456" });
    expect(fx.winColor).toBe(CARD_EFFECT_DEFAULTS.winColor);
    expect(fx.futchColor).toBe("#123456");
  });

  it("will not let the settle land above the peak", () => {
    // Grow-then-settle inverted into shrink-then-grow does not read as a
    // flourish, it reads as a rendering fault.
    const fx = normalizeCardEffects({ winScalePeak: 1.03, winScaleRest: 1.1 });
    expect(fx.winScalePeak).toBeGreaterThanOrEqual(fx.winScaleRest);
  });

  it("cannot be dragged to no visible difference", () => {
    // Every extreme the form can reach, at once. These animations are the only
    // non-textual signal that a hand won or busted.
    const fx = normalizeCardEffects({ winScalePeak: 1, winScaleRest: 1, futchScale: 1, futchSaturate: 1 });
    expect(fx.winScalePeak).toBeGreaterThan(1);
    expect(fx.futchScale).toBeLessThan(1);
    expect(fx.futchSaturate).toBeLessThan(1);
  });
});

describe("the public config endpoint", () => {
  it("serves the shipped defaults to a client with no session", async () => {
    const res = await fetch(`${base}/api/config`);
    expect(res.status).toBe(200);
    const doc = (await res.json()) as ClientConfigRecord;
    expect(doc.cardEffects).toEqual(CARD_EFFECT_DEFAULTS);
  });

  it("carries nothing operator-private", async () => {
    // This is reachable by anyone through nginx. If a field would interest
    // somebody attacking the server, it belongs behind the admin session.
    const body = await (await fetch(`${base}/api/config`)).text();
    for (const leak of ["code", "password", "maxRooms", "limit", "token", "ip"]) {
      expect(body.toLowerCase()).not.toContain(leak.toLowerCase());
    }
    expect(Object.keys(JSON.parse(body)).sort()).toEqual(["cardEffects", "updatedAt"]);
  });

  it("reflects a save, which is the whole point of the channel", async () => {
    const res = await save({
      winColor: "#33ff99",
      winScalePeak: "1.15",
      winScaleRest: "1.05",
      futchColor: "#4400aa",
      futchScale: "0.9",
      futchSaturate: "0.2",
    });
    expect(res.status).toBe(302);

    const doc = (await (await fetch(`${base}/api/config`)).json()) as ClientConfigRecord;
    expect(doc.cardEffects).toEqual({
      winColor: "#33ff99",
      winScalePeak: 1.15,
      winScaleRest: 1.05,
      futchColor: "#4400aa",
      futchScale: 0.9,
      futchSaturate: 0.2,
    });
    expect(doc.updatedAt).toBeGreaterThan(0);
  });

  it("shows the saved colours back on the editor, not the form's guess at them", async () => {
    const html = await (await fetch(`${base}/admin/card-effects`, { headers: { cookie } })).text();
    expect(html).toContain('value="#33ff99"');
    // The swatch is drawn from the saved record as an rgb triplet -- if this
    // ever stops matching, the page is previewing something players do not see.
    expect(html).toContain("51, 255, 153");
  });

  it("resets to the shipped look", async () => {
    expect((await save({ reset: "1" })).status).toBe(302);
    expect(clientConfig.isDefault()).toBe(true);
    const doc = (await (await fetch(`${base}/api/config`)).json()) as ClientConfigRecord;
    expect(doc.cardEffects).toEqual(CARD_EFFECT_DEFAULTS);
  });

  it("keeps the editor behind the admin session", async () => {
    const page = await fetch(`${base}/admin/card-effects`, { redirect: "manual" });
    expect([401, 404]).toContain(page.status);

    const post = await fetch(`${base}/admin/card-effects`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ winColor: "#000000" }),
      redirect: "manual",
    });
    expect([401, 404]).toContain(post.status);
    expect(clientConfig.isDefault()).toBe(true);
  });
});
