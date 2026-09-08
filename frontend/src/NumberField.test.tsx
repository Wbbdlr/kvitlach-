import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { useState } from "react";
import { NumberField } from "./NumberField";

// Our own number pad, instead of the phone's.
//
// Asked for after playing 11.5 on Android: the OS keyboard "is huge and
// blocks most of the screen", and a web page has no way to size it -- there
// is no API, and `inputmode="numeric"` only asks for a numeric pad, which
// Android in landscape routinely ignores and renders fullscreen anyway. The
// only real fix is to stop summoning it: a read-only field that opens a pad
// we draw ourselves, inside the felt, at a size we choose.
//
// `readOnly` is what actually suppresses the keyboard; `inputMode="none"` is
// the explicit modern signal and belt-and-braces for browsers that would
// still offer one. Both, deliberately.

function Harness(props: Partial<React.ComponentProps<typeof NumberField>> = {}) {
  const [value, setValue] = useState(props.value ?? "5");
  return (
    <NumberField
      value={value}
      onChange={setValue}
      label="Bet amount"
      // Spread last so a passed onChange wins over the harness's own setValue
      // and typing stays observable. It used to be re-spread again below,
      // conditionally, which did exactly the same thing a second time.
      {...props}
    />
  );
}

const field = () => screen.getByLabelText("Bet amount") as HTMLInputElement;
const open = () => fireEvent.click(field());
const key = (label: string) => screen.getByRole("button", { name: label });

describe("the field itself never summons the phone keyboard", () => {
  it("is read-only, which is the whole mechanism", () => {
    render(<Harness />);
    expect(field()).toHaveAttribute("readonly");
  });

  it("also tells the browser outright that it wants no keyboard", () => {
    render(<Harness />);
    expect(field()).toHaveAttribute("inputmode", "none");
  });

  it("still reads as a number field to assistive tech", () => {
    render(<Harness />);
    // A read-only text box with no role would be announced as static text.
    expect(field()).toHaveAttribute("role", "spinbutton");
  });
});

describe("opening and closing the pad", () => {
  beforeEach(() => {
    render(<Harness />);
  });

  it("opens on a tap, not before", () => {
    expect(screen.queryByRole("dialog", { name: /bet amount/i })).toBeNull();
    open();
    expect(screen.getByRole("dialog", { name: /bet amount/i })).toBeInTheDocument();
  });

  it("closes on Done", () => {
    open();
    fireEvent.click(key("Done"));
    expect(screen.queryByRole("dialog", { name: /bet amount/i })).toBeNull();
  });

  it("closes on Escape", () => {
    open();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: /bet amount/i })).toBeNull();
  });

  it("closes on a tap outside it", () => {
    open();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("dialog", { name: /bet amount/i })).toBeNull();
  });
});

describe("entering a number", () => {
  beforeEach(() => {
    render(<Harness />);
  });

  it("replaces the starting value on the first digit, then appends", () => {
    // Same reasoning as the quick-bet tray's first-tap rule: the field
    // arrives holding something, and a pad that appended to it would turn a
    // tap of 2 into 52.
    open();
    fireEvent.click(key("2"));
    expect(field().value).toBe("2");
    fireEvent.click(key("5"));
    expect(field().value).toBe("25");
  });

  it("backspaces one digit at a time", () => {
    open();
    fireEvent.click(key("1"));
    fireEvent.click(key("2"));
    fireEvent.click(key("3"));
    fireEvent.click(key("Backspace"));
    expect(field().value).toBe("12");
  });

  it("clears back to empty", () => {
    open();
    fireEvent.click(key("7"));
    fireEvent.click(key("Clear"));
    expect(field().value).toBe("");
  });

  it("does not grow without limit", () => {
    open();
    for (let i = 0; i < 15; i += 1) fireEvent.click(key("9"));
    expect(field().value.length).toBeLessThanOrEqual(9);
  });

  it("shows the running value on the pad, where the thumb is", () => {
    open();
    fireEvent.click(key("4"));
    fireEvent.click(key("0"));
    expect(screen.getByTestId("numberpad-value")).toHaveTextContent("40");
  });
});

describe("bounds", () => {
  it("clamps up to min when the pad closes", () => {
    render(<Harness min={1} />);
    open();
    fireEvent.click(key("0"));
    fireEvent.click(key("Done"));
    expect(field().value).toBe("1");
  });

  it("clamps down to max when the pad closes", () => {
    render(<Harness max={120} />);
    open();
    fireEvent.click(key("9"));
    fireEvent.click(key("9"));
    fireEvent.click(key("9"));
    fireEvent.click(key("Done"));
    // A player cannot wager more than they hold; the pad says so rather than
    // letting the server reject it after the fact.
    expect(field().value).toBe("120");
  });

  it("refuses to let an empty field survive a close when a min is set", () => {
    render(<Harness min={1} />);
    open();
    fireEvent.click(key("Clear"));
    fireEvent.click(key("Done"));
    expect(field().value).toBe("1");
  });

  it("leaves an empty field empty when nothing is required", () => {
    // The bank top-up deliberately starts blank (#7) -- clamping it to 1
    // would reintroduce a default nobody chose.
    render(<Harness value="" />);
    open();
    fireEvent.click(key("Clear"));
    fireEvent.click(key("Done"));
    expect(field().value).toBe("");
  });
});

// The banker's chip adjustment takes a NEGATIVE amount ("Amount (negative
// removes chips)") -- so a pad that only produced digits would have quietly
// removed the banker's ability to take chips back. Opt-in, because every
// other field in the app would be wrong to accept one.
describe("negative amounts, where they are meant", () => {
  it("offers no sign key by default", () => {
    render(<Harness />);
    open();
    expect(screen.queryByRole("button", { name: "Negate" })).toBeNull();
  });

  it("toggles the sign when the field allows it", () => {
    render(<Harness allowNegative />);
    open();
    fireEvent.click(key("2"));
    fireEvent.click(key("5"));
    fireEvent.click(key("Negate"));
    expect(field().value).toBe("-25");
  });

  it("toggles back off", () => {
    render(<Harness allowNegative />);
    open();
    fireEvent.click(key("5"));
    fireEvent.click(key("Negate"));
    fireEvent.click(key("Negate"));
    expect(field().value).toBe("5");
  });

  it("keeps the sign through a Done that has no min to clamp against", () => {
    render(<Harness allowNegative />);
    open();
    fireEvent.click(key("3"));
    fireEvent.click(key("0"));
    fireEvent.click(key("Negate"));
    fireEvent.click(key("Done"));
    expect(field().value).toBe("-30");
  });

  it("survives a backspace without losing the minus", () => {
    render(<Harness allowNegative />);
    open();
    fireEvent.click(key("4"));
    fireEvent.click(key("2"));
    fireEvent.click(key("Negate"));
    fireEvent.click(key("Backspace"));
    expect(field().value).toBe("-4");
  });
});

describe("a real keyboard still works when one is present", () => {
  beforeEach(() => {
    render(<Harness />);
  });

  it("takes typed digits", () => {
    open();
    fireEvent.keyDown(document, { key: "3" });
    fireEvent.keyDown(document, { key: "7" });
    expect(field().value).toBe("37");
  });

  it("takes Backspace", () => {
    open();
    fireEvent.keyDown(document, { key: "4" });
    fireEvent.keyDown(document, { key: "2" });
    fireEvent.keyDown(document, { key: "Backspace" });
    expect(field().value).toBe("4");
  });

  it("takes Enter as Done", () => {
    open();
    fireEvent.keyDown(document, { key: "8" });
    fireEvent.keyDown(document, { key: "Enter" });
    expect(screen.queryByRole("dialog", { name: /bet amount/i })).toBeNull();
    expect(field().value).toBe("8");
  });
});

// Found while bug-hunting 11.6, not by a user: the create-a-table form's
// bankroll field answers an empty value by substituting the buy-in, so the
// parent echoes back something OTHER than what the pad just sent. The pad was
// reading its "digits so far" straight off the `value` prop, so that echo
// became the base for the next keypress: Clear then 5 produced "1005".
//
// The pad owns the digit sequence between opening and Done. A controlled
// parent is free to transform, clamp or ignore what it is handed -- that is
// what controlled means -- and it must not be able to corrupt what is being
// typed by doing so.
describe("a parent that rewrites the value cannot corrupt what is being typed", () => {
  function EchoHarness() {
    const [value, setValue] = useState("100");
    return (
      <NumberField
        value={value}
        label="Bankroll"
        // Exactly what App.tsx's bankroll field does: empty means "fall back
        // to the buy-in", so clearing produces a NON-empty value.
        onChange={(next) => setValue(next === "" ? "100" : next)}
      />
    );
  }

  it("starts a fresh number after Clear, whatever the parent echoed back", () => {
    render(<EchoHarness />);
    fireEvent.click(screen.getByLabelText("Bankroll"));
    const pad = screen.getByRole("dialog", { name: /bankroll keypad/i });
    fireEvent.click(within(pad).getByRole("button", { name: "Clear" }));
    fireEvent.click(within(pad).getByRole("button", { name: "5" }));
    // Was "1005": the parent's echoed "100" became the base for the 5.
    expect(within(pad).getByTestId("numberpad-value")).toHaveTextContent("5");
  });

  it("shows what was typed, not what the parent substituted", () => {
    render(<EchoHarness />);
    fireEvent.click(screen.getByLabelText("Bankroll"));
    const pad = screen.getByRole("dialog", { name: /bankroll keypad/i });
    fireEvent.click(within(pad).getByRole("button", { name: "Clear" }));
    expect(within(pad).getByTestId("numberpad-value")).toHaveTextContent("-");
  });
});

describe("it reports changes the way a controlled input does", () => {
  it("calls onChange with the string value as digits land", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    open();
    fireEvent.click(key("6"));
    expect(onChange).toHaveBeenCalledWith("6");
  });
});
