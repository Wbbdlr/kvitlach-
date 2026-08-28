import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ERROR_COPY, errorCopy } from "./errorCopy";

// Reads the BACKEND source rather than a copy of the list, because a
// hand-maintained duplicate is exactly how the eleven missing codes got
// missed in the first place: the ternary chain this replaced looked complete,
// and nothing anywhere compared it to what the server actually throws.
const BACKEND_SRC = join(__dirname, "..", "..", "backend", "src");

function backendErrorCodes(): string[] {
  const codes = new Set<string>();
  for (const file of readdirSync(BACKEND_SRC)) {
    if (!file.endsWith(".ts")) continue;
    const text = readFileSync(join(BACKEND_SRC, file), "utf8");
    for (const m of text.matchAll(/throw new Error\("([a-z][a-z0-9_]*)"\)/g)) codes.add(m[1]);
    for (const m of text.matchAll(/message: "([a-z][a-z0-9_]*)"/g)) codes.add(m[1]);
  }
  return [...codes].sort();
}

describe("error copy", () => {
  it("has a sentence for every code the backend can send", () => {
    const missing = backendErrorCodes().filter((code) => !ERROR_COPY[code]);
    expect(missing, `no player-facing copy for: ${missing.join(", ")}`).toEqual([]);
  });

  it("found a non-trivial number of codes to check", () => {
    // Guards the guard: if the regexes ever stop matching, the test above
    // passes vacuously against an empty list and stops protecting anything.
    expect(backendErrorCodes().length).toBeGreaterThan(25);
  });

  it("covers server_error, which is what unexpected failures become", () => {
    // ws-server replaces any non-protocol error text with this, so it is the
    // code a player is most likely to see when something genuinely breaks --
    // and the one it would be easiest to leave without copy.
    expect(ERROR_COPY.server_error).toBeTruthy();
    expect(errorCopy("server_error")).not.toBe("server error");
  });

  it("never renders an empty message", () => {
    expect(errorCopy(undefined)).toBeTruthy();
    expect(errorCopy("")).toBeTruthy();
    expect(errorCopy("a_code_from_the_future")).toBe("a code from the future");
  });
});
