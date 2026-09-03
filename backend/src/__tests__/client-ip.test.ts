import { describe, it, expect } from "vitest";
import { resolveClientIp } from "../client-ip.js";

// Regression coverage for a real finding from a security pass: both the WS
// per-IP connection cap and the admin-login brute-force throttle keyed off
// X-Forwarded-For's FIRST entry, which is exactly the value a CLIENT can set
// -- Cloudflare's edge appends the true IP to whatever chain arrives rather
// than replacing it. CF-Connecting-IP is the fix: Cloudflare's edge sets it
// itself, from the connection it terminated, and overwrites it on every
// request regardless of what a client sent for that header name.

describe("resolveClientIp -- CF-Connecting-IP first, spoofable headers last", () => {
  it("prefers cf-connecting-ip over x-forwarded-for, even when both are present", () => {
    // The exact spoof this fixes: an attacker's own X-Forwarded-For sitting
    // alongside the header Cloudflare's edge set honestly.
    const ip = resolveClientIp({
      "cf-connecting-ip": "203.0.113.9",
      "x-forwarded-for": "10.0.0.1, 203.0.113.9",
    });
    expect(ip).toBe("203.0.113.9");
  });

  it("falls back to x-forwarded-for's first entry when there is no cf-connecting-ip", () => {
    // The path that bypasses Cloudflare (local dev, a direct Tailscale
    // connection) -- there is nothing better to key on there.
    const ip = resolveClientIp({ "x-forwarded-for": "198.51.100.5, 10.0.0.1" });
    expect(ip).toBe("198.51.100.5");
  });

  it("falls back to the raw socket address when neither header is present", () => {
    const ip = resolveClientIp({}, "127.0.0.1");
    expect(ip).toBe("127.0.0.1");
  });

  it("returns 'unknown' rather than throwing when nothing at all is available", () => {
    expect(resolveClientIp({})).toBe("unknown");
  });

  it("handles a header arriving as an array the same as a string", () => {
    const ip = resolveClientIp({ "cf-connecting-ip": ["203.0.113.9", "203.0.113.10"] });
    expect(ip).toBe("203.0.113.9");
  });

  it("trims whitespace around the resolved address", () => {
    expect(resolveClientIp({ "cf-connecting-ip": "  203.0.113.9  " })).toBe("203.0.113.9");
    expect(resolveClientIp({ "x-forwarded-for": " 198.51.100.5 , 10.0.0.1" })).toBe("198.51.100.5");
  });
});
