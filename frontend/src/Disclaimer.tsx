export default function Disclaimer() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-10 space-y-4 text-slate-700">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-semibold text-ink">Disclaimer</h1>
        <a
          href="/"
          className="inline-flex items-center gap-2 rounded-full border border-ink text-ink px-3 py-1.5 text-sm font-semibold shadow-sm hover:bg-ink hover:text-white"
        >
          Back to table
        </a>
      </div>

      <section className="space-y-2">
        <h2 className="text-xl font-semibold text-ink">No gambling, no real money</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>This app is for entertainment and education only. It is not a gambling platform.</li>
          <li>No real money, payouts, or prizes are offered, tracked, or settled through this app.</li>
          <li>There is no payment processing or mechanism to deposit, withdraw, or wager real currency.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-xl font-semibold text-ink">Player responsibility</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>By playing, you agree you are of legal age to participate in social/entertainment card games in your jurisdiction.</li>
          <li>You assume all responsibility for how you use the app, including any house rules agreed upon with your group.</li>
          <li>Do not attempt to introduce real-money side arrangements through this app.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-xl font-semibold text-ink">No warranties or guarantees</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>The app is provided "as is" with no warranties of any kind, express or implied.</li>
          <li>We do not guarantee uptime, correctness of outcomes, fairness of play, or data persistence.</li>
          <li>Game state may be lost due to network issues, browser refreshes, or server restarts.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-xl font-semibold text-ink">Liability</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>We are not liable for any losses, disputes, or damages arising from use of the app.</li>
          <li>Use of the app is at your own risk; stop playing if you experience issues or disagreement on outcomes.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-xl font-semibold text-ink">Beta notice</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>This is a beta release. Features may change, and outages or resets may occur.</li>
          <li>Report issues or feedback so we can improve stability and clarity.</li>
        </ul>
      </section>
    </div>
  );
}
