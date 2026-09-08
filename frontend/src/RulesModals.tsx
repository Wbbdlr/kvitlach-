import { Icon } from "./table/icons";
import { useEscapeKey } from "./useEscapeKey";
import { useDialogFocus } from "./useDialogFocus";

export interface RulesModalsProps {
  showHowTo: boolean;
  showWhatIs: boolean;
  onCloseHowTo: () => void;
  onCloseWhatIs: () => void;
}

// Rendered from both the pre-join lobby and the felt table, so the rules stay
// reachable once a player is seated (the felt table's "?" chip opens them).
export function RulesModals({ showHowTo, showWhatIs, onCloseHowTo, onCloseWhatIs }: RulesModalsProps) {
  useEscapeKey(onCloseHowTo, showHowTo);
  useEscapeKey(onCloseWhatIs, showWhatIs);
  // Two independent dialogs in one component, so two independent traps --
  // each gated on its own visibility, never both live at once.
  const howToRef = useDialogFocus<HTMLDivElement>(showHowTo);
  const whatIsRef = useDialogFocus<HTMLDivElement>(showWhatIs);
  return (
    <>
      {showHowTo && (
        <div
          className="k-dialog-scrim"
          onClick={onCloseHowTo}
        >
          <div
            className="k-dialog max-w-xl"
            ref={howToRef}
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="k-modal-close"
              onClick={onCloseHowTo}
              aria-label="Close"
              title="Close"
            >
              <Icon name="close" size={15} />
            </button>
            <div className="space-y-3 text-sm k-dialog-strong">
              <h2 className="text-lg font-semibold">How To Play Kvitlach</h2>
              <div>
                <div className="font-semibold">Objective</div>
                <p>Reach 21 or the closest total without exceeding it.</p>
              </div>
              <div>
                <div className="font-semibold">Deck &amp; cards</div>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Each deck has the numbers 1 through 12, with two copies of every card (24 cards total).</li>
                  <li>
                    Tables combine several decks into one shoe &mdash; up to sixteen. The Banker can leave it on Auto
                    (sized for the number of seats) or set it themselves, and can reshuffle at any time.
                  </li>
                  <li>Card 2 and card 11 are Rosiers (also called Framed cards) &mdash; pairing them deals an automatic 21.</li>
                </ul>
              </div>
              <div>
                <div className="font-semibold">Turn rules</div>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Each player receives one card, places a bet, and may draw additional cards one at a time.</li>
                  <li>Exact 21 is an instant win; going over 21 is an instant loss.</li>
                  <li>Standing keeps your current hand; the Banker plays last with their first card kept hidden.</li>
                  <li>If the Banker hits 21, all standing player bets are lost; if the Banker busts, all standing players win their bets.</li>
                  <li>Otherwise compare totals: the higher total (21 or under) wins; ties go to the Banker.</li>
                </ul>
              </div>
              <div>
                <div className="font-semibold">Betting &amp; bankroll</div>
                <ul className="list-disc pl-5 space-y-1">
                  <li>You can place multiple wagers during your turn; each bet stacks on your total stake.</li>
                  <li>
                    Bets draw from your wallet balance &mdash; once you run out of chips you cannot raise further until the
                    Banker pays out or you receive a buy-in.
                  </li>
                  <li>The Banker should maintain enough bankroll to cover payouts; use the top-up tool if the bank runs low.</li>
                </ul>
              </div>
              <div>
                <div className="font-semibold">Blatt draws</div>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Drawing without a wager is called taking a Blatt; it lets you reveal another card before committing chips.</li>
                  <li>Once you place any bet, further draws are regular hits and leave your wager on the table.</li>
                  <li>A Blatt total of 20 or more automatically puts you on standby &mdash; you keep that hand while the Banker plays.</li>
                </ul>
              </div>
              <div>
                <div className="font-semibold">Special cards</div>
                <ul className="list-disc pl-5 space-y-1">
                  <li>#12 can count as 12, 10, or 9; two #12 as the first two cards result in an automatic 21.</li>
                  <li>Two Rosiers/Framed cards (2 or 11) as the first two draws also deliver an automatic 21.</li>
                </ul>
              </div>
              <div>
                <div className="font-semibold">Eleveroon</div>
                <ul className="list-disc pl-5 space-y-1">
                  <li>
                    Turn Eleveroon on before you draw and a card 11 that would bust you is set aside instead, as long as your
                    hand can be read as exactly 11 at that moment.
                  </li>
                  <li>Because #12 counts as 12, 10, or 9, a hand like 12&nbsp;+&nbsp;2 still qualifies (read the 12 as a 9).</li>
                  <li>The Banker always plays with Eleveroon on.</li>
                </ul>
              </div>
              <div>
                <div className="font-semibold">BANK!</div>
                <ul className="list-disc pl-5 space-y-1">
                  <li>
                    BANK! wagers everything the bank can still cover, in one bet. It asks you to confirm first &mdash; at a
                    real table this is a moment, not a click.
                  </li>
                  <li>
                    The table pauses on the two of you: you finish your hand, then the Banker plays theirs, and the wager
                    settles before ordinary turns resume.
                  </li>
                  <li>
                    If it empties the bank, the Banker chooses what happens next &mdash; add chips and play on, pass the
                    bank to another player, or end the night there. Nothing moves until they pick.
                  </li>
                  <li>Taking MAX can land exactly on the bank&rsquo;s limit, which is the same thing as calling BANK!. The button says so when it will.</li>
                </ul>
              </div>
              <div>
                <div className="font-semibold">At the table</div>
                <ul className="list-disc pl-5 space-y-1">
                  <li>
                    <strong>Turn clock.</strong> The Banker can put a countdown on each turn (anywhere from 10 seconds to
                    5 minutes; a minute by default). If it runs out you are Stood automatically &mdash; your hand and any
                    chips already wagered stay exactly as they are, you simply stop drawing. The Banker&rsquo;s own turn is
                    never on a clock, and changing the setting never shortens a turn already running.
                  </li>
                  <li>
                    <strong>Move the controls.</strong> The bar with your bet and buttons can go wherever suits your grip
                    &mdash; drag any of the corner brackets, resize from the top-right corner, and use the small arrow to
                    put it back. Where you leave it is remembered on your own device.
                  </li>
                  <li>
                    <strong>Zoom the table.</strong> Pinch to zoom in on the felt and drag to move around it; a Reset
                    control appears while you are zoomed.
                  </li>
                  <li>
                    <strong>Ask the Banker.</strong> You can request more chips or a change to your name from the table
                    itself; the Banker approves or declines. You do not need to leave and rejoin.
                  </li>
                  <li>
                    <strong>If you drop off.</strong> Your seat and your chips stay put and the table shows you as away.
                    Come back to the same link and you keep the seat &mdash; the Banker can confirm it is you if the table
                    needs it.
                  </li>
                  <li>
                    <strong>Reactions.</strong> The face button sends a reaction to the table. It is the only thing you can
                    send to everyone, deliberately &mdash; there is no chat here.
                  </li>
                  <li>
                    <strong>Playing alone.</strong> &ldquo;Play Against the Computer&rdquo; deals a full table of computer
                    players against a computer Banker. Nothing there touches a real table or real chips.
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {showWhatIs && (
        <div
          className="k-dialog-scrim"
          onClick={onCloseWhatIs}
        >
          <div
            className="k-dialog max-w-xl"
            ref={whatIsRef}
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="k-modal-close"
              onClick={onCloseWhatIs}
              aria-label="Close"
              title="Close"
            >
              <Icon name="close" size={15} />
            </button>
            <div className="space-y-3 text-sm k-dialog-strong">
              <h2 className="text-lg font-semibold">What Is Kvitlach?</h2>
              <p>
                Kvitlech (Yiddish: קוויטלעך, lit. &ldquo;notes&rdquo; or &ldquo;slips&rdquo;) is a traditional card game
                similar to Twenty-One and modern Blackjack, commonly played in some Ashkenazi Jewish homes during the
                Chanuka season.
              </p>
              <p>
                Chasidish families have been playing Kvitlech for many years, using a distinctive deck created to avoid the
                use of standard playing cards that often featured crosses and other Christian symbols. A standard Kvitlech
                deck consists of 24 cards, arranged in identical pairs numbered from 1 to 12.
              </p>
              <p>
                These specially made decks are known by several traditional names, including kvitlech, lamed-alefniks
                (&ldquo;thirty-oners&rdquo;), klein Shas (&ldquo;small Talmud&rdquo;), or tilliml (&ldquo;small
                Tehillim&rdquo;). The cards are typically decorated with Hebrew numerals and simple, familiar objects, and
                in some cases with portraits of biblical figures.
              </p>
              <p>
                Over time, Kvitlech decks were produced both by hand and later by manufacturers, allowing the game to spread
                and remain a familiar Chanuka pastime in many Jewish homes.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
