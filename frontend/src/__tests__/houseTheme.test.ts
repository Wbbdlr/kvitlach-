import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CHIP, DEFAULT_FELT, loadChip, loadFelt, saveFelt, setHouseTheme } from "../theme";
import { applyHouseTheme } from "../clientConfig";

// The operator can set a house felt and chip. The precedence is the whole
// feature and it is a decision, not an accident of implementation:
//
//   the player's own saved choice  >  the house default  >  the shipped default
//
// Somebody who picked burgundy in December opens their table in burgundy
// however the house feels about it. The house default reaches only a browser
// that has never chosen: a first visit, a new device, a cleared cache.

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("style");
  // Module state, so each test has to put it back where it found it.
  setHouseTheme(DEFAULT_FELT, DEFAULT_CHIP);
});

describe("precedence", () => {
  it("uses the shipped default when nothing has been said at all", () => {
    expect(loadFelt()).toBe(DEFAULT_FELT);
    expect(loadChip()).toBe(DEFAULT_CHIP);
  });

  it("takes the house default when the player has never chosen", () => {
    setHouseTheme("burgundy", "ruby");
    expect(loadFelt()).toBe("burgundy");
    expect(loadChip()).toBe("ruby");
  });

  it("leaves a player who HAS chosen exactly where they were", () => {
    saveFelt("green");
    setHouseTheme("burgundy", "ruby");
    expect(loadFelt()).toBe("green");
  });

  it("does not write the house default into storage", () => {
    // Storing it would record a choice the player never made -- and then a
    // later change to the house theme would never reach them, because they
    // would be indistinguishable from somebody who picked that felt on purpose.
    setHouseTheme("burgundy", "ruby");
    loadFelt();
    loadChip();
    expect(localStorage.getItem("kvitlach.felt")).toBeNull();
    expect(localStorage.getItem("kvitlach.chip")).toBeNull();
  });

  it("ignores a felt or chip this build does not have", () => {
    setHouseTheme("plaid", "unobtanium");
    expect(loadFelt()).toBe(DEFAULT_FELT);
    expect(loadChip()).toBe(DEFAULT_CHIP);
  });
});

describe("applying it when the config lands", () => {
  it("repaints the custom properties, because CSS does not re-evaluate on its own", () => {
    // The fetch can resolve after React mounted and already applied the shipped
    // felt. Without this repaint the house felt would be known and not shown.
    applyHouseTheme({ felt: "burgundy", chip: "ruby" });
    expect(document.documentElement.style.getPropertyValue("--felt-hi")).toBe("#5a2733");
    expect(document.documentElement.style.getPropertyValue("--chip-ink")).toBe("#e0b8b4");
  });

  it("repaints a chooser's OWN felt, not the house one", () => {
    saveFelt("green");
    applyHouseTheme({ felt: "burgundy", chip: "ruby" });
    expect(document.documentElement.style.getPropertyValue("--felt-hi")).toBe("#24503a");
  });

  it("announces itself so a mounted switcher can catch up", () => {
    const heard = vi.fn();
    window.addEventListener("kvitlach:house-theme", heard);
    applyHouseTheme({ felt: "navy", chip: "silver" });
    expect(heard).toHaveBeenCalled();
    window.removeEventListener("kvitlach:house-theme", heard);
  });

  it("does nothing with a missing or malformed theme", () => {
    applyHouseTheme(undefined);
    applyHouseTheme(null);
    applyHouseTheme("navy" as never);
    expect(loadFelt()).toBe(DEFAULT_FELT);
  });
});
