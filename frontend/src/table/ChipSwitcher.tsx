import { clsx } from "clsx";
import { CHIPS, ChipName } from "../theme";

const CHIP_ORDER: ChipName[] = ["gold", "ruby", "sapphire", "silver"];

export interface ChipSwitcherProps {
  chip: ChipName;
  onChange: (name: ChipName) => void;
}

// A per-user preference (like FeltSwitcher, which this mirrors exactly --
// same sizing, same selection-ring treatment), never synced to other
// players. Recolors .k-chip-btn -- the floating pill chrome (Reshuffle,
// Leave, Skip, React, felt/chip swatches themselves) -- and nothing else on
// the felt; see theme.ts's own comment on why that's a deliberate boundary,
// not an oversight. Rendered inside the topbar's utility cluster, next to
// FeltSwitcher -- deliberately NOT fixed positioned, since anything fixed
// escapes the scaled stage's transform.
export function ChipSwitcher({ chip, onChange }: ChipSwitcherProps) {
  return (
    <div className="flex items-center gap-1">
      {CHIP_ORDER.map((name) => (
        // Same 20px swatch / 28px tap-target split as FeltSwitcher, for the
        // same reason: three 20px targets 4px apart is a mis-tap waiting to
        // happen on a phone.
        <button
          key={name}
          type="button"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
          title={CHIPS[name].label}
          aria-label={`Switch to ${CHIPS[name].label} chip color`}
          onClick={() => onChange(name)}
        >
          <span
            className={clsx(
              "block h-5 w-5 rounded-full border transition-transform",
              chip === name ? "border-amber-400 scale-110" : "border-white/30"
            )}
            style={{ background: CHIPS[name].swatch }}
          />
        </button>
      ))}
    </div>
  );
}
