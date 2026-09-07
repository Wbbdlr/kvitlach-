import { DraggablePanel } from "./draggablePanel";
import { Icon } from "./icons";

export interface DockGripsProps {
  dockPanel: Pick<DraggablePanel, "moveProps" | "gripProps" | "moved" | "reset">;
}

// The control bar's move/resize handles, plus the reset button. Rendered
// INSIDE whichever `.k-dock` variant is currently showing (abandoned-banker
// notice, PlayerDock, round-complete panel) rather than once at the
// `.k-dock-row` level above all three.
//
// `.k-dock-row` is not the same box as `.k-dock`: at the compact breakpoint
// the row is deliberately stretched wider than the dock so the dock has room
// to grow (see index.css's own comment on `.k-dock-row { flex: 1 1 auto }`),
// and when it's nobody's turn to render a dock at all the row shrinks to just
// the reaction button. A grip anchored to the ROW's edges in either case
// floats away from the BAR's own visible edges -- reported as "the grabber
// looks like it's floating off on its own", and as leftover grip/reset marks
// sitting in a stale spot that then jump when the next dock variant's
// differently-sized box lands under them. `.k-dock` is already `position:
// relative` (index.css); nesting the grips inside it costs nothing and makes
// them track the bar's ACTUAL box in every state, including the one with no
// bar at all -- where they now simply don't render, rather than floating
// with nothing to grab onto.
export function DockGrips({ dockPanel }: DockGripsProps) {
  return (
    <>
      {/* The move handle is TWO corner marks down the bar's left edge, top
          and bottom -- "the grab handle to move the main controls box should
          be bottom left top left, and should be in the corners, not
          horizontal lines which look weird."
          Two of them rather than one because a corner mark only reads as a
          corner when it is actually IN one, and a single bracket on a bar
          this wide reads as decoration; a matched pair down one edge reads
          as "this edge is the thing you hold". They carry the same
          moveProps, so which one the thumb lands on does not matter.
          The resize grip keeps the top-right corner. It used to sit at the
          bottom-right, which on a phone in landscape is the one corner both
          inside the system gesture bar and under the heel of the thumb
          already holding the device.
          Each stops the event reaching anything else: the bar is full of
          buttons and a bet field, and a press that starts on a grip must not
          also press one of them. */}
      <span className="k-dock-grip move tl" {...dockPanel.moveProps} title="Drag to move the controls" aria-hidden="true" />
      <span className="k-dock-grip move bl" {...dockPanel.moveProps} title="Drag to move the controls" aria-hidden="true" />
      <span className="k-dock-grip size" {...dockPanel.gripProps} title="Drag to resize the controls" aria-hidden="true" />
      {/* Only once it has actually been moved or resized -- an always-visible
          "put it back" on a bar nobody has touched is clutter that explains a
          feature by apologising for it. Same rule as the readout's own
          reset. */}
      {dockPanel.moved && (
        <button
          type="button"
          className="k-dock-reset"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={dockPanel.reset}
          title="Put the controls back where they started"
          aria-label="Put the controls back where they started"
        >
          <Icon name="rotate" size={9} />
        </button>
      )}
    </>
  );
}
