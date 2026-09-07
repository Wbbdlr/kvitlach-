import PageShell from "./PageShell";

// Static, code-only -- same call as Privacy.tsx, and for the same reason:
// this describes the actual relationship between a visitor and a small,
// actively-changing hobby project, not copy an operator should be able to
// drift out of sync with the code via a form. Deliberately short and
// cross-links rather than duplicates -- the Disclaimer already carries "no
// warranties", "liability", and "ownership" as their own reviewed sections,
// and restating them here in different words is how two legal pages end up
// disagreeing with each other over time. See Disclaimer.tsx and Privacy.tsx.
export default function Terms() {
  return (
    <PageShell active="/terms">
      <h1 className="text-3xl font-bold text-amber-800">Terms of Service</h1>

      <section className="space-y-2 border-l-2 border-amber-200 pl-4">
        <h2 className="text-lg font-semibold text-amber-700">What this is</h2>
        <p>
          Kvitlach is a free, hobby-built card game for a group who already know each other - a Banker creates a
          table and shares its code, or you play solo against computer players. There is no signup, no account, and
          nothing to buy. Using the site at all means you agree to these terms, the{" "}
          <a href="/disclaimer" className="text-amber-700 hover:underline">Disclaimer</a>, and the{" "}
          <a href="/privacy" className="text-amber-700 hover:underline">Privacy</a> page.
        </p>
      </section>

      <section className="space-y-2 border-l-2 border-amber-200 pl-4">
        <h2 className="text-lg font-semibold text-amber-700">Using the site</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>Play in good faith with the people you're actually at a table with. Don't try to disrupt, overload, or break the service for anyone else.</li>
          <li>Don't use the name field to impersonate someone else at your table, or to post anything abusive, threatening, or unlawful.</li>
          <li>A table's Banker sets the rules for their own table, including its buy-in and player cap, and can remove a player from it. That authority stops at the table - it doesn't extend anywhere else on the site.</li>
          <li>Every table - practice and real alike - runs under site-wide limits (how many tables and players can be running at once). A table may be refused if the site is at capacity.</li>
        </ul>
      </section>

      <section className="space-y-2 border-l-2 border-amber-200 pl-4">
        <h2 className="text-lg font-semibold text-amber-700">No money, no warranty, no liability</h2>
        <p>
          This is the short version - the Disclaimer is the full one and is what actually governs. In brief: there
          is no real money anywhere on this platform, the app is provided as-is with no guarantee it will be
          available, correct, or free of data loss, and we aren't liable for losses or disputes arising from using
          it. Read the full{" "}
          <a href="/disclaimer" className="text-amber-700 hover:underline">Disclaimer</a> for all of it.
        </p>
      </section>

      <section className="space-y-2 border-l-2 border-amber-200 pl-4">
        <h2 className="text-lg font-semibold text-amber-700">Access can be limited or removed</h2>
        <p>
          An operator can restrict who can reach this site at all (an access code, or a full lockdown), close a
          table, or remove a player from one, at their discretion - most often for abuse, load, or a security
          concern. There is no account to ban, so this only ever acts on a table or a connection, never on an
          identity.
        </p>
      </section>

      <section className="space-y-2 border-l-2 border-amber-200 pl-4">
        <h2 className="text-lg font-semibold text-amber-700">Changes</h2>
        <p>
          This is a small, actively developed project - features, limits, and these terms themselves may change as
          it does. Continuing to use the site after a change means you accept the current version. Check back if you
          want the current picture.
        </p>
      </section>

      <section className="space-y-2 border-l-2 border-amber-200 pl-4">
        <h2 className="text-lg font-semibold text-amber-700">Questions</h2>
        <p>
          Reach out via <a href="/contact" className="text-amber-700 hover:underline">Contact</a>.
        </p>
      </section>
    </PageShell>
  );
}
