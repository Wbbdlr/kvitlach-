import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import Contact from "./Contact";

// Mirrors the shape About.tsx's own extra section would be tested with --
// see Contact.tsx's own comment for why this is the same pattern as About.

function mockFetchOnce(response: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(response) })
  );
}

describe("Contact page", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows only the built-in copy when nothing is set", async () => {
    mockFetchOnce({ heading: "", body: "", updatedAt: 0 });
    render(<Contact />);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/contact", expect.anything()));
    expect(screen.getByText(/Questions, bug reports/)).toBeInTheDocument();
    expect(screen.queryByText(/Closed for the holiday/)).not.toBeInTheDocument();
  });

  it("shows only the built-in copy when the backend is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    render(<Contact />);
    // Nothing to await on success here -- just confirm the built-in section
    // renders and nothing throws past the rejected fetch.
    expect(screen.getByText(/Questions, bug reports/)).toBeInTheDocument();
  });

  it("appends the operator's heading and body once fetched", async () => {
    mockFetchOnce({ heading: "Closed for the holiday", body: "Back Sunday.\n\nThanks for your patience.", updatedAt: 1 });
    render(<Contact />);
    expect(await screen.findByText("Closed for the holiday")).toBeInTheDocument();
    expect(screen.getByText("Back Sunday.")).toBeInTheDocument();
    expect(screen.getByText("Thanks for your patience.")).toBeInTheDocument();
  });

  it("shows the body with no heading when only the body is set", async () => {
    mockFetchOnce({ heading: "", body: "Just a note.", updatedAt: 1 });
    render(<Contact />);
    expect(await screen.findByText("Just a note.")).toBeInTheDocument();
  });
});
