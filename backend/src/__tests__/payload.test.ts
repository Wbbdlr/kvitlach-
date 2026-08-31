import { describe, expect, it } from "vitest";
import { validatePayload } from "../payload.js";

describe("validatePayload", () => {
  it("passes ordinary scalar payloads straight through", () => {
    const p = { roomId: "ABC123", amount: 25, bank: true, lastName: "", note: null };
    expect(validatePayload(p)).toBe(p);
  });

  it("treats a missing payload as an empty one", () => {
    expect(validatePayload(undefined)).toEqual({});
    expect(validatePayload(null)).toEqual({});
  });

  // The actual bug class this exists for: `{}` and `[]` are TRUTHY, so every
  // `if (!firstName) throw` guard in ws-server.ts waved them through, and
  // store.ts's sanitizeName then called .trim() on them.
  it.each([
    ["an object", { firstName: { evil: true } }],
    ["an array", { firstName: ["a", "b"] }],
    ["a nested payload", { player: { id: "x" } }],
  ])("rejects %s where a scalar is expected", (_label, p) => {
    expect(() => validatePayload(p)).toThrow("invalid_payload");
  });

  // These survive `typeof x === "number"` downstream and poison wallets on
  // the first arithmetic.
  it.each([
    ["NaN", { amount: NaN }],
    ["Infinity", { amount: Infinity }],
    ["-Infinity", { buyIn: -Infinity }],
  ])("rejects %s", (_label, p) => {
    expect(() => validatePayload(p)).toThrow("invalid_payload");
  });

  it("rejects an unbounded string before it can reach a hash or the database", () => {
    expect(() => validatePayload({ password: "x".repeat(2001) })).toThrow("invalid_payload");
    expect(() => validatePayload({ password: "x".repeat(2000) })).not.toThrow();
  });

  it("rejects a payload that isn't an object at all", () => {
    expect(() => validatePayload("room:create")).toThrow("invalid_payload");
    expect(() => validatePayload([1, 2, 3])).toThrow("invalid_payload");
  });

  it("allows explicit null/undefined fields, which optional args rely on", () => {
    expect(() => validatePayload({ lastName: undefined, password: null })).not.toThrow();
  });
});
