import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/setupTests.ts",
    // Vitest defaults its thread pool to the CPU count (8 here), and each
    // worker builds its own jsdom -- 29 test files fanned across 7-8 threads
    // pins every core for the length of the run on a machine that is also
    // running the dev server and an editor. Two is enough to keep the wall
    // clock reasonable (~46s -> ~70s) without the fans coming on. No Chrome
    // is involved at any point here; this suite is jsdom in-process.
    // `pool` MUST stay explicit. Vitest 1 defaulted to threads, so the
    // poolOptions.threads limit below simply applied; from Vitest 2 the
    // default is `forks`, which silently orphans it -- the cap stops binding
    // and the suite fans back out across every core, which is both the thing
    // the comment above was written to prevent and, measured during the
    // upgrade, the cause of eight tests failing in a full run and passing
    // alone. Non-deterministic reds like that are the expensive kind: they
    // read as a broken change rather than as a config default moving.
    pool: "threads",
    poolOptions: { threads: { minThreads: 1, maxThreads: 2 } },
  },
});
