import PageShell from "./PageShell";

// Static, code-only -- deliberately NOT admin-editable the way About/Contact/
// Disclaimer are. Those describe copy an operator writes; this describes
// what the CODE actually does with data, so it should change when the data
// handling changes (a commit), not drift independently via a form. Every
// claim below is grounded in the actual schema/routes, not a guess -- see
// db.ts (connections/rooms/rounds/settings tables), ws-server.ts
// (resolveClientIp + user-agent capture), and index.html (no analytics
// script of any kind).
export default function Privacy() {
  return (
    <PageShell active="/privacy">
      <h1 className="text-3xl font-bold text-amber-800">Privacy</h1>

      <section className="space-y-2 border-l-2 border-amber-200 pl-4">
        <h2 className="text-lg font-semibold text-amber-700">What we collect, and why</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>The name you type when you join, create, or start a practice table. It is not verified and is not an account - it exists only so others at your table know who you are.</li>
          <li>The room code you join or create, and a password if the table has one. A password is never stored as plain text - only a one-way hash, which cannot be reversed back into the password.</li>
          <li>Gameplay itself: bets, cards, and results, so the table keeps working across reconnects and, on tables that are running with a database, survives a server restart.</li>
          <li>Your IP address and browser user-agent, logged per connection against the room and player you connected as. This is for abuse prevention and troubleshooting, not for tracking you across visits.</li>
          <li>A record of consequential actions at a table - chips adjusted, a player kicked or a seat swept for going idle, the bank topped up, a table deleted - with the table's code, who did it, and the amount where there was one. Money moves at a banker's discretion here, and this is what makes "who decided that" answerable afterwards.</li>
        </ul>
      </section>

      <section className="space-y-2 border-l-2 border-amber-200 pl-4">
        <h2 className="text-lg font-semibold text-amber-700">What stays on your device</h2>
        <p>
          Your session (so a refresh doesn't drop you from your seat), the last room you were in, and your own local
          round history live in your browser's local storage. None of it is sent anywhere except back to the same
          server, to resume your own seat - it is not a second copy we hold.
        </p>
      </section>

      <section className="space-y-2 border-l-2 border-amber-200 pl-4">
        <h2 className="text-lg font-semibold text-amber-700">What we don't do</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>No accounts, no email required to play, and nothing that links one visit to another beyond a single browser's own local storage.</li>
          <li>No analytics or tracking scripts of any kind, no ad networks, no cookies used for advertising.</li>
          <li>We don't sell or share data with third parties.</li>
          <li>No payment processing - there is no real money on this platform to begin with. See the <a href="/disclaimer" className="text-amber-700 hover:underline">Disclaimer</a>.</li>
        </ul>
      </section>

      <section className="space-y-2 border-l-2 border-amber-200 pl-4">
        <h2 className="text-lg font-semibold text-amber-700">How long we keep it</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>Practice tables are never persisted - they exist only in the server's memory and are gone the moment the table ends or the server restarts.</li>
          <li>A real table's data persists as long as the table exists, and is removed when its banker or an operator deletes it.</li>
          <li>
            {/* Honest, not flattering: db.ts has no purge job for this table
                and deleteRoom does not touch it, so a connection log
                genuinely outlives the room it belongs to today. Said
                plainly rather than glossed over -- see this feature's own
                planning notes if that changes. */}
            Connection logs (IP address and user-agent) currently have no automatic expiry and are not deleted
            when a room is. We're aware this is broader than it needs to be and are evaluating a retention window.
          </li>
          <li>
            {/* The window is limits.ts's auditRetentionDays, default 90, and
                audit.ts prunes to it. This page is code-only precisely so a
                claim like this cannot drift from what the code does: if that
                default or its bounds change, this sentence changes in the
                same commit. */}
            The record of table actions above is kept for 90 days and then deleted permanently. It is
            deliberately not removed when a table is deleted - an account of who deleted something is
            worth nothing if deleting it takes the account with it.
          </li>
        </ul>
      </section>

      <section className="space-y-2 border-l-2 border-amber-200 pl-4">
        <h2 className="text-lg font-semibold text-amber-700">Who else sees anything</h2>
        <p>
          The site sits behind Cloudflare, which handles traffic for us the way any content delivery network does --
          it sees connection metadata as part of that role. We don't use any other third-party service: no analytics
          vendor, no ad network, no separate hosting provider with its own access to your data.
        </p>
      </section>

      <section className="space-y-2 border-l-2 border-amber-200 pl-4">
        <h2 className="text-lg font-semibold text-amber-700">Your choices</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>Play as a guest with any name you like - nothing requires it to be your real one.</li>
          <li>Clearing your browser's local storage for this site removes your resume token and local round history.</li>
          <li>Questions about data tied to a specific table you were in? Reach out via <a href="/contact" className="text-amber-700 hover:underline">Contact</a>.</li>
        </ul>
      </section>

      <section className="space-y-2 border-l-2 border-amber-200 pl-4">
        <h2 className="text-lg font-semibold text-amber-700">Age</h2>
        <p>
          This platform is meant for players old enough to take part in social, no-money-stakes card games in their
          own area - see the Disclaimer's <a href="/disclaimer" className="text-amber-700 hover:underline">Player responsibility</a> section.
        </p>
      </section>

      <section className="space-y-2 border-l-2 border-amber-200 pl-4">
        <h2 className="text-lg font-semibold text-amber-700">Changes to this page</h2>
        <p>
          This is a small, actively developed project, and this page may change as the app does. Check back if you
          want the current picture.
        </p>
      </section>
    </PageShell>
  );
}
