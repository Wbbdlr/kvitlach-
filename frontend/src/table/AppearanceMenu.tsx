import { useEffect, useRef, useState } from "react";
import { ChipName, FeltName } from "../theme";
import { useEscapeKey } from "../useEscapeKey";
import { FeltSwitcher } from "./FeltSwitcher";
import { ChipSwitcher } from "./ChipSwitcher";
import { Icon } from "./icons";

export interface AppearanceMenuProps {
  felt: FeltName;
  chip: ChipName;
  onFeltChange: (name: FeltName) => void;
  onChipChange: (name: ChipName) => void;
}

// The felt and chip pickers, behind one button.
//
// They used to sit open in the top chrome: seven colour dots plus two group
// icons, permanently occupying nine slots of a row that also carries How-to,
// music, sound, motion, fullscreen, Reshuffle, the room name and Leave. On a
// landscape phone that row is 61px of a 384px-tall screen, and the dots were
// the largest thing in it that nobody touches twice -- felt colour is set
// once, if ever, and never synced to anyone else.
//
// Collapsed rather than hidden on small screens: a control that exists on
// desktop and silently vanishes on a phone is worse than one that is one tap
// away everywhere, and the two switchers keep their own sizing and
// selection-ring treatment unchanged inside the panel.
export function AppearanceMenu({ felt, chip, onFeltChange, onChipChange }: AppearanceMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEscapeKey(() => setOpen(false), open);

  // Click-outside. Deliberately `pointerdown` rather than `click`: a tap that
  // starts outside and ends on the panel would otherwise close it, and on a
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
        title="Table colors"
        aria-label="Table colors"
      >
        <Icon name="swatch" size={15} />
      </button>
      {open && (
        // Same anchoring as .k-fs-hint, which hangs off this row already: the
        // chrome renders at true viewport size (it is outside .k-fit's scaled
        // stage), so absolute positioning here is not affected by the stage
        // transform. Right-aligned so a panel opening near the row's left
        // edge still lands on screen.
        <div className="k-appearance-panel" role="dialog" aria-label="Table colors">
          <div className="k-appearance-row">
            <span className="k-appearance-label">Felt</span>
            <FeltSwitcher felt={felt} onChange={onFeltChange} />
          </div>
          <div className="k-appearance-row">
            <span className="k-appearance-label">Chips</span>
            <ChipSwitcher chip={chip} onChange={onChipChange} />
          </div>
          <p className="k-appearance-note">Just for your view &mdash; nobody else sees the change.</p>
        </div>
      )}
    </span>
  );
}
