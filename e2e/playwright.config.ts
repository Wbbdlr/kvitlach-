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
  // Playwright's 30s default is not enough here and was already marginal: a
  // single full-round run takes ~20s on its own, because these tests wait on
  // real WebSocket round trips between two or three live browsers rather than
  // on local state. Run several of those specs at once and every one of them
  // blew the 30s budget on contention alone -- the pre-existing full-round
  // spec included, which passes comfortably when run by itself. Raised rather
  // than worked around: the waits are legitimate, not a symptom.
  // Raised again from 90s: with workers: 2 the three-browser specs can be
  // paired with seat-cap's thirteen contexts, and two-players spent its whole
  // budget on contention rather than on anything it was testing.
  timeout: 120_000,
  fullyParallel: true,
  // Capped deliberately, and not just to be tidy: seat-cap.spec.ts drives 13
  // live browser contexts on its own, and at the default worker count it ran
  // alongside three other multi-browser specs -- roughly 20 contexts at once.
  // Nothing failed, but full-round went from ~12s standalone to 56s, which is
  // most of the way to the timeout above on nothing but contention. Two
  // workers keeps the heavy spec paired with at most one other, and costs
  // very little wall clock since seat-cap dominates the run either way.
  workers: 2,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${FRONTEND_PORT}`,
    trace: "retain-on-failure",
    // Playwright's default navigation timeout is INFINITE, and that turned
    // every slow page load into a bare "Test timeout of 120000ms exceeded"
    // naming no assertion at all -- which is why the intermittent failures in
    // this suite were so hard to place. Bounded so a stall says it is a stall,
    // and says which navigation.
    navigationTimeout: 45_000,
    actionTimeout: 20_000,
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
      // Playwright kills a webServer by killing the process GROUP on exit,
      // but only for a run it gets to finish. SIGINT'ing it on Windows can
      // leave the tsx/vite child alive holding the port, which then makes the
      // NEXT run fail on --strictPort or silently reuse a stale backend.
      // Asking for a graceful signal first, with a bounded wait before the
      // hard kill, closes both.
      gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
    },
    {
      // A BUILT bundle served by vite preview, not the dev server.
      //
      // The dev server serves every module as its own request, and a fresh
      // BrowserContext has an empty HTTP cache -- so each new context pays for
      // hundreds of round trips before the page is usable. Specs here open
      // three contexts (two-players) and thirteen (seat-cap), and page.goto had
      // no timeout of its own, so a slow cold load silently ate a test's whole
      // 120s budget and surfaced as a flake with no assertion attached. It was
      // blamed on layout, on contention, and on worker count in turn; it was
      // none of them.
      //
      // One bundle, and it is also the artefact that actually ships (nginx
      // serves the same dist in Docker), so the suite now exercises the
      // production build rather than a dev-only module graph. The build costs
      // a few seconds once per run and repays it on the first context.
      //
      // --strictPort: fail loudly instead of silently drifting to a free
      // port if FRONTEND_PORT is somehow taken -- baseURL above would
      // otherwise point at nothing and every test would fail with a
      // confusing connection-refused instead of a clear startup error.
      command: `npm run build && npx vite preview --port ${FRONTEND_PORT} --strictPort`,
      cwd: "../frontend",
      port: FRONTEND_PORT,
      // Vite exposes VITE_-prefixed process env vars via import.meta.env
      // automatically (state.ts's WS_URL reads import.meta.env.VITE_WS_URL)
      // -- this overrides frontend/.env.local's own ws://localhost:3001
      // for the duration of the test run, pointing this Vite instance at
      // the E2E backend above instead of a developer's regular local one.
      // Baked in at BUILD time now rather than read at dev-server startup --
      // same variable, same effect, but it has to be present for the `npm run
      // build` half of the command above, not just the preview half.
      env: { VITE_WS_URL: `ws://localhost:${WS_PORT}` },
      reuseExistingServer: false,
      // Raised from 30s: this now builds before it serves.
      timeout: 120_000,
      gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
    },
  ],
});
