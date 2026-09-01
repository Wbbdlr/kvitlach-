import { describe, expect, it } from "vitest";
import { AdminAuth, adminAuthFromEnv, hashPassword, verifyPassword } from "../admin-auth.js";

// This is the only thing standing between the open port and every control on
// the admin page, so the failure modes worth pinning are the silent ones: a
// session that verifies when it should not, and a panel that thinks it is
// protected when nothing is configured.

const creds = (over: Partial<{ username: string; password: string; secret: string }> = {}) =>
  new AdminAuth({
    username: "shloime",
    password: hashPassword("correct horse"),
    secret: "test-secret",
    ...over,
  });

describe("password hashing", () => {
  it("round-trips a password", () => {
    const stored = hashPassword("correct horse");
    expect(verifyPassword(stored, "correct horse")).toBe(true);
    expect(verifyPassword(stored, "correct horse ")).toBe(false);
  });

  it("salts, so the same password hashes differently every time", () => {
    expect(hashPassword("same")).not.toBe(hashPassword("same"));
  });

  it("rejects a malformed stored hash instead of throwing", () => {
    expect(verifyPassword("scrypt$", "anything")).toBe(false);
    expect(verifyPassword("scrypt$onlysalt", "anything")).toBe(false);
    expect(verifyPassword("", "anything")).toBe(false);
  });

  // deploy/setup-admin.sh writes ':' separators because Docker Compose
  // interpolates '$' in .env -- a '$'-delimited hash reaches the backend as the
  // bare word "scrypt" and every login fails against the correct password.
  // This is not a theoretical case; it shipped, and cost an evening.
  it("accepts a colon-separated hash exactly as it does a dollar one", () => {
    const dollars = hashPassword("correct horse");
    const colons = dollars.replace(/\$/g, ":");
    expect(colons).not.toContain("$");
    expect(verifyPassword(colons, "correct horse")).toBe(true);
    expect(verifyPassword(colons, "wrong horse")).toBe(false);
    expect(verifyPassword("scrypt:onlysalt", "anything")).toBe(false);
  });

  // What Compose actually leaves behind after eating the separators.
  it("rejects the hash Compose interpolation leaves behind", () => {
    expect(verifyPassword("scrypt", "correct horse")).toBe(false);
  });

  // Documented, warned about at boot, and supported so the panel is usable
  // before anyone has run the hashing script.
  it("accepts a plaintext stored password", () => {
    expect(verifyPassword("plain", "plain")).toBe(true);
    expect(verifyPassword("plain", "Plain")).toBe(false);
  });
});

describe("AdminAuth", () => {
  it("is disabled when no credentials are configured", () => {
    const auth = new AdminAuth();
    expect(auth.enabled).toBe(false);
    expect(auth.login("shloime", "correct horse")).toBeUndefined();
    expect(auth.verifySession("kvitlach_admin=anything")).toBe(false);
  });

  it("is disabled when half-configured", () => {
    expect(new AdminAuth({ username: "a", password: "", secret: "s" }).enabled).toBe(false);
    expect(new AdminAuth({ username: "", password: "b", secret: "s" }).enabled).toBe(false);
  });

  it("issues a session for the right credentials and refuses the wrong ones", () => {
    const auth = creds();
    expect(auth.login("shloime", "wrong")).toBeUndefined();
    expect(auth.login("someone", "correct horse")).toBeUndefined();
    const session = auth.login("shloime", "correct horse");
    expect(session).toBeTruthy();
    expect(auth.verifySession(`kvitlach_admin=${session}`)).toBe(true);
  });

  it("accepts the username case-insensitively, since it gets typed by hand", () => {
    expect(creds().login("ShLoiMe", "correct horse")).toBeTruthy();
  });

  // The cookie is only an expiry plus its HMAC, so a forged or edited one has
  // to fail on the signature. If this ever passes, the panel is wide open.
  it("rejects a tampered or unsigned cookie", () => {
    const auth = creds();
    const session = auth.login("shloime", "correct horse")!;
    const [payload, signature] = session.split(".");
    expect(auth.verifySession(`kvitlach_admin=${payload}.${"0".repeat(signature.length)}`)).toBe(false);
    expect(auth.verifySession(`kvitlach_admin=${Number(payload) + 60_000}.${signature}`)).toBe(false);
    expect(auth.verifySession(`kvitlach_admin=${payload}`)).toBe(false);
    expect(auth.verifySession("")).toBe(false);
    expect(auth.verifySession(undefined)).toBe(false);
  });

  it("rejects an expired cookie even though it is correctly signed", () => {
    const auth = creds();
    // Reach past the API on purpose: there is no way to mint a stale session
    // through login(), and faking the clock would not prove the check exists.
    const expired = String(Date.now() - 1000);
    const signed = (auth as unknown as { sign: (p: string) => string }).sign(expired);
    expect(auth.verifySession(`kvitlach_admin=${expired}.${signed}`)).toBe(false);
  });

  it("does not honour a session signed with a different secret", () => {
    const session = creds().login("shloime", "correct horse")!;
    expect(creds({ secret: "other-secret" }).verifySession(`kvitlach_admin=${session}`)).toBe(false);
  });

  it("picks its cookie out of a header full of other cookies", () => {
    const auth = creds();
    const session = auth.login("shloime", "correct horse")!;
    expect(auth.verifySession(`ab=1; kvitlach_admin=${session}; zz=2`)).toBe(true);
    expect(auth.verifySession(`not_kvitlach_admin=${session}`)).toBe(false);
  });

  // Over the tailnet this is plain http; a Secure cookie would be dropped and
  // lock the panel out entirely.
  it("sets HttpOnly and SameSite=Strict but not Secure", () => {
    const header = creds().cookieHeader("x");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Strict");
    expect(header).not.toContain("Secure");
  });
});

describe("adminAuthFromEnv", () => {
  it("stays disabled with nothing set", () => {
    expect(adminAuthFromEnv({}).enabled).toBe(false);
  });

  it("prefers the hash over a plaintext password", () => {
    const auth = adminAuthFromEnv({
      ADMIN_USERNAME: "Shloime",
      ADMIN_PASSWORD_HASH: hashPassword("hashed one"),
      ADMIN_PASSWORD: "plaintext one",
      ADMIN_SESSION_SECRET: "s",
    } as NodeJS.ProcessEnv);
    expect(auth.login("shloime", "hashed one")).toBeTruthy();
    expect(auth.login("shloime", "plaintext one")).toBeUndefined();
  });
});
