import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import InstallPrompt from "./InstallPrompt";
import { installNudgeDue, silenceInstallNudge, snoozeInstallNudge } from "./pwa";

// The banner has three mutually exclusive states and only one of them is
// reachable on the machine anyone develops on, so the branches are pinned here
// rather than by looking at it: a desktop Chrome that never fires
// `beforeinstallprompt` shows nothing, and that is also what a bug looks like.

function firePrompt() {
  const event = new Event("beforeinstallprompt") as Event & {
    prompt?: () => Promise<void>;
    userChoice?: Promise<{ outcome: string }>;
  };
  event.prompt = () => Promise.resolve();
  event.userChoice = Promise.resolve({ outcome: "accepted" });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

function setUA(ua: string) {
  Object.defineProperty(navigator, "userAgent", { configurable: true, value: ua });
}

beforeEach(() => {
  window.localStorage.clear();
  // pwa.ts parks the deferred prompt at MODULE scope, deliberately -- the
  // browser fires it once per page life and often before React mounts. That
  // means it survives between tests in this file, so each one starts by
  // clearing it the same way a real install would.
  act(() => {
    window.dispatchEvent(new Event("appinstalled"));
  });
  setUA("Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("InstallPrompt", () => {
  it("shows nothing on a desktop browser that never offers an install", () => {
    render(<InstallPrompt />);
    expect(screen.queryByText(/add kvitlach to your phone/i)).not.toBeInTheDocument();
  });

  it("appears once the browser offers an install, with a real Install button", () => {
    firePrompt();
    render(<InstallPrompt />);
    expect(screen.getByText(/add kvitlach to your phone/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^install$/i })).toBeInTheDocument();
  });

  // iOS has no install API at all, so the only thing on offer is the
  // instruction. Showing an Install button there would be a button that does
  // nothing.
  it("gives iOS the Share instruction instead of a button", () => {
    setUA("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15");
    render(<InstallPrompt />);
    expect(screen.getByText(/add to home screen/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^install$/i })).not.toBeInTheDocument();
  });

  it("stays dismissed after Not now", () => {
    setUA("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15");
    const { unmount } = render(<InstallPrompt />);
    fireEvent.click(screen.getByRole("button", { name: /not now/i }));
    expect(screen.queryByText(/add kvitlach to your phone/i)).not.toBeInTheDocument();
    unmount();
    render(<InstallPrompt />);
    expect(screen.queryByText(/add kvitlach to your phone/i)).not.toBeInTheDocument();
  });

  // TableRoot shows its own iOS install hint. Dismissing either must silence
  // both -- being told twice how to install an app you have declined is how a
  // nudge becomes nagging.
  it("shares its dismissal with the in-table iOS hint", () => {
    setUA("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15");
    render(<InstallPrompt />);
    fireEvent.click(screen.getByRole("button", { name: /not now/i }));
    expect(installNudgeDue("kvitlach.iosInstallHintSeen")).toBe(false);
  });
});

// The snooze itself, tested against pwa.ts rather than through the banner:
// every branch here is a date arithmetic question, and driving it through a
// render would only obscure that.
describe("install nudge snooze", () => {
  const KEY = "kvitlach.testNudge";
  const DAY = 24 * 60 * 60 * 1000;
  const T0 = Date.UTC(2026, 0, 1);

  it("offers on a first visit", () => {
    expect(installNudgeDue(KEY, T0)).toBe(true);
  });

  it("goes quiet for a week after one Not now, then asks again", () => {
    // The whole point of the change: one decline used to mean never again.
    snoozeInstallNudge(KEY, T0);
    expect(installNudgeDue(KEY, T0 + 6 * DAY)).toBe(false);
    expect(installNudgeDue(KEY, T0 + 7 * DAY)).toBe(true);
  });

  it("waits longer each time it is declined", () => {
    snoozeInstallNudge(KEY, T0);
    snoozeInstallNudge(KEY, T0 + 7 * DAY);
    expect(installNudgeDue(KEY, T0 + 7 * DAY + 29 * DAY)).toBe(false);
    expect(installNudgeDue(KEY, T0 + 7 * DAY + 30 * DAY)).toBe(true);
  });

  it("stops asking once the answer is clearly no", () => {
    // Four declines spread over four months is an answer, not an oversight.
    let at = T0;
    for (const wait of [0, 7, 30, 90]) {
      at += wait * DAY;
      snoozeInstallNudge(KEY, at);
    }
    expect(installNudgeDue(KEY, at + 3650 * DAY)).toBe(false);
  });

  it("never asks again once they install it", () => {
    silenceInstallNudge(KEY);
    expect(installNudgeDue(KEY, T0 + 3650 * DAY)).toBe(false);
  });

  it("treats an old permanent dismissal as a fresh snooze, not a fresh ask", () => {
    // Every build before this wrote a flat "1". Reading that as "dismissed at
    // the epoch" would re-nag every existing player the moment they load this
    // one, which is the behaviour the snooze exists to prevent.
    window.localStorage.setItem(KEY, "1");
    expect(installNudgeDue(KEY, Date.now())).toBe(false);
    expect(installNudgeDue(KEY, Date.now() + 8 * DAY)).toBe(true);
  });

  it("shows the nudge rather than swallowing it when storage is unreadable", () => {
    // Private mode and "block site data" throw on read. A nudge that fails
    // open is dismissible; one that fails closed can never be shown at all.
    const getItem = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error("blocked");
    };
    try {
      expect(installNudgeDue(KEY, T0)).toBe(true);
    } finally {
      Storage.prototype.getItem = getItem;
    }
  });
});
