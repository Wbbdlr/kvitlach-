import { useRef, useState } from "react";
import { REACTION_EMOJIS } from "./selectors";
import { useClickOutside } from "./clickOutside";

export interface ReactionLayerProps {
  onReact: (emoji: string) => void;
  disabled?: boolean;
}

// The reaction picker control — floating reaction badges over each seat are
// rendered by Seat.tsx/Dealer.tsx directly (driven by latestReactionByPlayer
// from useTableData), so this component is just the send button + popover.
export function ReactionLayer({ onReact, disabled }: ReactionLayerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside([ref], () => setOpen(false), open);

  return (
    <div ref={ref} className="fixed bottom-20 right-3 z-30">
      {open && (
        <div className="mb-2 grid grid-cols-5 gap-1 rounded-lg bg-white shadow-lg border border-slate-200 p-2">
          {REACTION_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className="text-lg hover:scale-110 transition-transform"
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
        className="h-11 w-11 rounded-full bg-white shadow-lg border border-slate-200 flex items-center justify-center text-lg"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-label="React"
      >
        {REACTION_EMOJIS[0]}
      </button>
    </div>
  );
}
