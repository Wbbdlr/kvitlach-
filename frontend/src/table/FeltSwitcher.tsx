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
        <button
          key={name}
          type="button"
          className={clsx(
            "h-5 w-5 rounded-full border transition-transform",
            felt === name ? "border-amber-400 scale-110" : "border-white/30"
          )}
          style={{ background: FELTS[name].hi }}
          title={FELTS[name].label}
          aria-label={`Switch to ${FELTS[name].label} felt`}
          onClick={() => onChange(name)}
        />
      ))}
    </div>
  );
}
