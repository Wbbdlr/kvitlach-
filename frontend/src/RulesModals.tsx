import { Icon } from "./table/icons";

export interface RulesModalsProps {
  showHowTo: boolean;
  showWhatIs: boolean;
  onCloseHowTo: () => void;
  onCloseWhatIs: () => void;
}

// Rendered from both the pre-join lobby and the felt table, so the rules stay
// reachable once a player is seated (the felt table's "?" chip opens them).
export function RulesModals({ showHowTo, showWhatIs, onCloseHowTo, onCloseWhatIs }: RulesModalsProps) {
  return (
    <>
      {showHowTo && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4"
          onClick={onCloseHowTo}
        >
          <div
            className="relative w-full max-w-xl max-h-[90vh] card-surface bg-amber-100 p-6 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-300 scrollbar-track-transparent"
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
            <div className="space-y-3 text-sm text-slate-700">
              <h2 className="text-lg font-semibold">How To Play Kvitlach</h2>
              <div>
                <div className="font-semibold">Objective</div>
                <p>Reach 21 or the closest total without exceeding it.</p>
              </div>
              <div>
                <div className="font-semibold">Deck &amp; cards</div>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Each deck has the numbers 1 through 12, with four copies of every card (48 cards total).</li>
                  <li>Tables can combine between one and six decks; larger games benefit from extra decks.</li>
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
            </div>
          </div>
        </div>
      )}

      {showWhatIs && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4"
          onClick={onCloseWhatIs}
        >
          <div
            className="relative w-full max-w-xl max-h-[85vh] card-surface bg-amber-100 p-6 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-300 scrollbar-track-transparent"
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
            <div className="space-y-3 text-sm text-slate-700">
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
