import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { clsx } from "clsx";
import { useEscapeKey } from "./useEscapeKey";

// Our own number pad, instead of the phone's.
//
// Asked for after playing 11.5 on an Android phone: the on-screen keyboard
// "is huge and blocks most of the screen." A web page cannot size an IME --
// there is no API for it, and `inputmode="numeric"` only ASKS for a numeric
// pad, which Android in landscape routinely ignores and renders fullscreen
// over the felt anyway. The only real fix is to stop summoning one.
//
// So the field is `readOnly` (which is what actually suppresses the keyboard)
// plus `inputMode="none"` (the explicit signal, belt-and-braces), and tapping
// it opens a pad we draw ourselves, at a size we choose, inside the felt.
//
// A physical keyboard still works while the pad is open -- digits, Backspace,
// Enter, Escape. Without that, making the field read-only would take typing
// away from every desktop player to fix a phone problem.

const MAX_DIGITS = 9;

/** Keys in reading order. Bottom row is Clear / 0 / Backspace. */
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

interface Anchor {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
}

const GAP_PX = 8;
const EDGE_PX = 8;
// Nominal pad size, used only to decide which way it opens. The rendered pad
// is sized by CSS; these are the numbers the flip heuristic measures against,
// the same shape ReactionLayer and the quick-bet tray already use.
const PAD_W = 208;
// The full-size pad. index.css tightens both on a landscape phone (180x247);
// these only decide which SIDE of the field the pad opens on, so erring
// towards the larger figure just means it flips up/left a little sooner than
// it strictly must.
const PAD_H = 292;

function anchorTo(rect: DOMRect): Anchor {
  const above = rect.top - GAP_PX - EDGE_PX;
  const below = window.innerHeight - rect.bottom - GAP_PX - EDGE_PX;
  // Open toward whichever side actually has room for the whole pad, and if
  // neither does, toward the roomier one -- measured against the real
  // viewport rather than assumed from where the field usually sits.
  const up = above >= PAD_H || above >= below;
  const alignRight = rect.right - PAD_W >= EDGE_PX;
  return {
    ...(up ? { bottom: window.innerHeight - rect.top + GAP_PX } : { top: rect.bottom + GAP_PX }),
    ...(alignRight ? { right: Math.max(EDGE_PX, window.innerWidth - rect.right) } : { left: Math.max(EDGE_PX, rect.left) }),
  };
}

export interface NumberFieldProps {
  value: string;
  onChange: (next: string) => void;
  /** Accessible name. Also names the pad's dialog. */
  label: string;
  /** Clamped up to this when the pad closes. Omit to allow an empty field. */
  min?: number;
  /** Clamped down to this when the pad closes. */
  max?: number;
  className?: string;
  placeholder?: string;
  id?: string;
  disabled?: boolean;
  /**
   * Adds a sign key. Off by default and deliberately opt-in: the banker's
   * chip adjustment genuinely means "negative removes chips", and every other
   * number in this app would be wrong to accept one.
   */
  allowNegative?: boolean;
  /** Open the pad as soon as this mounts -- for a dialog that exists to
   *  collect one number, where the field would otherwise need a tap first. */
  autoFocus?: boolean;
}

export function NumberField({
  value,
  onChange,
  label,
  min,
  max,
  className,
  placeholder,
  id,
  disabled,
  allowNegative,
  autoFocus,
}: NumberFieldProps) {
  const [open, setOpen] = useState(false);
  // Whether this open session has put a digit down yet. The first digit
  // REPLACES what was there, later ones append -- same reasoning as the
  // quick-bet tray's first-tap rule: the field arrives holding something (a
  // default, or the last amount), and a pad that appended to it would turn a
  // tap of "2" into "52".
  const [typed, setTyped] = useState(false);
  // What is being typed, owned by the pad from the moment it opens until Done.
  //
  // Deliberately NOT read back off the `value` prop each keypress. A
  // controlled parent is free to transform what it is handed -- App.tsx's
  // bankroll field answers "" by substituting the buy-in -- and reading the
  // echo back as "the digits so far" let that substitution become the base
  // for the next key: Clear then 5 produced "1005". The pad owns the sequence;
  // the parent owns what it does with each value it is given.
  const [draft, setDraft] = useState(value);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const padRef = useRef<HTMLDivElement>(null);

  const push = (next: string) => {
    setDraft(next);
    onChange(next);
  };

  const commit = () => {
    // Clamping happens on CLOSE, not per keystroke: clamping as digits land
    // makes "12" impossible to type when max is 15 (the "1" would jump to
    // 15), which is the classic way a bounded numeric input becomes
    // unusable.
    const negative = allowNegative && draft.trim().startsWith("-");
    let next = draft.replace(/\D/g, "");
    if (next === "") {
      if (min === undefined) {
        push("");
        return;
      }
      next = String(min);
    }
    let n = Number(next) * (negative ? -1 : 1);
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    push(String(n));
  };

  const close = () => {
    commit();
    setOpen(false);
  };

  useEscapeKey(close, open);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (padRef.current?.contains(target)) return;
      if (inputRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, value, min, max]);

  // A real keyboard, when there is one. Bound to the document rather than the
  // pad so it works without the player having to focus anything inside it --
  // the field they tapped is read-only and keeps focus.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key >= "0" && e.key <= "9") {
        e.preventDefault();
        press(e.key);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        press("Backspace");
      } else if (e.key === "Enter") {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, value, typed, min, max]);

  useEffect(() => {
    if (!autoFocus) return;
    setTyped(false);
    setDraft(value);
    setOpen(true);
    // Mount only: re-opening whenever `value` changed would make the pad
    // impossible to close.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    const rect = inputRef.current?.getBoundingClientRect();
    if (rect) setAnchor(anchorTo(rect));
  }, [open]);

  const press = (k: string) => {
    if (k === "Clear") {
      setTyped(true);
      push("");
      return;
    }
    if (k === "Negate") {
      // Sign is a property of the amount, not a digit, so it survives
      // everything else -- toggle it whenever, before or after typing.
      setTyped(true);
      const digits = draft.replace(/-/g, "");
      push(draft.startsWith("-") ? digits : `-${digits}`);
      return;
    }
    const sign = draft.startsWith("-") ? "-" : "";
    const digits = draft.replace(/-/g, "");
    if (k === "Backspace") {
      setTyped(true);
      const left = digits.slice(0, -1);
      // Dropping the last digit must not leave a bare "-", which is neither
      // a number nor empty.
      push(left === "" ? "" : sign + left);
      return;
    }
    const base = typed ? digits : "";
    if (base.length >= MAX_DIGITS) return;
    // No leading zeros -- "007" is not a number anyone meant to type, and it
    // reads as a bug on the plate next to a real amount.
    const next = base === "0" ? k : base + k;
    setTyped(true);
    push((typed ? sign : "") + next);
  };

  const openPad = () => {
    if (disabled) return;
    setTyped(false);
    setDraft(value);
    setOpen(true);
  };

  const padKey = (k: string, extra?: string) => (
    <button
      key={k}
      type="button"
      className={clsx("k-numpad-key", extra)}
      onClick={() => press(k)}
      aria-label={k}
    >
      {k === "Backspace" ? "⌫" : k === "Clear" ? "C" : k}
    </button>
  );

  return (
    <>
      <input
        ref={inputRef}
        id={id}
        type="text"
        // readOnly is what actually stops the on-screen keyboard; inputMode
        // "none" states the intent for browsers that would offer one anyway.
        readOnly
        inputMode="none"
        role="spinbutton"
        aria-valuenow={(open ? draft : value) === "" ? undefined : Number(open ? draft : value)}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={className}
        placeholder={placeholder}
        // While the pad is open it is the authority on what is being typed.
        value={open ? draft : value}
        disabled={disabled}
        onClick={openPad}
        onFocus={openPad}
        onChange={() => {
          /* read-only: every change comes through the pad */
        }}
      />
      {open &&
        anchor &&
        createPortal(
          <div
            ref={padRef}
            role="dialog"
            aria-modal="false"
            // Distinct from the field's own name on purpose: sharing it makes
            // "the thing labelled Bet amount" ambiguous to both a screen
            // reader and a test, and the pad is a different object from the
            // value it edits.
            aria-label={`${label} keypad`}
            className="k-numpad"
            style={{ position: "fixed", ...anchor }}
          >
            <div className="k-numpad-value" data-testid="numberpad-value">
              {draft === "" ? "-" : draft}
            </div>
            <div className="k-numpad-grid">
              {KEYS.map((k) => padKey(k))}
              {padKey("Clear", "is-alt")}
              {padKey("0")}
              {padKey("Backspace", "is-alt")}
            </div>
            <div className="k-numpad-foot">
              {allowNegative && (
                <button
                  type="button"
                  className="k-numpad-key is-alt"
                  onClick={() => press("Negate")}
                  aria-label="Negate"
                  title="Switch between adding and removing chips"
                >
                  &plusmn;
                </button>
              )}
              <button type="button" className="k-numpad-done" onClick={close}>
                Done
              </button>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
