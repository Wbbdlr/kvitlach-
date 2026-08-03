import { clsx } from "clsx";
import { FELTS, FeltName } from "../theme";

const FELT_ORDER: FeltName[] = ["green", "burgundy", "navy"];

export interface FeltSwitcherProps {
  felt: FeltName;
  onChange: (name: FeltName) => void;
}

// A per-user preference (like sound/music), never synced to other players.
// Swatch colors retint the table AND the bet/hit/stand dock buttons together.
// Rendered inside the topbar's utility cluster -- deliberately NOT fixed
// positioned, since anything fixed escapes the scaled stage's transform.
export function FeltSwitcher({ felt, onChange }: FeltSwitcherProps) {
  return (
    <div className="flex items-center gap-1">
      {FELT_ORDER.map((name) => (
        // The swatch stays 20px -- three big circles would dominate a row of
        // otherwise-subtle chrome -- but the button around it is 28px, because
        // three 20px targets sitting 4px apart is a mis-tap waiting to happen
        // on a phone, and a mis-tap here silently repaints someone's table
        // mid-hand.
        <button
          key={name}
          type="button"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
          title={FELTS[name].label}
          aria-label={`Switch to ${FELTS[name].label} felt`}
          onClick={() => onChange(name)}
        >
          <span
            className={clsx(
              "block h-5 w-5 rounded-full border transition-transform",
              felt === name ? "border-amber-400 scale-110" : "border-white/30"
            )}
            style={{ background: FELTS[name].hi }}
          />
        </button>
      ))}
    </div>
  );
}
