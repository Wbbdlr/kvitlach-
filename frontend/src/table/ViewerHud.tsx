import { clsx } from "clsx";
import { Turn, RoundPhase } from "../types";
import { totalDisplay, statusDisplay, betDisplay, tagVariant, fullName } from "./selectors";
import { Icon } from "./icons";

export interface ViewerHudProps {
  turn: Turn;
  viewerId?: string;
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
// Part 1. It is flow-laid inside .k-hud-bottom-left alongside the toast stack,
// so neither has to know the other's height.
export function ViewerHud({ turn, viewerId, roundState, walletAmount }: ViewerHudProps) {
  const totalInfo = totalDisplay(turn, viewerId, roundState);
  const statusInfo = statusDisplay(turn);
  const betInfo = betDisplay(turn);
  const name = fullName(turn.player) || turn.player.firstName;

  // Same two distinctions Seat.tsx draws, for the same reason: selectors.ts
  // encodes "concealed" ("hidden", "--") and "bust" in the VALUE, and both have
  // to survive here or every total reads alike.
  const totalIsConcealed = !/^\d/.test(totalInfo.value);
  const totalIsBust = statusInfo.label === "FUTCHED!";
  const isCurrentTurn = turn.state === "pending" && roundState !== "final";
  const showBet = betInfo.label !== "—";
  // Carried over from the seat plate this replaced, where it lived on the
  // avatar. It has to come along: the mark is how you can see you are calling
  // Eleveroon, and dropping it would have left everyone at the table able to
  // see YOUR call except you -- the same shape as the banker's reactions never
  // rendering (ledger F1). Same condition as Seat.tsx's own showEleveroonCall.
  const showEleveroonCall = Boolean(turn.player.type !== "admin" && turn.eleveroonCalled && turn.state === "pending");

  return (
    <div className={clsx("k-viewer-hud", isCurrentTurn && "is-active")}>
      <div className="k-viewer-hud-top">
        {showEleveroonCall && (
          <span className="k-elev-mark is-inline" title="You are calling Eleveroon" aria-label="Calling Eleveroon">
            <Icon name="star" size={9} />
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
        {statusInfo.label && (
          <div className={clsx("k-viewer-hud-tag", tagVariant(statusInfo.label, isCurrentTurn))}>
            {statusInfo.label}
          </div>
        )}
      </div>
    </div>
  );
}
