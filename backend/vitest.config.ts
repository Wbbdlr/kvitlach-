import { defineConfig } from "vitest/config";

export default defineConfig({
  // Prevents Vite from auto-discovering the unrelated legacy project's
  // postcss.config.js at the repo root (its postcss-import dep isn't installed here).
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
