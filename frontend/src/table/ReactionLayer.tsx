import { useRef, useState } from "react";
import { REACTION_EMOJIS, REACTION_PHRASES, REACTION_GAME_CALLS } from "./selectors";
import { useClickOutside } from "./clickOutside";
import { StageOverlay } from "./StageOverlay";

export interface ReactionLayerProps {
  onReact: (emoji: string) => void;
  disabled?: boolean;
}

/** The popover's own width, as set on the box below. */
const PICKER_W = 340;
/** Breathing room between the popover and the button, and the popover and the screen edge. */
const GAP_PX = 8;
const EDGE_PX = 8;

interface Anchor {
  /** Real viewport px, from the button's own getBoundingClientRect. */
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
  maxHeight: number;
}

// The reaction picker control -- floating reaction badges over each seat are
// rendered by Seat.tsx/Dealer.tsx directly (driven by latestReactionByPlayer
// from useTableData), so this component is just the send button + popover.
//
// The popover is portalled through StageOverlay, same as every other overlay
// in this codebase and for the same two reasons. It rides inside
// .k-dock-row, the control bar, which (a) sits inside .k-controls -- z-index
// 25, position: relative, so it opens a stacking context nothing inside it
// can climb past, which is why the "Table ready" panel (z 42) used to draw
// over an open picker between rounds -- and (b) itself carries a scale
// transform once the player has resized the bar, which would shrink the
// picker's tap targets right along with it (measured on the manage drawer
// before it was portalled: 197x170 physical px with ~8px text). Portalling
// escapes both: the popover paints at true viewport scale, above every other
// layer, positioned from the button's real on-screen rect rather than from
// CSS the picker no longer shares an ancestor with.
export function ReactionLayer({ onReact, disabled }: ReactionLayerProps) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<Anchor>({ maxHeight: 0 });
  const wrapRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  useClickOutside([wrapRef, popoverRef], () => setOpen(false), open);

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      // getBoundingClientRect is already in real viewport px regardless of
      // any transform on an ancestor -- the browser resolves that for us --
      // so a bar the player has dragged to any corner, at any scale, anchors
      // the popover correctly with no knowledge of the bar's own CSS.
      const above = rect.top - GAP_PX - EDGE_PX;
      const below = window.innerHeight - rect.bottom - GAP_PX - EDGE_PX;
      const up = above >= below;
      const alignRight = rect.right - PICKER_W >= EDGE_PX;
      setAnchor({
        ...(up ? { bottom: window.innerHeight - rect.top + GAP_PX } : { top: rect.bottom + GAP_PX }),
        ...(alignRight ? { right: window.innerWidth - rect.right } : { left: rect.left }),
        maxHeight: Math.max(120, up ? above : below),
      });
    }
    setOpen(true);
  };

  return (
    <div ref={wrapRef} className="relative z-30">
      {open && (
        <StageOverlay>
          {/* Seven columns rather than five takes 26 emoji from six rows to
              four, and the wider box lets the phrase chips settle in fewer
              rows -- together that is ~90px, which is the difference between
              scrolling and fitting on a landscape phone. A fixed max-height
              was tried first and was wrong twice for the same reason: it
              assumed where the bar was, rather than measuring where it
              actually ended up. */}
          <div
            ref={popoverRef}
            // z-[60], matching --z-hud-popover's raw value (docs/mobile-ui.md
            // Part 3) -- the same tier ChromeMenu and the appearance panel
            // use for a button-anchored popover. Those two stay position:
            // absolute because their own ancestor is the unscaled chrome
            // layer; this one is portalled instead, which is why it needs
            // position: fixed and real coordinates rather than a percentage.
            className="fixed z-[60] w-[min(92vw,340px)] overflow-y-auto overscroll-contain rounded-lg border border-amber-500/30 bg-[rgba(12,20,15,0.96)] p-2 shadow-xl"
            style={{
              top: anchor.top,
              bottom: anchor.bottom,
              left: anchor.left,
              right: anchor.right,
              maxHeight: anchor.maxHeight || undefined,
            }}
          >
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
        </StageOverlay>
      )}
      <button
        ref={buttonRef}
        type="button"
        className="k-chip-btn h-9 w-9 justify-center p-0 text-lg"
        onClick={toggle}
        disabled={disabled}
        aria-label="React"
      >
        {REACTION_EMOJIS[0]}
      </button>
    </div>
  );
}
