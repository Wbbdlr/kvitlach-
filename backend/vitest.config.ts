import { defineConfig } from "vitest/config";

export default defineConfig({
  // Explicit empty postcss config, so Vite never auto-discovers one by
  // walking up from cwd. Originally needed because a legacy Phoenix
  // project's postcss.config.js sat at the repo root with an uninstalled
  // postcss-import dep, which broke `vitest run` outright. That tree was
  // removed 2026-08-09, but keep this override -- it's a cheap guard
  // against the same class of surprise if anything ever adds a root config.
  css: { postcss: {} },
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts"],
    // Left on Vitest's own default (`forks` since Vitest 2), deliberately and
    // with numbers behind it. This suite has a known intermittent flake in its
    // real-WebSocket and real-timer tests (TASKS.md), and pinning the old
    // `threads` model back during the Vitest 1 -> 3 upgrade made it markedly
    // WORSE, not better: 0 of 2 full runs clean on threads (3 and 5 failures)
    // against 2 of 3 on forks. A fork per file is the stronger isolation and
    // this suite evidently needs it. Do not pin `pool` here without re-running
    // that comparison -- the frontend pins `threads` for an unrelated reason
    // (a thread cap the default move orphaned) and is not a precedent.
    coverage: {
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      // index.ts is bootstrap wiring (construct the store, construct the two
      // servers) with no branches worth asserting, and simulate.ts is a
      // standalone CLI odds harness run by hand via `npm run simulate`, not
      // part of the app. Both would only ever sit at 0% and drag the floor
      // below into meaninglessness.
      exclude: ["src/__tests__/**", "src/index.ts", "src/simulate.ts"],
      // Set just under the measured numbers at the time of writing (stmts
      // 85.7, branch 72.6, funcs 92.1) -- enough headroom that ordinary
      // refactoring doesn't trip it, tight enough that deleting or bypassing
      // a tested path does. These are a ratchet against backsliding, not a
      // target to chase: raise them when real coverage rises, and never lower
      // one to make a red build green without saying why in the same commit.
      thresholds: {
        statements: 84,
        branches: 70,
        functions: 90,
        lines: 84,
      },
    },
  },
});
