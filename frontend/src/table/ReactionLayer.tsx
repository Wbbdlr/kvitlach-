import { useRef, useState } from "react";
import { REACTION_EMOJIS, REACTION_PHRASES, REACTION_GAME_CALLS } from "./selectors";
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
      {/* Sized to actually FIT rather than to a fraction of the screen.
          `max-h-[42dvh]` is 151px on a 360px-tall landscape phone against
          ~350px of content, so the scroll boundary landed in the middle of
          an emoji row and the picker read as cut off -- reported twice now.
          The popover opens upward from the react button (bottom-full), so
          the space genuinely available is everything above it, not 42% of
          anything; 72px covers the button (36), its margin (8) and the top
          inset, and was measured -- at 80 the content was still 8px over.
          Known and NOT fixed here: .k-controls carries z-index 25 and
          position: relative, so it opens a stacking context and everything in
          this picker is capped below it. The pre-round "Table ready" panel
          (z 42) therefore draws over the open picker between rounds. Raising
          the picker cannot reach past its own context, and raising .k-controls
          would put the whole dock above every announcement -- the one ordering
          Part 3 of docs/mobile-ui.md deliberately fixes. The real fix is to
          portal this through StageOverlay like the other overlays, which needs
          real coordinates instead of bottom-full/right-0.
          Seven columns rather than five takes 26 emoji from six rows to
          four, and the wider box lets the phrase chips settle in fewer
          rows -- together that is ~90px, which is the difference between
          scrolling and fitting. */}
      {open && (
        <div className="absolute bottom-full right-0 mb-2 w-[min(92vw,340px)] max-h-[calc(100dvh_-_72px)] overflow-y-auto overscroll-contain rounded-lg border border-amber-500/30 bg-[rgba(12,20,15,0.96)] p-2 shadow-xl">
          <div className="grid grid-cols-7 gap-1">
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
          <div className="mt-2 flex flex-wrap gap-1 border-t border-amber-500/20 pt-2">
            {REACTION_GAME_CALLS.map((call) => (
              <button
                key={call}
                type="button"
                className="rounded-full border border-amber-500/30 bg-black/20 px-2 py-1 text-xs text-amber-100 transition-transform hover:scale-105"
                onClick={() => {
                  onReact(call);
                  setOpen(false);
                }}
              >
                {call}
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
