import { useRef, useState } from "react";
import { REACTION_EMOJIS } from "./selectors";
import { useClickOutside } from "./clickOutside";

export interface ReactionLayerProps {
  onReact: (emoji: string) => void;
  disabled?: boolean;
}

// The reaction picker control -- floating reaction badges over each seat are
// rendered by Seat.tsx/Dealer.tsx directly (driven by latestReactionByPlayer
// from useTableData), so this component is just the send button + popover.
// Absolutely positioned within the stage (not fixed) so it scales with it.
export function ReactionLayer({ onReact, disabled }: ReactionLayerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside([ref], () => setOpen(false), open);

  return (
    <div ref={ref} className="absolute right-4 z-30" style={{ bottom: "100px" }}>
      {open && (
        <div className="mb-2 grid grid-cols-5 gap-1 rounded-lg border border-amber-500/30 bg-[rgba(12,20,15,0.96)] p-2 shadow-xl">
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
