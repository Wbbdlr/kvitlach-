import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import Disclaimer from "./Disclaimer";

const ALL_EMPTY = {
  gambling: { body: "", updatedAt: 0 },
  responsibility: { body: "", updatedAt: 0 },
  warranties: { body: "", updatedAt: 0 },
  liability: { body: "", updatedAt: 0 },
  ownership: { body: "", updatedAt: 0 },
  development: { body: "", updatedAt: 0 },
};

function mockFetchOnce(response: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(response) })
  );
}

describe("Disclaimer page", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows every section's built-in bullets when nothing is overridden", async () => {
    mockFetchOnce(ALL_EMPTY);
    render(<Disclaimer />);
    // Wrapped in waitFor (not a bare assertion) so the fetch response's own
    // state update -- setOverrides({}), a no-op visually but still a render
    // -- settles inside RTL's act() rather than after the test returns.
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(await screen.findByText(/This app is for entertainment and education only/)).toBeInTheDocument();
    expect(screen.getByText(/We are not liable for any losses/)).toBeInTheDocument();
    expect(screen.getByText(/The Futch \(bust\) horn and the Eleveroon fanfare/)).toBeInTheDocument();
    // All six headings present regardless of API state -- they are fixed,
    // never operator content.
    for (const heading of [
      "No gambling, no real money",
      "Player responsibility",
      "No warranties or guarantees",
      "Liability",
      "Ownership",
      "Still in development",
    ]) {
      expect(screen.getByRole("heading", { name: heading, level: 2 })).toBeInTheDocument();
    }
  });

  it("still shows every section's built-in bullets when the backend is unreachable", () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    render(<Disclaimer />);
    expect(screen.getByText(/This app is for entertainment and education only/)).toBeInTheDocument();
  });

  it("overriding one section replaces only that section's bullets, heading unchanged", async () => {
    mockFetchOnce({ ...ALL_EMPTY, liability: { body: "New liability wording, in full.", updatedAt: 1 } });
    render(<Disclaimer />);

    expect(await screen.findByText("New liability wording, in full.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Liability", level: 2 })).toBeInTheDocument();
    expect(screen.queryByText(/We are not liable for any losses/)).not.toBeInTheDocument();

    // Every OTHER section is untouched -- still its own built-in bullets.
    expect(screen.getByText(/This app is for entertainment and education only/)).toBeInTheDocument();
    expect(screen.getByText(/The Futch \(bust\) horn and the Eleveroon fanfare/)).toBeInTheDocument();
  });

  it("splits a multi-paragraph override on blank lines, same as About/Contact", async () => {
    mockFetchOnce({ ...ALL_EMPTY, ownership: { body: "First paragraph.\n\nSecond paragraph.", updatedAt: 1 } });
    render(<Disclaimer />);
    expect(await screen.findByText("First paragraph.")).toBeInTheDocument();
    expect(screen.getByText("Second paragraph.")).toBeInTheDocument();
  });

  it("ignores an unrecognised key from the API rather than rendering it", async () => {
    mockFetchOnce({ ...ALL_EMPTY, "not-a-real-section": { body: "should not appear", updatedAt: 1 } });
    render(<Disclaimer />);
    expect(await screen.findByText(/This app is for entertainment and education only/)).toBeInTheDocument();
    expect(screen.queryByText("should not appear")).not.toBeInTheDocument();
  });
});
