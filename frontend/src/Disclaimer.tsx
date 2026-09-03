import PageShell from "./PageShell";

export default function Disclaimer() {
  return (
    <PageShell active="/disclaimer">
      <h1 className="text-3xl font-bold text-amber-800">Disclaimer</h1>

      <section className="space-y-2 border-l-2 border-amber-200 pl-4">
        <h2 className="text-lg font-semibold text-amber-700">No gambling, no real money</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>This app is for entertainment and education only. It is not a gambling platform.</li>
          <li>No real money, payouts, or prizes are offered, tracked, or settled through this app.</li>
          <li>There is no payment processing or mechanism to deposit, withdraw, or wager real currency.</li>
        </ul>
      </section>

      <section className="space-y-2 border-l-2 border-amber-200 pl-4">
        <h2 className="text-lg font-semibold text-amber-700">Player responsibility</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>By playing, you agree you are of legal age to participate in social/entertainment card games in your jurisdiction.</li>
          <li>You assume all responsibility for how you use the app, including any house rules agreed upon with your group.</li>
          <li>Do not attempt to introduce real-money side arrangements through this app.</li>
        </ul>
      </section>

      <section className="space-y-2 border-l-2 border-amber-200 pl-4">
        <h2 className="text-lg font-semibold text-amber-700">No warranties or guarantees</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>The app is provided "as is" with no warranties of any kind, express or implied.</li>
          <li>We do not guarantee uptime, correctness of outcomes, fairness of play, or data persistence.</li>
          <li>Game state may be lost due to network issues, browser refreshes, or server restarts.</li>
        </ul>
      </section>

      <section className="space-y-2 border-l-2 border-amber-200 pl-4">
        <h2 className="text-lg font-semibold text-amber-700">Liability</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>We are not liable for any losses, disputes, or damages arising from use of the app.</li>
          <li>Use of the app is at your own risk; stop playing if you experience issues or disagreement on outcomes.</li>
        </ul>
      </section>

      <section className="space-y-2 border-l-2 border-amber-200 pl-4">
        <h2 className="text-lg font-semibold text-amber-700">Ownership</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>Kvitlach&trade; and the Kvitlach name, logo, and site design are &copy; 2026 SWS. All rights reserved.</li>
          {/* Scoped to exactly the two confirmed original assets, not "all
              game sounds" -- several of the others (card/chip taps, shuffle)
              are stock effects, not original work, and claiming those here
              would be a false statement, not a cautious one. Extend this
              list only once another asset's own provenance is confirmed. */}
          <li>
            The Futch (bust) horn and the Eleveroon fanfare are original sound recordings created for this
            platform and may not be copied, redistributed, or reused elsewhere without permission.
          </li>
          <li>Use of the Kvitlach name to refer to this platform is fine. Using it for anything else needs permission first.</li>
        </ul>
      </section>

      <section className="space-y-2 border-l-2 border-amber-200 pl-4">
        <h2 className="text-lg font-semibold text-amber-700">Still in development</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>This app is still in active development. Features may change, and outages or resets may occur.</li>
          <li>Report issues or feedback so we can improve stability and clarity.</li>
        </ul>
      </section>
    </PageShell>
  );
}
