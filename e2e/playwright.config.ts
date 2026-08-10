import { defineConfig, devices } from "@playwright/test";

// Dedicated ports, deliberately different from the interactive dev setup
// (backend 3000/3001, frontend 5173 -- see CLAUDE.md's "Local development"
// section) so a developer running the real dev servers for manual testing
// never collides with, or gets silently reused by, an E2E run. reuseExisting
// Server: false (below) means every `playwright test` invocation gets a
// fresh backend process -- and since there's no DATABASE_URL, a genuinely
// fresh in-memory GameStore (see backend/src/index.ts) -- so tests never
// inherit state from a previous run.
const HTTP_PORT = 3100;
const WS_PORT = 3101;
const FRONTEND_PORT = 5273;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${FRONTEND_PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "npm run dev",
      cwd: "../backend",
      url: `http://localhost:${HTTP_PORT}/health`,
      env: { PORT: String(HTTP_PORT), WS_PORT: String(WS_PORT) },
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      // --strictPort: fail loudly instead of silently drifting to a free
      // port if FRONTEND_PORT is somehow taken -- baseURL above would
      // otherwise point at nothing and every test would fail with a
      // confusing connection-refused instead of a clear startup error.
      command: `npm run dev -- --port ${FRONTEND_PORT} --strictPort`,
      cwd: "../frontend",
      port: FRONTEND_PORT,
      // Vite exposes VITE_-prefixed process env vars via import.meta.env
      // automatically (state.ts's WS_URL reads import.meta.env.VITE_WS_URL)
      // -- this overrides frontend/.env.local's own ws://localhost:3001
      // for the duration of the test run, pointing this Vite instance at
      // the E2E backend above instead of a developer's regular local one.
      env: { VITE_WS_URL: `ws://localhost:${WS_PORT}` },
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
