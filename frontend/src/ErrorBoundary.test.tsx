import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ErrorBoundary } from "./ErrorBoundary";

function Boom(): JSX.Element {
  throw new Error("kaboom");
}

afterEach(() => vi.restoreAllMocks());

describe("ErrorBoundary", () => {
  it("renders children when nothing throws", () => {
    render(
      <ErrorBoundary>
        <div>table</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText("table")).toBeTruthy();
  });

  it("shows a recoverable message instead of a blank page when a child throws", () => {
    // React logs caught render errors to console.error regardless; silence it
    // so a deliberately thrown error doesn't read as a failing suite.
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Something went wrong")).toBeTruthy();
    // The reassurance is the point: the session survives in localStorage and
    // the room survives on the server, so reloading really does rejoin.
    expect(screen.getByRole("button", { name: /reload/i })).toBeTruthy();
  });
});
