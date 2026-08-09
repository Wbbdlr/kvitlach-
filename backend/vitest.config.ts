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
    coverage: {
      reporter: ["text", "json", "html"],
    },
  },
});
