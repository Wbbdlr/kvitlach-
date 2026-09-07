import { fireEvent, screen, within } from "@testing-library/react";

/**
 * Drive a NumberField the way a player does: open its pad, tap keys, Done.
 *
 * Every number input in the app is read-only now (NumberField.tsx -- the
 * phone keyboard covered the felt), so `fireEvent.change` on them does
 * nothing at all. It does not throw either, which is the dangerous part: a
 * test that sets a value that way goes on asserting against whatever the
 * field already held. This helper exists so no test has to know how the pad
 * is built, and so there is one place to change if it ever is.
 */
export function setNumberField(label: string | RegExp, value: string): void {
  const field = numberFieldInput(label);
  // Harmless if the pad is already open (a dialog that autoFocuses its field
  // opens it on mount) -- reopening just restarts the draft from the current
  // value, which is what a fresh set wants anyway.
  fireEvent.click(field);
  const pad = screen.getByRole("dialog", { name: /keypad$/i });
  const key = (name: string) => within(pad).getByRole("button", { name });

  fireEvent.click(key("Clear"));
  const negative = value.trim().startsWith("-");
  for (const ch of value.replace(/[^0-9]/g, "")) fireEvent.click(key(ch));
  if (negative) fireEvent.click(key("Negate"));
  fireEvent.click(key("Done"));
}

/**
 * The input itself, not the pad.
 *
 * The pad's dialog is named "<label> keypad" so the two are distinguishable
 * to a screen reader -- but a REGEX label (`/amount/i`) matches both, and a
 * bare getByLabelText then throws "found multiple elements". Selecting the
 * input by tag is the unambiguous answer and keeps callers from having to
 * know the pad exists.
 */
function numberFieldInput(label: string | RegExp): HTMLElement {
  const matches = screen.getAllByLabelText(label);
  const input = matches.find((el) => el.tagName === "INPUT");
  if (!input) throw new Error(`no number field labelled ${String(label)}`);
  return input;
}

/** True when the field cannot summon the operating system's own keyboard. */
export function suppressesOsKeyboard(label: string | RegExp): boolean {
  const field = numberFieldInput(label);
  return field.hasAttribute("readonly") && field.getAttribute("inputmode") === "none";
}
