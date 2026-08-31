import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// The install prompt is all-or-nothing and fails silently: a manifest missing
// one required field, or naming an icon file that isn't in public/, simply
// means no phone ever offers to install the app -- with no console error and
// nothing visibly wrong on the site. Renaming or moving an icon is exactly the
// kind of routine change that would break it unnoticed, so pin it here.
const publicDir = resolve(__dirname, "../public");
const manifest = JSON.parse(readFileSync(resolve(publicDir, "manifest.json"), "utf8"));

describe("web app manifest", () => {
  it("declares the fields browsers require to offer an install", () => {
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("ships a 192px and a 512px icon, plus a maskable one for Android", () => {
    const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    expect(
      manifest.icons.some((i: { purpose?: string }) => i.purpose === "maskable")
    ).toBe(true);
  });

  it("points every icon at a file that exists", () => {
    for (const icon of manifest.icons as Array<{ src: string }>) {
      expect(existsSync(resolve(publicDir, icon.src.replace(/^\//, "")))).toBe(true);
    }
  });

  it("keeps index.html wired to the manifest and an apple-touch-icon", () => {
    const html = readFileSync(resolve(__dirname, "../index.html"), "utf8");
    expect(html).toContain('rel="manifest"');
    const appleIcon = html.match(/rel="apple-touch-icon"[^>]*href="([^"]+)"/)?.[1];
    expect(appleIcon).toBeTruthy();
    expect(existsSync(resolve(publicDir, appleIcon!.replace(/^\//, "")))).toBe(true);
  });

  it("precaches only files the service worker can actually fetch", () => {
    const sw = readFileSync(resolve(publicDir, "sw.js"), "utf8");
    const precache = sw.match(/const PRECACHE = \[([^\]]*)\]/)?.[1];
    expect(precache).toBeTruthy();
    for (const path of precache!.match(/"([^"]+)"/g) ?? []) {
      expect(existsSync(resolve(publicDir, path.replace(/"/g, "").replace(/^\//, "")))).toBe(true);
    }
  });
});
