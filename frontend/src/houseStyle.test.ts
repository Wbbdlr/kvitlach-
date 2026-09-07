import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

// House style, stated once so it stops being a taste argument per string.
//
// No em dashes. Asked for directly: "Get rid of all em-dashes on the platform
// in general. I don't like using them at all." They had accumulated in three
// separate places -- player-facing copy, the legal pages, and comments -- and
// a preference nobody can grep for is one that comes back on the next batch
// of copy. A spaced hyphen is what replaced every one of them.
//
// Scoped to source rather than the whole repo: build output and coverage
// reports are generated from this, so fixing it here fixes it everywhere that
// matters.
// Built from its code point so this file is not its own first offender.
const EM_DASH = String.fromCharCode(0x2014);
const ROOTS = [resolve(__dirname), resolve(__dirname, "../../backend/src")];
const EXTENSIONS = [".ts", ".tsx", ".css"];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (EXTENSIONS.some((ext) => entry.endsWith(ext))) out.push(full);
  }
  return out;
}

describe("house style", () => {
  it("uses no em dashes anywhere in the source", () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const file of sourceFiles(root)) {
        const text = readFileSync(file, "utf8");
        if (!text.includes(EM_DASH)) continue;
        text.split("\n").forEach((line, i) => {
          if (line.includes(EM_DASH)) offenders.push(`${relative(root, file)}:${i + 1}: ${line.trim()}`);
        });
      }
    }
    expect(offenders, `use a spaced hyphen instead:\n${offenders.join("\n")}`).toEqual([]);
  });
});
