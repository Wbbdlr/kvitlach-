import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// Separate config so the capture run and the regression suite never run each
// other: playwright.config.ts's testDir is ./tests, this one's is ./capture.
//
// Inherits that config's webServer block verbatim, which is the point of the
// whole arrangement -- `npm run screenshots` starts its own backend and
// frontend on the E2E ports, captures, and tears them down, so producing the
// images is one command from a cold repo rather than "first start two dev
// servers".
export default defineConfig({
  ...base,
  testDir: "./capture",
  // Every viewport writes to its own directory, so parallelism is safe -- but
  // these run a real round each through a live WebSocket, and the suite's own
  // comments record round times ballooning under contention. Capture is not
  // on anyone's critical path; take the slower, more reliable run.
  workers: 1,
  retries: 0,
  // Nothing here asserts, so a "failure" is a broken capture script, not a
  // flaky expectation -- no point retaining traces for it.
  use: { ...base.use, trace: "off" },
});
