import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AppearanceMenu } from "../AppearanceMenu";

// The felt and chip pickers moved out of the top chrome and behind one button
// (they were nine permanently-open slots in a row that is 61px tall on a
// landscape phone). These pin the part that regressed easily when they were
// inline: that both pickers are still REACHABLE, and that the panel closes by
// the two routes people actually use.
function setup(overrides: Partial<Parameters<typeof AppearanceMenu>[0]> = {}) {
  const onFeltChange = vi.fn();
  const onChipChange = vi.fn();
  render(
    <AppearanceMenu felt="green" chip="gold" onFeltChange={onFeltChange} onChipChange={onChipChange} {...overrides} />
  );
  return { onFeltChange, onChipChange };
}

const trigger = () => screen.getByRole("button", { name: "Table colors" });

describe("AppearanceMenu", () => {
  it("keeps the panel closed until asked", () => {
    setup();
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("dialog", { name: "Table colors" })).toBeNull();
  });

  it("offers every felt and chip choice once open", () => {
    setup();
    fireEvent.click(trigger());

    const panel = screen.getByRole("dialog", { name: "Table colors" });
    // 3 felts + 4 chips. Counted rather than named individually so adding a
    // colour to theme.ts fails here loudly instead of silently going
    // unreachable -- which is the actual risk of hiding them behind a button.
    expect(panel.querySelectorAll("button")).toHaveLength(7);
    expect(screen.getByRole("group", { name: "Table felt color" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Chip color" })).toBeInTheDocument();
  });

  it("reports a felt and a chip choice to its owner", () => {
    const { onFeltChange, onChipChange } = setup();
    fireEvent.click(trigger());

    fireEvent.click(screen.getAllByRole("button", { name: /felt$/i })[0]);
    expect(onFeltChange).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getAllByRole("button", { name: /chip color$/i })[0]);
    expect(onChipChange).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape", () => {
    setup();
    fireEvent.click(trigger());
    expect(screen.getByRole("dialog", { name: "Table colors" })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Table colors" })).toBeNull();
  });

  it("closes when a pointer goes down outside it", () => {
    setup();
    fireEvent.click(trigger());
    expect(screen.getByRole("dialog", { name: "Table colors" })).toBeInTheDocument();

    // pointerdown, not click: a touch that starts outside and lifts on the
    // panel would otherwise dismiss it, which on a touchscreen is most taps.
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("dialog", { name: "Table colors" })).toBeNull();
  });
});
