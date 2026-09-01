import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// Username/password for the admin page, so it can be reached from another
// machine on the tailnet instead of only from a browser on the server itself.
//
// The query-string token it replaces was fine while the page was bound to
// 127.0.0.1: nothing else could see the URL. Once the port is reachable from
// other hosts, a token in the URL is a token in every proxy log, browser
// history entry and Referer header, and it is pasted by hand every time. A
// POSTed password and a session cookie leak far less.
//
// No new dependencies -- scrypt, HMAC and timingSafeEqual are all in node's
// crypto. bcrypt/argon2 would be better against an offline attack on a stolen
// hash, but the hash lives in a .env file on a single-tenant box; if that is
// readable the game is already over, and a native dependency is a real cost
// on a machine where BuildKit is already disabled.

const SESSION_COOKIE = "kvitlach_admin";
const SESSION_TTL_MS = 12 * 60 * 60_000; // a working day; re-login is cheap
const SCRYPT_KEYLEN = 32;

export interface AdminCredentials {
  username: string;
  /** `scrypt$<salt-hex>$<hash-hex>`, or a bare password (dev only). */
  password: string;
  /** Signs session cookies. Regenerated per boot when unset, which logs everyone out on restart. */
  secret: string;
}

export function hashPassword(password: string, salt = randomBytes(16).toString("hex")): string {
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // timingSafeEqual throws on a length mismatch rather than returning false.
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

// `scrypt$salt$hash` is the format hashPassword emits and what a human pasting
// into .env by hand will have. `scrypt:salt:hash` means exactly the same thing
// and exists because Docker Compose interpolates `$` in .env files: both halves
// of a `$`-delimited hash are read as undefined variables and expand to
// nothing, so the backend receives the bare word "scrypt" and every login fails
// with the right password. Compose documents `$$` as the escape, but a value
// with no `$` in it cannot be eaten by Compose, a shell, sed or an editor at
// all, so setup-admin.sh writes the colon form and this accepts both.
const SCRYPT_PREFIX = /^scrypt[$:]/;

export function verifyPassword(stored: string, provided: string): boolean {
  if (!stored || !provided) return false;
  if (SCRYPT_PREFIX.test(stored)) {
    const [, salt, expected] = stored.split(stored[6] === ":" ? ":" : "$");
    if (!salt || !expected) return false;
    let actual: Buffer;
    try {
      actual = scryptSync(provided, salt, SCRYPT_KEYLEN);
    } catch {
      return false;
    }
    const expectedBuf = Buffer.from(expected, "hex");
    if (expectedBuf.length !== actual.length) return false;
    return timingSafeEqual(actual, expectedBuf);
  }
  // A plaintext ADMIN_PASSWORD is accepted so the panel is usable without a
  // hashing step first. index.ts warns loudly about it at boot; it should not
  // survive on a box anyone else can read.
  return safeEqual(stored, provided);
}

export class AdminAuth {
  private readonly credentials?: AdminCredentials;

  constructor(credentials?: AdminCredentials) {
    this.credentials = credentials?.username && credentials?.password ? credentials : undefined;
  }

  /** False when no username/password is configured -- the whole panel then 404s. */
  get enabled(): boolean {
    return this.credentials !== undefined;
  }

  login(username: unknown, password: unknown): string | undefined {
    if (!this.credentials) return undefined;
    if (typeof username !== "string" || typeof password !== "string") return undefined;
    // Both checks always run. Returning early on a bad username would make a
    // wrong name measurably faster than a wrong password, which tells an
    // attacker when they have found the right name.
    const userOk = safeEqual(username.trim().toLowerCase(), this.credentials.username);
    const passOk = verifyPassword(this.credentials.password, password);
    if (!userOk || !passOk) return undefined;
    return this.issue();
  }

  private issue(): string {
    const expires = Date.now() + SESSION_TTL_MS;
    const payload = String(expires);
    return `${payload}.${this.sign(payload)}`;
  }

  private sign(payload: string): string {
    return createHmac("sha256", this.credentials!.secret).update(payload).digest("hex");
  }

  // The cookie carries only an expiry and its signature. There is nothing to
  // revoke server-side and no session table, which is the right trade for one
  // admin: rotating ADMIN_SESSION_SECRET (or restarting, when it is
  // per-boot) invalidates every outstanding cookie at once.
  verifySession(cookieHeader: unknown): boolean {
    if (!this.credentials) return false;
    const raw = readCookie(cookieHeader, SESSION_COOKIE);
    if (!raw) return false;
    const [payload, signature] = raw.split(".");
    if (!payload || !signature) return false;
    if (!safeEqual(signature, this.sign(payload))) return false;
    const expires = Number(payload);
    return Number.isFinite(expires) && expires > Date.now();
  }

  // SameSite=Strict because every admin action is a same-site form POST, and
  // Strict is what stops another page in the browser POSTing to /admin/*
  // using this cookie. Secure is NOT set: over the tailnet this is plain
  // http, and a Secure cookie there would be dropped, locking the panel out
  // entirely.
  cookieHeader(session: string): string {
    const maxAge = Math.floor(SESSION_TTL_MS / 1000);
    return `${SESSION_COOKIE}=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
  }

  clearedCookieHeader(): string {
    return `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
  }
}

function readCookie(header: unknown, name: string): string | undefined {
  if (typeof header !== "string") return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

export function adminAuthFromEnv(env: NodeJS.ProcessEnv = process.env): AdminAuth {
  const username = env.ADMIN_USERNAME?.trim().toLowerCase();
  const password = env.ADMIN_PASSWORD_HASH || env.ADMIN_PASSWORD;
  if (!username || !password) return new AdminAuth();
  // A hash that arrives without its salt and digest can never match anything,
  // so every login fails with no clue why. This happened for real: a scrypt
  // hash is `scrypt$salt$hash`, and Docker Compose interpolates `$` in .env,
  // so both halves were read as undefined variables and the backend received
  // the bare word "scrypt". Say so loudly rather than silently rejecting a
  // correct password forever. (deploy/setup-admin.sh now writes `$$`.)
  if (SCRYPT_PREFIX.test(password) && password.split(password[6] === ":" ? ":" : "$").length !== 3) {
    console.error(
      "[admin] ADMIN_PASSWORD_HASH is malformed -- expected scrypt:<salt>:<hash>, got " +
        `${password.split(password[6] === ":" ? ":" : "$").length} part(s). If it came from ` +
        "deploy/.env, Compose interpolation ate the '$'; re-run deploy/setup-admin.sh, which " +
        "writes the ':' form. Every login fails until this is fixed.",
    );
  }
  return new AdminAuth({
    username,
    password,
    // A per-boot random secret is the safe default: sessions simply do not
    // survive a restart. Set ADMIN_SESSION_SECRET to keep them.
    secret: env.ADMIN_SESSION_SECRET || randomBytes(32).toString("hex"),
  });
}
