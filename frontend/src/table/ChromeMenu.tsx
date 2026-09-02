import { ReactNode, useEffect, useRef, useState } from "react";
import { useEscapeKey } from "../useEscapeKey";
import { Icon } from "./icons";

export interface ChromeMenuProps {
  children: ReactNode;
}

// The top chrome's controls, behind one button on a landscape phone.
//
// Exactly the move AppearanceMenu already made one level down, for the same
// reason and one level up: that collapsed nine colour swatches into a button,
// and this collapses what is left of the row.
//
// The row it lives in is `position: absolute` with `flex-wrap: wrap` and
// nothing below it reserved, so every line it wrapped to landed further down
// ON the felt -- at 640x360 its content is ~810px against ~437px of row, and
// Reshuffle / Practice Table / Leave sat on the dealer's plate and a seat
// (ledger #2). stage.ts budgets exactly one row for this (TOP_CHROME_PX = 44);
// the row simply never honoured it.
//
// Bounding it by containment means the row must be unable to wrap, which means
// its contents must fit. Not by `overflow: hidden` (that hides the controls),
// not by shrinking them (44px tap targets are a floor, not a preference) -- by
// putting the ones nobody touches mid-hand one tap away instead of zero. What
// stays inline is what you must be able to see or reach without thinking:
// warnings, and Leave.
//
// Takes children rather than knowing what the controls are, so the SAME JSX
// renders inline on a desktop and inside this panel on a phone. Two renderings
// of one list is how they drift.
export function ChromeMenu({ children }: ChromeMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEscapeKey(() => setOpen(false), open);

  // pointerdown, not click -- see AppearanceMenu's own note: a tap that starts
  // outside and ends on the panel would otherwise close it, and on a
  // touchscreen that is most of them.
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // The wrapper is deliberately NOT `relative`. An open .k-chrome-menu anchors
  // to its nearest positioned ancestor, and while that was this span the menu
  // hung off the BUTTON -- which sits in .k-chrome-top, a flex row whose width
  // is its content. Every chrome control that comes and goes with the round
  // (Reshuffle appearing as the shoe runs down, the room pill changing width)
  // re-flowed that row, slid the button along it, and dragged the open menu
  // across the screen. Reported on mobile as the menu being "pushed around by
  // events happening in the game" -- which is exactly what it was, and why it
  // reads as wrong: a popover is over the table, not part of it.
  //
  // Without `relative` the anchor becomes .k-chrome-top, which is pinned
  // `right: max(8px, env(safe-area-inset-right))`. Its LEFT edge still moves as
  // buttons come and go; its right edge cannot. The menu's own `right: 0`
  // therefore stops moving, and `top: calc(100% + 8px)` still means "just below
  // the row" -- 100% is now the row's height rather than one button's, which is
  // the same 40px. wrapRef is unaffected; it only drives click-outside.
  return (
    <span ref={wrapRef} className="inline-flex">
      <button
        type="button"
        className="k-chip-btn"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Table controls"
        aria-label="Table controls"
      >
        <Icon name="more" size={15} />
      </button>
      {open && (
        <div className="k-chrome-menu" role="dialog" aria-label="Table controls">
          {children}
        </div>
      )}
    </span>
  );
}
