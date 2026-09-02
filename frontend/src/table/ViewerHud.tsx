import { clsx } from "clsx";
import { useRef } from "react";
import { Turn, RoundPhase } from "../types";
import { totalDisplay, statusDisplay, betDisplay, tagVariant, fullName } from "./selectors";
import { Icon } from "./icons";
import { useDraggablePanel } from "./draggablePanel";

export interface ViewerHudProps {
  turn: Turn;
  viewerId?: string;
  /**
   * Whether the table is actually waiting on YOU right now. Not derivable from
   * `turn` alone -- every unplayed turn in the round is `pending`, so without
   * this the panel called itself active for the whole round and, worse, showed
   * statusDisplay's "Waiting..." while your own timer bar was running down.
   * Comes from useTableData's activeTurnId, the same source Seat.tsx uses.
   */
  isActiveTurn?: boolean;
  isNextTurn?: boolean;
  roundState?: RoundPhase;
  walletAmount?: number;
}

// Your own name, money and total -- in your own corner, not on the table.
//
// This used to be an ordinary seat plate on the felt's bottom-centre arc, and
// it was the LOWER of the two walls that made the centre column unsolvable: the
// dealer's box came down from the top, this came up from the bottom, and at
// 844x390 the two met with nothing between them. Everything that has ever been
// asked to sit in that gap -- the bank pill, the dealer's status row, a
// reaction bubble -- was competing with this. Moving it out does not shuffle
// the problem along; it removes one of the two walls.
//
// Deliberately NOT the same markup as the on-table plates. Those exist to say
// "this is someone else, sitting over there", and their whole job is being
// findable at a glance around an oval. This one is you, in a fixed corner you
// never have to search for, so it is a compact readout rather than a portrait:
// no avatar (you know who you are), no online dot (you can see the game is
// running), no stats button (yours is in the dock).
//
// Lives in the HUD frame at true viewport pixels -- see docs/mobile-ui.md
// Part 1. Untouched, it is laid out by .k-dock-stack, above the dock (it left
// .k-hud-bottom-left when the toasts took the other corner). Once a player
// drags it, it stops taking its position from the layout at all and becomes
// viewport-fixed -- see draggablePanel.ts for why that split has to exist.
export function ViewerHud({
  turn,
  viewerId,
  isActiveTurn,
  isNextTurn,
  roundState,
  walletAmount,
}: ViewerHudProps) {
  // Draggable and resizable, because there is no one right corner for it --
  // see draggablePanel.ts. Untouched, it renders exactly where it always did.
  const panelRef = useRef<HTMLDivElement>(null);
  const { panelProps, gripProps, moved, reset } = useDraggablePanel(panelRef, "viewerHud");
  const totalInfo = totalDisplay(turn, viewerId, roundState);
  const statusInfo = statusDisplay(turn);
  const betInfo = betDisplay(turn);
  const name = fullName(turn.player) || turn.player.firstName;

  // Same two distinctions Seat.tsx draws, for the same reason: selectors.ts
  // encodes "concealed" ("hidden", "--") and "bust" in the VALUE, and both have
  // to survive here or every total reads alike.
  const totalIsConcealed = !/^\d/.test(totalInfo.value);
  const totalIsBust = statusInfo.label === "FUTCHED!";
  // Same three lines as Seat.tsx:115 and :157, because this panel IS the
  // viewer's seat plate -- it was lifted out of the felt and the plate's
  // turn logic did not come with it. statusDisplay() only sees the turn, and
  // an unplayed turn is `pending` whether the table is waiting on you or on
  // someone four seats away, so it answered "Waiting..." to both. Your own
  // timer bar was winding down beside a tag telling you to wait.
  const isCurrentTurn = Boolean(isActiveTurn && turn.state === "pending" && roundState !== "terminate");
  const isNextPlayer = Boolean(isNextTurn && !isCurrentTurn && turn.state === "pending" && roundState !== "terminate");
  const tagLabel = isNextPlayer ? "Up next" : isCurrentTurn ? "Your turn" : statusInfo.label;
  const tagClass = isNextPlayer ? "muted" : tagVariant(statusInfo.label, isCurrentTurn);
  const showBet = betInfo.label !== "—";
  // Carried over from the seat plate this replaced, where it lived on the
  // avatar. It has to come along: the mark is how you can see you are calling
  // Eleveroon, and dropping it would have left everyone at the table able to
  // see YOUR call except you -- the same shape as the banker's reactions never
  // rendering (ledger F1). Same condition as Seat.tsx's own showEleveroonCall.
  const showEleveroonCall = Boolean(turn.player.type !== "admin" && turn.eleveroonCalled && turn.state === "pending");

  return (
    <div
      ref={panelRef}
      className={clsx("k-viewer-hud", isCurrentTurn && "is-active", moved && "is-moved")}
      {...panelProps}
      title="Drag to move -- grab the corner to resize"
    >
      <div className="k-viewer-hud-top">
        {showEleveroonCall && (
          <span className="k-elev-mark is-inline" title="You are calling Eleveroon" aria-label="Calling Eleveroon">
            <Icon name="magen" size={9} />
          </span>
        )}
        <span className="k-viewer-hud-name">{name}</span>
        <span className="k-viewer-hud-sub">
          {typeof walletAmount === "number" && <>${walletAmount.toLocaleString()}</>}
          {showBet && (
            <>
              {typeof walletAmount === "number" ? " · " : ""}
              <span className={betInfo.className}>{betInfo.label}</span>
            </>
          )}
        </span>
      </div>
      {/* Deliberately NOT .k-readout / .k-tag. Those are stage-native classes:
          they counter-scale their font against --stage-scale so they stay
          legible as the felt shrinks. This panel is in the HUD frame and is not
          scaled at all, so borrowing them rendered it at 2x on a 640x360 phone
          (stage-scale 0.5) -- a readout taller than the dock. Flat px here, the
          same rule .k-banktotal follows in reverse now that it is back inside
          the stage. */}
      <div className="k-viewer-hud-row">
        <div className={clsx("k-viewer-hud-total", totalIsConcealed && "is-muted", totalIsBust && "is-bust")}>
          {totalInfo.prefix} <b>{totalInfo.value}</b>
        </div>
        {tagLabel && <div className={clsx("k-viewer-hud-tag", tagClass)}>{tagLabel}</div>}
      </div>
      {/* Only once it has been moved: an always-visible "put it back" on a
          panel nobody has touched is clutter that explains a feature by
          apologising for it. Double-click on desktop, long-press-free tap
          target on a phone -- it is a button either way. */}
      {moved && (
        <button
          type="button"
          className="k-viewer-hud-reset"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={reset}
          title="Put the readout back"
          aria-label="Put the readout back"
        >
          <Icon name="rotate" size={9} />
        </button>
      )}
      {/* The resize grip. Its own pointer handler, and it stops the event
          reaching the panel's -- otherwise the same press would start a move
          and a resize at once. */}
      <span
        className="k-viewer-hud-grip"
        aria-hidden="true"
        onPointerDown={(event) => {
          event.stopPropagation();
          gripProps.onPointerDown(event);
        }}
      />
    </div>
  );
}
