import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// What the browser can paint before the 147KB bundle has parsed.
//
// Two things depend on each other here and are easy to break separately: the
// theme stamp has to be an EXTERNAL script (the production CSP forbids inline
// ones), and the first-frame ground has to be an INLINE style (an external
// stylesheet would be another round trip and would defeat the point).

const HTML = readFileSync(resolve(__dirname, "../../index.html"), "utf8");
const INIT = readFileSync(resolve(__dirname, "../../public/theme-init.js"), "utf8");
const NGINX = readFileSync(resolve(__dirname, "../../nginx.conf"), "utf8");
const PAGE_THEME = readFileSync(resolve(__dirname, "../pageTheme.ts"), "utf8");

describe("the theme stamp", () => {
  it("is loaded as a file, because the CSP forbids inline scripts", () => {
    // The failure this prevents is the quiet kind: an inline script works
    // perfectly in `npm run dev`, which serves no CSP at all, and is blocked
    // in production -- so the flash it exists to remove comes back only for
    // real players.
    expect(HTML).toContain('<script src="/theme-init.js">');
    const head = HTML.slice(0, HTML.indexOf("</head>"));
    expect(/<script(?![^>]*\ssrc=)[^>]*>[\s\S]*?<\/script>/.test(head), "an inline <script> would be CSP-blocked in production").toBe(
      false
    );
  });

  it("runs before the stylesheet it is meant to beat", () => {
    // Vite injects the built stylesheet link during build, after this point;
    // in dev the styles arrive with the module graph. Either way the stamp has
    // to come first in the document.
    const scriptAt = HTML.indexOf('src="/theme-init.js"');
    const moduleAt = HTML.indexOf("/src/main.tsx");
    expect(scriptAt).toBeGreaterThan(-1);
    expect(scriptAt).toBeLessThan(moduleAt);
  });

  it("still lists script-src 'self' with no inline allowance", () => {
    // If this ever gains 'unsafe-inline' or a hash, the reasoning above is
    // void and the decision should be revisited deliberately, not inherited.
    expect(NGINX).toContain("script-src 'self';");
    expect(NGINX).not.toContain("script-src 'self' 'unsafe-inline'");
  });

  it("uses the same storage key and attribute the app does", () => {
    // Duplicated on purpose -- this runs before any module exists -- so the
    // duplication is pinned rather than trusted.
    expect(INIT).toContain('"kvitlach.pageTheme"');
    expect(PAGE_THEME).toContain('STORAGE_KEY = "kvitlach.pageTheme"');
    expect(INIT).toContain('"data-page-theme"');
    expect(PAGE_THEME).toContain('ATTRIBUTE = "data-page-theme"');
  });

  it("writes only an explicit choice, never a resolved one", () => {
    // Stamping a resolved "system" would freeze the reader's page at whatever
    // their device was on the first load that ran this.
    expect(INIT).toContain('saved === "dark" || saved === "light"');
    expect(INIT).not.toContain("prefers-color-scheme");
  });
});

describe("the first frame", () => {
  it("paints a ground for all three theme states with no stylesheet", () => {
    const style = HTML.slice(HTML.indexOf("<style>"), HTML.indexOf("</style>"));
    expect(style).toContain("html { background:");
    expect(style).toContain('html[data-page-theme="dark"] { background:');
    expect(style).toContain("prefers-color-scheme: dark");
    expect(style).toContain('html:not([data-page-theme="light"])');
  });

  it("gives #root something to show instead of nothing", () => {
    expect(HTML).toMatch(/<div id="root">\s*<div id="k-boot">/);
    expect(HTML).toContain("Kvitlach</div>");
  });

  it("depends on no font, no image and no script", () => {
    const style = HTML.slice(HTML.indexOf("<style>"), HTML.indexOf("</style>"));
    expect(style).toContain("Georgia");
    // Matched, not sliced to a literal: this file is checked out with CRLF on
    // Windows, so a slice bounded by "</div>\n" found nothing, ran to the end
    // of the document, and swept in the module script tag from <body> -- the
    // test failed for a reason that had nothing to do with the placeholder.
    const boot = HTML.match(/<div id="k-boot">[\s\S]*?<\/div>\s*<\/div>/)?.[0] ?? "";
    expect(boot, "the #k-boot block was not found").toContain("k-boot-word");
    expect(boot).not.toContain("<img");
    expect(boot).not.toContain("<script");
  });
});
