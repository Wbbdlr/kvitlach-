import { useRef, useState } from "react";
import { REACTION_EMOJIS, REACTION_PHRASES } from "./selectors";
import { useClickOutside } from "./clickOutside";

export interface ReactionLayerProps {
  onReact: (emoji: string) => void;
  disabled?: boolean;
}

// The reaction picker control -- floating reaction badges over each seat are
// rendered by Seat.tsx/Dealer.tsx directly (driven by latestReactionByPlayer
// from useTableData), so this component is just the send button + popover.
// The caller (TableRoot's .k-chrome-react) is the sole positioning
// authority -- it's part of the unscaled chrome layer, not the scaled
// stage, so this component must stay purely relative/static internally or
// its own absolute offsets stack on top of the wrapper's and drift off
// wherever the wrapper happens to collapse to.
export function ReactionLayer({ onReact, disabled }: ReactionLayerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside([ref], () => setOpen(false), open);

  return (
    <div ref={ref} className="relative z-30">
      {open && (
        <div className="absolute bottom-full right-0 mb-2 w-64 max-w-[80vw] max-h-[42dvh] overflow-y-auto rounded-lg border border-amber-500/30 bg-[rgba(12,20,15,0.96)] p-2 shadow-xl">
          <div className="grid grid-cols-5 gap-1">
            {REACTION_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className="text-lg transition-transform hover:scale-110"
                onClick={() => {
                  onReact(emoji);
                  setOpen(false);
                }}
              >
                {emoji}
              </button>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-1 border-t border-amber-500/20 pt-2" dir="rtl">
            {REACTION_PHRASES.map((phrase) => (
              <button
                key={phrase}
                type="button"
                className="rounded-full border border-amber-500/30 bg-black/20 px-2 py-1 text-xs text-amber-100 transition-transform hover:scale-105"
                onClick={() => {
                  onReact(phrase);
                  setOpen(false);
                }}
              >
                {phrase}
              </button>
            ))}
          </div>
        </div>
      )}
      <button
        type="button"
        className="k-chip-btn h-9 w-9 justify-center p-0 text-lg"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-label="React"
      >
        {REACTION_EMOJIS[0]}
      </button>
    </div>
  );
}
