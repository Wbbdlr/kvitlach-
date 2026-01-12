export default function About() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-10 space-y-4 text-slate-700">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-semibold text-ink">About Kvitlach</h1>
        <a
          href="/"
          className="inline-flex items-center gap-2 rounded-full border border-ink text-ink px-3 py-1.5 text-sm font-semibold shadow-sm hover:bg-ink hover:text-white"
        >
          ← Back to table
        </a>
      </div>
      <h1 className="text-2xl font-semibold text-ink">About Kvitlach</h1>

      <section className="space-y-2">
        <h2 className="text-xl font-semibold text-ink">What is this?</h2>
        <p>
          A modern, online table for Kvitlach — the Ashkenazi Chanukah-era 21-variant with a dedicated banker and hand-written
          kvitlach (notes). We kept the social flow, added visibility rules that match the original table habits, and layered in
          admin controls for live games.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-xl font-semibold text-ink">How to play (quick start)</h2>
        <ol className="list-decimal list-inside space-y-1">
          <li>Create a room (or join one) and set a banker bankroll. Banker owns the bank for the session.</li>
          <li>Blatt (draw for free) to peek at cards before you wager. Multiple blatts are allowed.</li>
          <li>Place a wager (or BANK! to challenge the banker) — bet adds a card and locks your stake.</li>
          <li>Act on your turn: Hit (draw), Stand, or Skip. Eleveroon toggle ignores busting elevens in a row when your total was 11.</li>
          <li>Banker resolves at the end: plays out the bank hand, pays winners, collects losses, pushes ties.</li>
        </ol>
      </section>

      <section className="space-y-2">
        <h2 className="text-xl font-semibold text-ink">Table mechanics</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>Visibility: players always see their own hands; blatts are visible to all; wagered cards stay hidden until resolution; banker's first card stays hidden until final.</li>
          <li>Deck sizing: auto-calculated (about six cards per seat, capped at 16 decks) with banker override.</li>
          <li>Turn flow: WS-driven, queue-aware; standby indicator while waiting on banker resolution.</li>
          <li>Banker tools: approve/deny rename and chip requests; top up or drain the bank; adjust wallets; kick players; end round when bank is depleted; handle BANK! showdown.</li>
          <li>Rounds: per-room history cached in the browser; banker summary available at the end of each round.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-xl font-semibold text-ink">Odds and fairness</h2>
        <p>
          The backend includes a Monte Carlo simulator to inspect edge and variance. Default rules mirror table play; no house
          advantage is injected beyond classic banker position. Eleveroon reduces busts by ignoring busting elevens in a row when the hand was sitting at 11.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-xl font-semibold text-ink">Features in this build</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>Live WebSocket play with reconnect, queued actions, and inline WS status.</li>
          <li>Room passwords (optional), banker-owned bank, rename and chip request workflows.</li>
          <li>Responsive layout; card art and typography faithful to the original printed kvitlach.</li>
          <li>Cloudflare-tunneled deployment with TLS at the edge; in-browser local round history.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-xl font-semibold text-ink">A brief history</h2>
        <p>
            Kvitlach (Yiddish for &quot;note slips&quot;) emerged as a Chanukah gambling pastime: players jot wagers on slips, draw toward 21, and
          settle against a banker. This build keeps the banker role central, preserves the reveal cadence, and makes the game usable
          for remote tables while keeping it lightweight and social.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-xl font-semibold text-ink">Beta notes</h2>
        <p>
          This is a live beta. Expect occasional reconnects as we tune performance. Feedback on flow, visibility, and banker tools is
          welcome so we can refine before the next release.
        </p>
      </section>
    </div>
  );
}
