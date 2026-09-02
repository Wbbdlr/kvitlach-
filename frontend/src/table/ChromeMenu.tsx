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

  return (
    <span ref={wrapRef} className="relative inline-flex">
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
