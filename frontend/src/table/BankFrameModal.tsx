import { BankFrameResult } from "../types";
import { bestTotal } from "./selectors";
import { CardView } from "./CardView";
import { StageOverlay } from "./StageOverlay";
import { useEscapeKey } from "../useEscapeKey";
import { useDialogFocus } from "../useDialogFocus";

// The hand a BANK! showdown was won (or lost) with, held up to be read.
//
// It exists because that hand is never on the felt. A BANK! wager that leaves
// seats waiting forces the banker into a fresh hand, and store.ts's
// settleBankOutcome pays the frame out and OVERWRITES the banker's turn with
// the redeal in the same call -- so no round:state broadcast ever carries the
// cards that just beat everybody. Until now the only trace was a toast reading
// "Bank showed 19 (beat 3)".
//
// Reported from a real table: "he beat the players he was playing out, then
// got a new card and continued playing, but it all happened so fast, his first
// hand disappeared so we don't even know how he beat the first few players."
//
// So this shows the actual cards. The toast still fires -- it is the record
// for anybody who dismissed this without reading it, and for a watcher who
// joined mid-frame and has no prevRound to diff.

export interface BankFrameModalProps {
  frame: BankFrameResult;
  /** The banker's display name, for a table where "the bank" has a person behind it. */
  bankerName?: string;
  /** True at a computer table, where dismissing also releases the held bot. */
  releasesBot: boolean;
  onContinue: () => void;
}

export function BankFrameModal({ frame, bankerName, releasesBot, onContinue }: BankFrameModalProps) {
  useEscapeKey(onContinue);
  const dialogRef = useDialogFocus<HTMLDivElement>();
  const { total, bustedTotal } = bestTotal(frame.cards);
  const busted = total === undefined && bustedTotal !== undefined;

  const headline = busted
    ? `The bank futched with ${bustedTotal}`
    : total === 21
      ? "The bank hit 21"
      : `The bank showed ${total ?? "--"}`;

  // beat/lostTo are counts of the seats THIS frame settled, which is the
  // question somebody actually has when the hand vanishes: not what the bank
  // held, but who it took the money from.
  const beat = frame.beat ?? 0;
  const lostTo = frame.lostTo ?? 0;
  const record =
    beat === 0 && lostTo === 0
      ? "No wagers rode on it."
      : [
          beat > 0 ? `Beat ${beat} player${beat === 1 ? "" : "s"}` : "",
          lostTo > 0 ? `lost to ${lostTo}` : "",
        ]
          .filter(Boolean)
          .join(", ") + ".";

  return (
    <StageOverlay>
      <div className="k-dialog-scrim" ref={dialogRef} role="dialog" aria-modal="true">
        {/* No click-through-to-dismiss on the scrim, and no ✕. At a computer
            table this dialog is the only thing holding the bot, so a stray tap
            outside it would hand back exactly the problem it fixes. One
            deliberate button, plus Escape for a keyboard. */}
        <div className="k-dialog max-w-sm" onClick={(e) => e.stopPropagation()}>
          <div className="text-xs uppercase tracking-wide k-dialog-sub">
            {bankerName ? `${bankerName}'s hand` : "The bank's hand"}
          </div>
          <div className={`mt-0.5 text-base font-semibold ${busted ? "text-rose-300" : "k-dialog-strong"}`}>
            {headline}
          </div>

          <div className="mt-3 flex flex-wrap justify-center gap-1.5">
            {frame.cards.map((card, index) => (
              // pastFirstPaint, so they are simply THERE. This hand is being
              // shown as a record of something that already happened; dealing
              // it in again would read as a hand still being played.
              <CardView key={`${card.name}-${index}`} card={card} pastFirstPaint futched={busted} />
            ))}
          </div>

          <p className="mt-3 text-xs k-dialog-sub">{record}</p>

          <button
            type="button"
            className="k-btn ghost mt-4 w-full"
            onClick={onContinue}
            autoFocus
          >
            {releasesBot ? "Deal the next hand" : "Continue"}
          </button>
        </div>
      </div>
    </StageOverlay>
  );
}
