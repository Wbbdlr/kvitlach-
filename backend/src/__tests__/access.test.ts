import { describe, expect, it, vi } from "vitest";
import { AccessControl, accessFromEnv, isAccessMode, normalizeCode, parseCodeList } from "../access.js";

function invite(codes: string[]): AccessControl {
  const a = new AccessControl();
  a.setCodes(codes);
  a.setMode("invite");
  return a;
}

describe("AccessControl", () => {
  it("lets everything through in open mode", () => {
    const a = new AccessControl();
    expect(a.getMode()).toBe("open");
    for (const action of ["create", "join", "practice"] as const) {
      expect(() => a.assertAllowed(action)).not.toThrow();
    }
  });

  it("refuses all three actions in closed mode, code or no code", () => {
    const a = invite(["shabbos"]);
    a.setMode("closed");
    for (const action of ["create", "join", "practice"] as const) {
      expect(() => a.assertAllowed(action)).toThrow("locked_down");
      expect(() => a.assertAllowed(action, "shabbos")).toThrow("locked_down");
    }
  });

  // The three actions the user asked to gate. Practice rooms are included
  // deliberately: they are cheap per-room but they are the one thing a
  // stranger can spin up with no Game ID at all, so they are exactly what an
  // invite-only platform has to stop.
  it("gates create, join AND practice behind a code in invite mode", () => {
    const a = invite(["shabbos"]);
    for (const action of ["create", "join", "practice"] as const) {
      expect(() => a.assertAllowed(action)).toThrow("invite_required");
      expect(() => a.assertAllowed(action, "nope")).toThrow("invalid_invite");
      expect(() => a.assertAllowed(action, "shabbos")).not.toThrow();
    }
  });

  it("distinguishes no-code-given from wrong-code-given", () => {
    const a = invite(["shabbos"]);
    expect(() => a.assertAllowed("join", "   ")).toThrow("invite_required");
    expect(() => a.assertAllowed("join", "")).toThrow("invite_required");
    expect(() => a.assertAllowed("join", undefined)).toThrow("invite_required");
    expect(() => a.assertAllowed("join", "wrong")).toThrow("invalid_invite");
  });

  // These get read down a phone line and typed by hand.
  it("matches codes case-insensitively and ignores surrounding space", () => {
    const a = invite(["Shabbos"]);
    expect(() => a.assertAllowed("join", "  SHABBOS ")).not.toThrow();
    expect(() => a.assertAllowed("join", "shabbos")).not.toThrow();
  });

  it("accepts any of several codes", () => {
    const a = invite(["one", "two", "three"]);
    for (const c of ["one", "two", "three"]) expect(() => a.assertAllowed("create", c)).not.toThrow();
    expect(() => a.assertAllowed("create", "four")).toThrow("invalid_invite");
  });

  it("never treats an empty code list as open", () => {
    const a = new AccessControl();
    a.setMode("invite");
    expect(() => a.assertAllowed("create", "anything")).toThrow("invalid_invite");
    expect(() => a.assertAllowed("create")).toThrow("invite_required");
  });

  it("keeps codes out of the snapshot", () => {
    const a = invite(["secret-code"]);
    const snap = a.snapshot();
    expect(snap.mode).toBe("invite");
    expect(snap.codeCount).toBe(1);
    expect(JSON.stringify(snap)).not.toContain("secret-code");
  });

  it("de-duplicates and normalises on setCodes", () => {
    const a = new AccessControl();
    a.setCodes([" Alpha ", "alpha", "ALPHA", "beta", ""]);
    expect(a.snapshot().codeCount).toBe(2);
  });

  it("notifies the persistence callback on every change, but not on hydrate", () => {
    const onChange = vi.fn();
    const a = new AccessControl(onChange);
    a.hydrate({ mode: "invite", codes: ["x"], updatedAt: 1 });
    expect(onChange).not.toHaveBeenCalled();
    a.setMode("closed");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toMatchObject({ mode: "closed" });
    a.setCodes(["y"]);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("round-trips through toRecord/hydrate", () => {
    const a = invite(["one", "two"]);
    const b = new AccessControl();
    b.hydrate(a.toRecord());
    expect(b.getMode()).toBe("invite");
    expect(() => b.assertAllowed("join", "two")).not.toThrow();
  });

  it("ignores junk from storage rather than throwing at boot", () => {
    const a = new AccessControl();
    a.hydrate({ mode: "nonsense" as never, codes: "not-an-array" as never });
    expect(a.getMode()).toBe("open");
    a.hydrate(undefined);
    expect(a.getMode()).toBe("open");
  });
});

describe("accessFromEnv", () => {
  it("defaults to open", () => {
    expect(accessFromEnv({} as NodeJS.ProcessEnv).mode).toBe("open");
  });

  // The lever that already exists on the server must not become a no-op.
  it("still honours MAINTENANCE_MODE=true, as closed", () => {
    expect(accessFromEnv({ MAINTENANCE_MODE: "true" } as NodeJS.ProcessEnv).mode).toBe("closed");
  });

  it("lets ACCESS_MODE win over MAINTENANCE_MODE", () => {
    const env = { MAINTENANCE_MODE: "true", ACCESS_MODE: "invite" } as unknown as NodeJS.ProcessEnv;
    expect(accessFromEnv(env).mode).toBe("invite");
  });

  it("reads a comma- or newline-separated code list", () => {
    const env = { ACCESS_CODES: "one, two\nthree" } as unknown as NodeJS.ProcessEnv;
    expect(accessFromEnv(env).codes).toEqual(["one", "two", "three"]);
  });
});

describe("helpers", () => {
  it("isAccessMode accepts exactly the three modes", () => {
    expect(["open", "invite", "closed"].every(isAccessMode)).toBe(true);
    expect(isAccessMode("Open")).toBe(false);
    expect(isAccessMode(undefined)).toBe(false);
  });

  it("normalizeCode returns empty for non-strings", () => {
    expect(normalizeCode(42)).toBe("");
    expect(normalizeCode(null)).toBe("");
  });

  it("parseCodeList drops blanks and over-long entries", () => {
    expect(parseCodeList("a,,  ,b")).toEqual(["a", "b"]);
    expect(parseCodeList("x".repeat(65))).toEqual([]);
    expect(parseCodeList(undefined)).toEqual([]);
  });
});
