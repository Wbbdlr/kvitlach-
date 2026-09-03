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
      {/* Both grips on the TOP edge, asked for directly ("the dragger needs
          to be on the top right and left, and we should be able to move the
          control bar too"). The resize grip used to be in the bar's
          bottom-right corner, which on a phone in landscape is the one
          corner sitting in the gesture bar and under the heel of a thumb
          already holding the device -- the top edge is the only edge of this
          bar with nothing behind it.
          Each stops the event reaching anything else: the bar is full of
          buttons and a bet field, and a press that starts on a grip must not
          also press one of them. */}
      <span className="k-dock-grip move" {...dockPanel.moveProps} title="Drag to move the controls" aria-hidden="true" />
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
