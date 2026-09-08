import { describe, expect, it } from "vitest";
import { router } from "../router";

// RouterProvider installs an error boundary PER ROUTE, and it sits inside
// main.tsx's <ErrorBoundary>, so it catches first. A route with no
// errorElement therefore falls through to React Router's own built-in
// fallback -- a white page reading "Unexpected Application Error!" over a raw
// stack trace, no reload button, nothing about the seat still being there.
// Reported from a phone as "a white page with tons of text", which is exactly
// what it is. The app's card only ever reaches a player if every route says
// so, and a new route is the easy place to forget.
//
// Asserted on `hasErrorBoundary` rather than on the errorElement itself:
// that is the flag React Router actually branches on at catch time, and it
// is what the router derives from the element we pass.
describe("every route carries an errorElement", () => {
  it("leaves no route on React Router's raw stack-trace fallback", () => {
    const missing = router.routes
      .filter((route) => !route.hasErrorBoundary)
      .map((route) => route.path ?? "(no path)");
    expect(missing).toEqual([]);
  });

  it("covers the catch-all, which is the one every table path lands on", () => {
    const catchAll = router.routes.find((route) => route.path === "*");
    expect(catchAll).toBeDefined();
    expect(catchAll!.hasErrorBoundary).toBe(true);
  });
});
