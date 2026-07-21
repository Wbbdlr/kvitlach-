import { clsx } from "clsx";
import { FELTS, FeltName } from "../theme";

const FELT_ORDER: FeltName[] = ["green", "burgundy", "navy"];

export interface FeltSwitcherProps {
  felt: FeltName;
  onChange: (name: FeltName) => void;
}

// A per-user preference (like sound/music), never synced to other players.
// Swatch colors retint the table AND the bet/hit/stand dock buttons together.
export function FeltSwitcher({ felt, onChange }: FeltSwitcherProps) {
  return (
    <div className="fixed top-12 left-2 z-30 flex items-center gap-1 rounded-full bg-white/95 px-2 py-1.5 shadow">
      {FELT_ORDER.map((name) => (
        <button
          key={name}
          type="button"
          className={clsx(
            "h-6 w-6 rounded-full border-2 transition-transform",
            felt === name ? "border-slate-700 scale-110" : "border-white"
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
