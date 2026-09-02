import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config";

// Separate config so the capture run and the regression suite never run each
// other: playwright.config.ts's testDir is ./tests, this one's is ./capture.
//
// Inherits that config's webServer block verbatim, which is the point of the
// whole arrangement -- `npm run screenshots` starts its own backend and
// frontend on the E2E ports, captures, and tears them down, so producing the
// images is one command from a cold repo rather than "first start two dev
// servers".
// Two projects, one spec. Playwright has no way to pass a custom flag through
// to a test, and an env var is a different incantation in bash, cmd and
// PowerShell -- a project name is selectable with --project on all three:
//
//     npm --prefix e2e run screenshots        # full, every phase
//     npm --prefix e2e run shot               # quick, 854x384 only
//
// "quick" stops after the dealt hand. The reaction and resolved phases are
// most of the wall clock per viewport (the resolved one waits out the bots'
// turns, the banker's, and a toast), and neither tells you anything about
// spacing that the dealt felt does not. Use quick while iterating; the full
// run is what a step is signed off on.
const PHASES = ["full", "quick"] as const;

export default defineConfig({
  ...base,
  testDir: "./capture",
  // Every viewport writes to its own directory, so parallelism is safe -- but
  // these run a real round each through a live WebSocket, and the suite's own
  // comments record round times ballooning under contention. Capture is not
  // on anyone's critical path; take the slower, more reliable run.
  //
  // One worker also means one BROWSER: Playwright's `browser` fixture is
  // worker-scoped, so a sweep launches Chrome once and each viewport is a new
  // BrowserContext inside it, not a new process. Raising this would multiply
  // the Chrome processes, not the throughput.
  workers: 1,
  retries: 0,
  // Nothing here asserts, so a "failure" is a broken capture script, not a
  // flaky expectation -- no point retaining traces for it.
  use: { ...base.use, trace: "off" },
  projects: PHASES.map((name) => ({ name, use: { ...devices["Desktop Chrome"] } })),
});
