import { describe, expect, it } from "vitest";

// Which paths count as real. The list is short and the cost of getting it
// wrong is asymmetric: a false NEGATIVE just shows the lobby (today's
// behaviour), while a false POSITIVE puts a not-found page in front of
// somebody holding a perfectly good table link.
//
// The regex is restated here rather than exported, deliberately: NotFound.ts
// reads window.location at module load, so importing it would bind the answer
// to whatever jsdom's URL happened to be at import time. This pins the SHAPE,
// which is the part that can be got wrong.
const KNOWN_PATH_RE = /^\/(?:table\/[^/]+\/?|m\/[^/]+\/?|about|disclaimer|contact|privacy|terms)?\/?$/;

describe("paths the app actually serves", () => {
  it("accepts the front page and a family link", () => {
    for (const path of ["/", "/m/dov", "/m/dov/", "/m/rosenblum-katz"]) {
      expect(KNOWN_PATH_RE.test(path), path).toBe(true);
    }
  });

  it("accepts a table link in the shapes state.ts parses", () => {
    for (const path of ["/table/ABC123", "/table/ABC123/", "/table/a-custom-id"]) {
      expect(KNOWN_PATH_RE.test(path), path).toBe(true);
    }
  });

  it("rejects a typo, which is the whole point", () => {
    for (const path of ["/abuot", "/tabel/ABC123", "/table", "/m", "/m/", "/table/A/B", "/m/dov/extra"]) {
      expect(KNOWN_PATH_RE.test(path), path).toBe(false);
    }
  });

  it("treats the info pages as real, even though they never reach here", () => {
    // router.tsx matches them first, so this is belt and braces -- but the
    // failure it guards against is a not-found page in front of the legal
    // pages, and redundancy costs nothing.
    for (const path of ["/about", "/privacy", "/terms", "/contact", "/disclaimer"]) {
      expect(KNOWN_PATH_RE.test(path), `${path} would 404 if it ever hit the catch-all`).toBe(true);
    }
  });
});
