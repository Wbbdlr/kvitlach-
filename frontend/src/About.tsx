import { useEffect, useState } from "react";
import PageShell from "./PageShell";

// Operator-authored copy, edited from /admin and served by the backend through
// an exact-path nginx proxy (frontend/nginx.conf). Fetched rather than built in
// so adding a beta tester's name does not need a release.
//
// It is rendered as TEXT, never as HTML: paragraphs are split on blank lines
// and each becomes a <p> with React setting its textContent. That is what makes
// the field safe to expose to an operator at all -- normalizeAboutText on the
// server strips control characters and caps length, but it deliberately does
// not escape markup, because escaping on the way in and trusting on the way out
// is how stored XSS gets built one refactor later. If this ever grows
// formatting, it needs a real markdown renderer with HTML disabled, not
// dangerouslySetInnerHTML.
interface AboutExtra {
  heading: string;
  body: string;
}

function useAboutExtra(): AboutExtra | null {
  const [extra, setExtra] = useState<AboutExtra | null>(null);
  useEffect(() => {
    let cancelled = false;
    // Failure is silent and total: the page's own copy is the point, this is an
    // addition to it. A backend that is down, a proxy that is not configured
    // (local dev without the container) and an empty setting all look the same
    // to a reader, which is correct -- there is simply no extra section.
    fetch("/api/about", { headers: { accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const heading = typeof data.heading === "string" ? data.heading : "";
        const body = typeof data.body === "string" ? data.body : "";
        if (heading || body) setExtra({ heading, body });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return extra;
}

export default function About() {
  const extra = useAboutExtra();
  return (
    <PageShell active="/about">
      <h1 className="text-3xl font-bold text-amber-800">About Kvitlach</h1>


      <section className="space-y-2 border-l-2 border-amber-200 pl-4">
        <h2 className="text-lg font-semibold text-amber-700">What is this?</h2>
        <p>
          A modern, online table for Kvitlach — the Ashkenazi Chanukah-era 21-variant with a dedicated banker and hand-written
          kvitlach (notes). We kept the social flow, added visibility rules that match the original table habits, and layered in
          admin controls for live games.
        </p>
      </section>

      <section className="space-y-2 border-l-2 border-amber-200 pl-4">
        <h2 className="text-lg font-semibold text-amber-700">How to play (quick start)</h2>
        <ol className="list-decimal list-inside space-y-1">
          <li>Create a room (or join one) and set a banker bankroll. Banker owns the bank for the session.</li>
          <li>Blatt (draw for free) to peek at cards before you wager. Multiple blatts are allowed.</li>
          <li>Place a wager (or BANK! to challenge the banker) — bet adds a card and locks your stake.</li>
          <li>Act on your turn: Hit (draw), Stand, or Skip. Eleveroon toggle ignores busting elevens in a row when your total was 11; leave it off and an 11 at 11 will bust.</li>
          <li>Banker resolves at the end: plays out the bank hand, pays winners, collects losses, pushes ties.</li>
        </ol>
      </section>

      <section className="space-y-2 border-l-2 border-amber-200 pl-4">
        <h2 className="text-lg font-semibold text-amber-700">Table mechanics</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>Visibility: players always see their own hands; blatts are visible to all; wagered cards stay hidden until resolution; banker's first card stays hidden until final.</li>
          <li>Deck sizing: auto-calculated (about six cards per seat, capped at 16 decks) with banker override.</li>
          <li>Turn flow: WS-driven, queue-aware; standby indicator while waiting on banker resolution.</li>
          <li>Banker tools: approve/deny rename and chip requests; top up or drain the bank; adjust wallets; kick players; end round when bank is depleted; handle BANK! showdown.</li>
          <li>Rounds: per-room history cached in the browser; banker summary available at the end of each round.</li>
        </ul>
      </section>

      <section className="space-y-2 border-l-2 border-amber-200 pl-4">
        <h2 className="text-lg font-semibold text-amber-700">Odds and fairness</h2>
        <p>
          The backend includes a Monte Carlo simulator to inspect edge and variance. Default rules mirror table play; no house
          advantage is injected beyond classic banker position. Eleveroon reduces busts by ignoring busting elevens in a row when the hand was sitting at 11; if you don’t toggle it, that 11 will bust you.
        </p>
      </section>

      <section className="space-y-2 border-l-2 border-amber-200 pl-4">
        <h2 className="text-lg font-semibold text-amber-700">Features in this build</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>Live WebSocket play with reconnect, queued actions, and inline WS status.</li>
          <li>Room passwords (optional), banker-owned bank, rename and chip request workflows.</li>
          <li>Responsive layout; card art and typography faithful to the original printed kvitlach.</li>
          <li>Cloudflare-tunneled deployment with TLS at the edge; in-browser local round history.</li>
        </ul>
      </section>

      <section className="space-y-2 border-l-2 border-amber-200 pl-4">
        <h2 className="text-lg font-semibold text-amber-700">A brief history</h2>
        <p>
            Kvitlach (Yiddish for &quot;note slips&quot;) emerged as a Chanukah gambling pastime: players jot wagers on slips, draw toward 21, and
          settle against a banker. This build keeps the banker role central, preserves the reveal cadence, and makes the game usable
          for remote tables while keeping it lightweight and social.
        </p>
      </section>

      <section className="space-y-2 border-l-2 border-amber-200 pl-4">
        <h2 className="text-lg font-semibold text-amber-700">Still in development</h2>
        <p>
          This app is still being actively developed. Expect occasional reconnects as we tune performance. Feedback on flow, visibility, and banker tools is
          welcome so we can keep improving it.
        </p>
      </section>

      <section className="space-y-2 border-l-2 border-amber-200 pl-4">
        <h2 className="text-lg font-semibold text-amber-700">Credits</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>
            Kvitlach.us is developed by{" "}
            <a
              href="https://computerrabbis.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-amber-700 hover:underline font-semibold"
            >
              ComputerRabbis.com
            </a>
            .
          </li>
          <li>
            Background music: <strong>Chanuka Medley</strong> by{" "}
            <a
              href="https://www.youtube.com/@MichaGamerman"
              target="_blank"
              rel="noopener noreferrer"
              className="text-amber-700 hover:underline font-semibold"
            >
              Micha Gamerman
            </a>
            . Used with appreciation.
          </li>
          <li>
            Sound effects: <a
              href="https://kenney.nl/assets/casino-audio"
              target="_blank"
              rel="noopener noreferrer"
              className="text-amber-700 hover:underline"
            >
              Casino Audio pack
            </a>{" "}
            by Kenney (CC0 / public domain).
          </li>
          <li>
            Natural 21 fanfare:{" "}
            <a
              href="https://mixkit.co/free-sound-effects/win/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-amber-700 hover:underline"
            >
              Mixkit
            </a>{" "}
            (free, no attribution required).
          </li>
        </ul>
      </section>

      {extra && (
        <section className="mt-8">
          {extra.heading && <h2 className="text-lg font-semibold text-slate-800">{extra.heading}</h2>}
          {extra.body
            .split(/\n\s*\n/)
            .map((para) => para.trim())
            .filter(Boolean)
            .map((para, i) => (
              // Index keys are fine here: this list is derived from one string,
              // is never reordered, and has no state of its own.
              <p key={i} className="mt-2 whitespace-pre-line text-slate-700">
                {para}
              </p>
            ))}
        </section>
      )}
    </PageShell>
  );
}
