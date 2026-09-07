import { useRef, useState } from "react";
import { Turn } from "../types";
import { Icon } from "./icons";
import { NumberField } from "../NumberField";
import { StageOverlay } from "./StageOverlay";
import { useEscapeKey } from "../useEscapeKey";
import { useDialogFocus } from "../useDialogFocus";
import { useClickOutside } from "./clickOutside";
import { DraggablePanel } from "./draggablePanel";
import { DockGrips } from "./DockGrips";

const DEFAULT_BET = 5;
const BET_STEP = 1;
// Player-requested, 2026-09-03: a one-tap way to reach a common amount
// instead of typing it or walking the +/- stepper up one dollar at a time.
const QUICK_BET_CHIPS = [5, 10, 25];
// Same two constants ReactionLayer.tsx's own picker uses, for the same
// anchor math -- breathing room between the panel and the trigger, and
// between the panel and the screen edge.
const QUICKBET_GAP_PX = 8;
const QUICKBET_EDGE_PX = 8;

interface QuickBetAnchor {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
}

export interface PlayerDockProps {
  turn: Turn;
  wallet: number;
  bankAvailable?: number;
  bankIncrement: number;
  canBank: boolean;
  bankDisabledReason?: string;
  onBet: (amount: number, options: { bank: boolean; eleveroon: boolean }) => void;
  onHit: (options: { eleveroon: boolean }) => void;
  onStand: () => void;
  /** Move/resize grips render INSIDE this dock's own box -- see DockGrips's comment. */
  dockPanel: Pick<DraggablePanel, "moveProps" | "gripProps" | "moved" | "reset">;
}

// Control dock for the viewer's own active turn, styled as the mockup's
// dark gradient bar with a gold top hairline (not a white toolbar). Bet
// defaults to $5 with a +/- $5 stepper; Eleveroon defaults OFF for players
// (the banker's is always-on and handled by Dealer.tsx); the draw button
// relabels Blatt -> Hit the moment a real wager lands, driven off the
// server-authoritative turn.bet rather than a local flag.
export function PlayerDock({
  turn,
  wallet,
  bankAvailable,
  bankIncrement,
  canBank,
  bankDisabledReason,
  onBet,
  onHit,
  onStand,
  dockPanel,
}: PlayerDockProps) {
  // Tracked as a string (not a number) so the field can sit empty mid-edit
  // while the player retypes it -- a number-backed value would fight any
  // attempt to clear the field before entering a new amount.
  const [betAmount, setBetAmount] = useState(String(DEFAULT_BET));
  const [eleveroonSelected, setEleveroonSelected] = useState(false);
  const [betError, setBetError] = useState<string | undefined>(undefined);
  const [bankConfirmOpen, setBankConfirmOpen] = useState(false);
  useEscapeKey(() => setBankConfirmOpen(false), bankConfirmOpen);
  const dialogRef = useDialogFocus<HTMLDivElement>(bankConfirmOpen);

  // Player-requested, 2026-09-03: collapsed behind a trigger rather than
  // sitting permanently in the row (the first version did that, and the dock
  // is already the tightest-budgeted row in the whole UI -- see the compact
  // media query below).
  //
  // Portalled, same as ReactionLayer.tsx's own picker and for the same
  // reason: it needs to open UPWARD (asked for directly -- a sideways panel
  // was reported overlapping Bet/Blatt/Stand), and upward from this trigger
  // lands in the same real estate .k-viewer-hud occupies (bottom: 100% of
  // this same dock's own left edge). A non-portalled panel there is capped
  // by .k-dock's own low z-index (25, deliberately, so
  // .k-preround/.k-bank-banner/.k-bank-decision can always draw over the
  // whole bar) and can never outrank a sibling sitting outside it -- see
  // Seat.tsx's reactionAnchor comment, the identical fight, same fix.
  // Two refs in useClickOutside, not one: the trigger's own wrapper AND the
  // portalled panel, since a click landing inside the (now-elsewhere-in-the-
  // DOM) panel is not "outside" either.
  const [quickBetOpen, setQuickBetOpen] = useState(false);
  // Whether this open session of the tray has already put a chip down -- see
  // setQuickBet for why the first tap behaves differently from the rest.
  const [quickBetStacked, setQuickBetStacked] = useState(false);
  const [quickBetAnchor, setQuickBetAnchor] = useState<QuickBetAnchor | null>(null);
  const quickBetRef = useRef<HTMLSpanElement>(null);
  const quickBetTriggerRef = useRef<HTMLButtonElement>(null);
  const quickBetPanelRef = useRef<HTMLDivElement>(null);
  useEscapeKey(() => setQuickBetOpen(false), quickBetOpen);
  useClickOutside([quickBetRef, quickBetPanelRef], () => setQuickBetOpen(false), quickBetOpen);

  const toggleQuickBet = () => {
    if (quickBetOpen) {
      setQuickBetOpen(false);
      return;
    }
    const rect = quickBetTriggerRef.current?.getBoundingClientRect();
    if (rect) {
      // Same up-vs-down, left-vs-right heuristic as ReactionLayer.tsx's own
      // picker: whichever side actually has the room, measured against the
      // real viewport rather than assumed from where the dock usually sits
      // -- correct even once the player has dragged the bar somewhere else.
      const above = rect.top - QUICKBET_GAP_PX - QUICKBET_EDGE_PX;
      const below = window.innerHeight - rect.bottom - QUICKBET_GAP_PX - QUICKBET_EDGE_PX;
      const up = above >= below;
      const alignRight = rect.right - 160 >= QUICKBET_EDGE_PX;
      setQuickBetAnchor({
        ...(up ? { bottom: window.innerHeight - rect.top + QUICKBET_GAP_PX } : { top: rect.bottom + QUICKBET_GAP_PX }),
        ...(alignRight ? { right: window.innerWidth - rect.right } : { left: rect.left }),
      });
    }
    setQuickBetStacked(false);
    setQuickBetOpen(true);
  };

  const hasBet = (turn.bet ?? 0) > 0;
  const drawLabel = hasBet ? "Hit" : "Blatt";

  const adjustBet = (delta: number) => {
    setBetAmount((prev) => String(Math.max(1, Math.floor(Number(prev) || 0) + delta)));
    setBetError(undefined);
  };

  const handleAmountChange = (raw: string) => {
    // Digits only, and allow empty while the player is mid-retype.
    if (raw !== "" && !/^\d*$/.test(raw)) return;
    setBetAmount(raw);
    setBetError(undefined);
  };


  // Fills in the most the player can bet right now -- their own chips, or
  // the bank's remaining window, whichever is smaller.
  //
  // This used to stop $1 SHORT whenever the bank was the binding constraint,
  // because applyBet auto-treats a bet landing exactly on the bank's
  // available amount as a bank-lock, and the nudge kept a MAX tap from
  // silently becoming an all-in showdown. Reported as a bug on its own terms
  // (2026-09-06): "max bet would not let me wager all that the banker had
  // available", and the owner's call was that a button named MAX must mean
  // max -- if that triggers a BANK! showdown, say so rather than quietly
  // wagering a dollar less than asked. So the amount is honest now and the
  // warning below carries the meaning the nudge used to carry silently.
  const maxBettable = Math.max(0, Math.min(wallet - (turn.bet ?? 0), bankIncrement));
  // True when taking MAX would land exactly on the bank's window, which is
  // what makes it a bank-lock -- same condition applyBet itself uses.
  const maxTriggersBank = maxBettable > 0 && maxBettable === bankIncrement;

  const handleMax = () => {
    if (maxBettable < 1) return;
    setBetAmount(String(maxBettable));
    setBetError(undefined);
  };

  // Sets the field outright, same as MAX -- not additive, so tapping $10
  // after $5 lands on $10, not $15. Insufficient-funds validation still
  // happens where it always has, on the Bet click itself; this is a shortcut
  // for typing the number, not a different path around it. Closes the panel
  // on selection -- it's a pick, not a settings toggle a player might want
  // to leave open.
  /**
   * A tapped chip goes ON the stack, it does not replace it.
   *
   * Asked for after playing 11.4: "pressed in succession should add those
   * chips to the selected total (so if someone hits the 25 in that menu, then
   * hits it again, it should be 50)." Which is why the tray no longer closes
   * on a tap -- closing it was what made a second tap impossible.
   *
   * The FIRST tap after opening replaces, and only later taps add. Pure
   * addition is the obvious reading and is wrong in the common case: the
   * field sits at the $5 default, so a first tap of $25 would land on $30 and
   * the very example above would produce 30 then 55. "Opening the tray starts
   * a fresh stack" is a rule a player can hold in their head, and it makes
   * reopening the tray the way to start over.
   */
  const setQuickBet = (amount: number) => {
    setBetAmount((prev) =>
      quickBetStacked ? String(Math.max(1, Math.floor(Number(prev) || 0) + amount)) : String(amount)
    );
    setQuickBetStacked(true);
    setBetError(undefined);
  };

  const handleBet = () => {
    const amount = Math.floor(Number(betAmount) || 0);
    if (amount < 1) {
      setBetError("Enter a bet amount of at least $1.");
      return;
    }
    const existingBet = turn.bet ?? 0;
    if (existingBet + amount > wallet) {
      setBetError("Insufficient chips for this wager.");
      return;
    }
    onBet(amount, { bank: false, eleveroon: eleveroonSelected });
    setBetError(undefined);
    setBetAmount(String(DEFAULT_BET));
  };

  // BANK! wagers the bank's entire available window in one shot -- a real
  // moment at an in-person table, so it gets its own confirm-first flow
  // rather than just arming the regular bet field.
  const bankBetAmount = bankIncrement > 0 ? bankIncrement : 0;
  const bankShortfall = (turn.bet ?? 0) + bankBetAmount > wallet;

  const confirmBank = () => {
    onBet(bankBetAmount, { bank: true, eleveroon: eleveroonSelected });
    setBankConfirmOpen(false);
    setBetError(undefined);
  };

  // Neither the grips nor the scale live here any more. They sit on the dock
  // ROW in TableRoot, one level up, because this is only one of three things
  // that render as a .k-dock -- the abandoned-banker notice and the
  // between-rounds panel are the others, and a size the player set on their
  // betting controls that snapped back to full width the moment the round
  // ended was reported as exactly that. The BANK! confirmation below is still
  // portalled through StageOverlay: the row's scale transform makes it the
  // containing block for anything position:fixed underneath it.
  return (
    <div className="k-dock">
      {/* .k-dock itself must stay overflow: visible for DockGrips (below) --
          see index.css's own comment on .k-dock and .k-dock-content. This
          wrapper is what actually lays the buttons out and what the compact
          breakpoint's "last resort" horizontal scroll applies to. */}
      <div className="k-dock-content">
      <div className="k-betbox">
        <span className="k-cur">$</span>
        {/* Our own pad, not the phone's -- see NumberField.tsx. The bet
            field is the worst place on the felt for an OS keyboard: it sits
            at the very bottom of a landscape viewport, so Android's IME
            covered the hand being wagered on. */}
        <NumberField
          value={betAmount}
          onChange={(next) => {
            handleAmountChange(next);
          }}
          min={1}
          max={Math.max(1, maxBettable)}
          label="Bet amount"
          className="k-amt"
        />
        <span className="k-stepper">
          <button type="button" className="k-stepbtn" onClick={() => adjustBet(BET_STEP)} aria-label="Increase bet">
            <Icon name="chevron-up" size={10} />
          </button>
          <button type="button" className="k-stepbtn" onClick={() => adjustBet(-BET_STEP)} aria-label="Decrease bet">
            <Icon name="chevron-down" size={10} />
          </button>
        </span>
        <button
          type="button"
          className="k-maxbtn"
          disabled={maxBettable < 1}
          onClick={handleMax}
          title={
            maxTriggersBank
              ? `Fill in $${maxBettable.toLocaleString()} -- the bank's whole window for your seat. Betting it calls BANK!, and the banker must resolve it immediately.`
              : "Fill in the most you can bet right now (your chips vs. what the bank can cover)."
          }
        >
          MAX
        </button>
      </div>

      {/* Beside .k-betbox, next to the wager amount selector, asked for
          directly. Two earlier passes both patched the SYMPTOM instead of
          the cause: one moved the trigger to the row's far end after the
          panel opened upward into .k-viewer-hud and lost that stacking
          fight; the other kept the trigger here but opened the panel
          SIDEWAYS instead, which cleared .k-viewer-hud but was then
          reported overlapping Bet/Blatt/Stand. Both symptoms trace to the
          same cause -- see toggleQuickBet's comment -- and the actual fix
          is the portal below. */}
      <span ref={quickBetRef} className="relative inline-flex k-quickbets">
        <button
          ref={quickBetTriggerRef}
          type="button"
          className="k-chip-btn"
          onClick={toggleQuickBet}
          aria-expanded={quickBetOpen}
          aria-haspopup="menu"
          title="Quick-bet amounts"
          aria-label="Quick-bet amounts"
        >
          <Icon name="coins" size={14} />
        </button>
        {quickBetOpen && quickBetAnchor && (
          <StageOverlay>
            <div
              ref={quickBetPanelRef}
              className="k-quickbets-panel"
              role="menu"
              style={{
                position: "fixed",
                top: quickBetAnchor.top,
                bottom: quickBetAnchor.bottom,
                left: quickBetAnchor.left,
                right: quickBetAnchor.right,
              }}
            >
              {QUICK_BET_CHIPS.map((amount) => (
                <button
                  key={amount}
                  type="button"
                  role="menuitem"
                  className="k-btn ghost sm"
                  onClick={() => setQuickBet(amount)}
                  aria-label={`Add $${amount} to the bet`}
                >
                  ${amount}
                </button>
              ))}
              {/* The stack has to be readable without looking away from the
                  tray -- the bet field is behind it on a phone, which is
                  exactly where these are tapped. */}
              <span className="k-quickbet-total" data-testid="quickbet-total">
                ${Math.max(0, Math.floor(Number(betAmount) || 0)).toLocaleString()}
              </span>
              <button
                type="button"
                role="menuitem"
                className="k-btn ghost sm"
                onClick={() => setQuickBetOpen(false)}
                title="Close the chip tray - the amount stays in the bet field"
              >
                Done
              </button>
            </div>
          </StageOverlay>
        )}
      </span>

      <button type="button" className="k-btn bet" onClick={handleBet}>
        Bet
      </button>
      <button type="button" className="k-btn hit" onClick={() => onHit({ eleveroon: eleveroonSelected })}>
        {drawLabel}
      </button>
      <button type="button" className="k-btn stand" onClick={onStand}>
        Stand
      </button>

      {/* Three states, not two. `disabled` stays reserved for "there is
          nothing to wager at all" (canBank). A seat that simply cannot COVER
          the bank's window is a different case and deliberately stays
          pressable, because the confirm dialog's shortfall branch is where
          the number is worth reading -- that was the original reasoning for
          leaving it fully live, and it still holds.
          What did not hold: it also looked identical to a live action. On a
          practice table the bank's slider floor is the player's own buy-in,
          so the bank is NEVER smaller than the player, so BANK! was
          unaffordable on every hand of every solo game -- and reported, on
          exactly that table, as "the BANK! showdown does not actually
          trigger or work" (2026-09-06). It triggered fine; it was never
          affordable, and nothing said so until you had already committed to
          pressing it. The dimmed style says "blocked, ask me why" at a
          glance while the dialog still does the explaining. */}
      <button
        type="button"
        className="k-btn bankall sm"
        disabled={!canBank}
        style={!canBank || bankShortfall ? { opacity: 0.4, cursor: "not-allowed" } : undefined}
        onClick={() => setBankConfirmOpen(true)}
        title={
          bankShortfall
            ? `BANK! needs $${bankBetAmount.toLocaleString()} -- more than your $${wallet.toLocaleString()} covers.`
            : !canBank && bankDisabledReason
            ? bankDisabledReason
            : "BANK! wagers the remaining available bank for your seat; the banker must resolve it immediately."
        }
      >
        BANK!
        {/* Hidden at the compact mobile breakpoint alongside the Eleveroon
            label -- same reasoning, buys back row width so the dock is less
            likely to wrap to a second row on a short phone screen. */}
        {typeof bankAvailable === "number" && <span className="k-bankall-amt"> ${bankAvailable.toLocaleString()}</span>}
      </button>

      <label className="k-toggle" title="Eleveroon ignores a busting eleven when your total was 11 (only after you turn it on).">
        <input type="checkbox" checked={eleveroonSelected} onChange={(e) => setEleveroonSelected(e.target.checked)} />
        {/* Stays visible at the compact mobile breakpoint (index.css), unlike
            k-bankall-amt above -- an earlier pass hid it too to buy back row
            width, but that left a bare checkbox with nothing saying what it
            does on the one platform with no hover tooltip to fall back on.
            A rule people have to opt into can't be an unlabelled box, so
            this one keeps its row rather than disappearing into one. */}
        <span className="k-toggle-label">Eleveroon</span>
      </label>

      {/* betError is transient -- it appears because you just pressed Bet with
          a bad amount, and clears on the next keystroke. The BANK! reason used
          to sit here beside it, but that one is a standing condition (a fresh
          practice table is unaffordable from the first hand to the last), so it
          held a permanent row under the controls on the screen with the least
          room for one. It now reaches the player where they actually ask the
          question: the button's tooltip, and the confirm dialog's shortfall
          branch when they press BANK! anyway. */}
      {betError && <span className="k-tag bust">{betError}</span>}

      {/* The one thing MAX's tooltip says that a phone can never read: that
          the amount now sitting in the box is the bank's whole window, so
          pressing Bet calls a BANK! showdown rather than placing an ordinary
          wager. MAX used to prevent this case by quietly filling in $1 less
          (see maxBettable's comment); saying it out loud is what replaced
          that. Conditioned on the TYPED amount, not on MAX having been
          pressed -- typing the number by hand lands on the same showdown,
          and the warning has to follow the money, not the button. */}
      {!betError && bankIncrement > 0 && Number(betAmount) === bankIncrement && (
        <span className="k-tag warn">Bet ${bankIncrement.toLocaleString()} calls BANK!</span>
      )}

      {/* Portalled to the body. It is a position:fixed overlay and it lives
          inside .k-dock, which now carries a scale transform whenever the
          player has resized the dock -- and a transformed ancestor becomes the
          containing block for fixed descendants, so left here it would be
          scaled into the dock and its backdrop clipped to it instead of
          covering the screen. Same reason every other modal in this codebase
          goes through StageOverlay. */}
      {bankConfirmOpen && (
        <StageOverlay>
        <div
          className="k-modal-overlay"
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          onClick={() => setBankConfirmOpen(false)}
        >
          <div className="k-bank-confirm" onClick={(e) => e.stopPropagation()}>
            {bankShortfall ? (
              <>
                <div className="k-bank-confirm-title">Not enough chips</div>
                <p className="k-bank-confirm-body">
                  BANK! wagers ${bankBetAmount.toLocaleString()} - the bank's full available window - but you only
                  have ${wallet.toLocaleString()} to cover it.
                </p>
                <div className="k-bank-confirm-actions">
                  <button type="button" className="k-btn stand" onClick={() => setBankConfirmOpen(false)}>
                    Close
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="k-bank-confirm-title">Bet BANK!?</div>
                <p className="k-bank-confirm-body">
                  You're about to wager <b>${bankBetAmount.toLocaleString()}</b> -- the bank's entire available
                  window for your seat. The banker has to settle it right away. Ready?
                </p>
                <div className="k-bank-confirm-actions">
                  <button type="button" className="k-btn stand" onClick={() => setBankConfirmOpen(false)}>
                    Cancel
                  </button>
                  <button type="button" className="k-btn bankall" onClick={confirmBank}>
                    Yes, bet BANK!
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
        </StageOverlay>
      )}
      </div>

      <DockGrips dockPanel={dockPanel} />
    </div>
  );
}
