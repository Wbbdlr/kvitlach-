import { useEffect, useState, ReactNode } from "react";
import PageShell from "./PageShell";

// Per-section operator overrides, edited from /admin and served by the
// backend through an exact-path nginx proxy (frontend/nginx.conf). Same
// "render as TEXT, never as HTML" rule as About.tsx/Contact.tsx -- see
// About.tsx's own comment for the full reasoning.
//
// Unlike those two, this is six independent overrides, not one: each legal
// section below keeps its own hardcoded heading and bullet points as the
// DEFAULT, and only swaps to operator text for a section that actually has
// an override on file (backend/src/disclaimer.ts). A section's heading is
// never operator-editable -- only DISCLAIMER_SLUGS' six keys exist, and an
// unknown key from the API is simply ignored below, the same way the backend
// ignores one on a hand-edited settings row.
type DisclaimerSlug = "gambling" | "responsibility" | "warranties" | "liability" | "ownership" | "development";

interface SectionOverride {
  body: string;
}

function useDisclaimerOverrides(): Partial<Record<DisclaimerSlug, SectionOverride>> {
  const [overrides, setOverrides] = useState<Partial<Record<DisclaimerSlug, SectionOverride>>>({});
  useEffect(() => {
    let cancelled = false;
    // Failure is silent and total, same as About/Contact: a backend that is
    // down, a proxy not configured (local dev without the container), and no
    // overrides set all look the same to a reader -- every section simply
    // shows its built-in wording.
    fetch("/api/disclaimer", { headers: { accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data || typeof data !== "object") return;
        const next: Partial<Record<DisclaimerSlug, SectionOverride>> = {};
        for (const slug of ["gambling", "responsibility", "warranties", "liability", "ownership", "development"] as const) {
          const body = data[slug]?.body;
          if (typeof body === "string" && body) next[slug] = { body };
        }
        setOverrides(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return overrides;
}

// Splits on blank lines into <p> elements, same as About.tsx/Contact.tsx's
// own extra section -- the only formatting an operator override carries.
function OverrideParagraphs({ body }: { body: string }) {
  return (
    <>
      {body
        .split(/\n\s*\n/)
        .map((para) => para.trim())
        .filter(Boolean)
        .map((para, i) => (
          <p key={i} className="whitespace-pre-line">
            {para}
          </p>
        ))}
    </>
  );
}

function DisclaimerSection({
  heading,
  override,
  children,
}: {
  heading: string;
  override: SectionOverride | undefined;
  /** The built-in bullet list, shown whenever there is no override. */
  children: ReactNode;
}) {
  return (
    <section className="space-y-2 border-l-2 border-amber-200 pl-4">
      <h2 className="text-lg font-semibold text-amber-700">{heading}</h2>
      {override ? <OverrideParagraphs body={override.body} /> : children}
    </section>
  );
}

export default function Disclaimer() {
  const overrides = useDisclaimerOverrides();
  return (
    <PageShell active="/disclaimer">
      <h1 className="text-3xl font-bold text-amber-800">Disclaimer</h1>

      <DisclaimerSection heading="No gambling, no real money" override={overrides.gambling}>
        <ul className="list-disc list-inside space-y-1">
          <li>This app is for entertainment and education only. It is not a gambling platform.</li>
          <li>No real money, payouts, or prizes are offered, tracked, or settled through this app.</li>
          <li>There is no payment processing or mechanism to deposit, withdraw, or wager real currency.</li>
        </ul>
      </DisclaimerSection>

      <DisclaimerSection heading="Player responsibility" override={overrides.responsibility}>
        <ul className="list-disc list-inside space-y-1">
          <li>By playing, you agree you are of legal age to participate in social/entertainment card games in your jurisdiction.</li>
          <li>You assume all responsibility for how you use the app, including any house rules agreed upon with your group.</li>
          <li>Do not attempt to introduce real-money side arrangements through this app.</li>
        </ul>
      </DisclaimerSection>

      <DisclaimerSection heading="No warranties or guarantees" override={overrides.warranties}>
        <ul className="list-disc list-inside space-y-1">
          <li>The app is provided "as is" with no warranties of any kind, express or implied.</li>
          <li>We do not guarantee uptime, correctness of outcomes, fairness of play, or data persistence.</li>
          <li>Game state may be lost due to network issues, browser refreshes, or server restarts.</li>
        </ul>
      </DisclaimerSection>

      <DisclaimerSection heading="Liability" override={overrides.liability}>
        <ul className="list-disc list-inside space-y-1">
          <li>We are not liable for any losses, disputes, or damages arising from use of the app.</li>
          <li>Use of the app is at your own risk; stop playing if you experience issues or disagreement on outcomes.</li>
        </ul>
      </DisclaimerSection>

      <DisclaimerSection heading="Ownership" override={overrides.ownership}>
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
      </DisclaimerSection>

      <DisclaimerSection heading="Still in development" override={overrides.development}>
        <ul className="list-disc list-inside space-y-1">
          <li>This app is still in active development. Features may change, and outages or resets may occur.</li>
          <li>Report issues or feedback so we can improve stability and clarity.</li>
        </ul>
      </DisclaimerSection>
    </PageShell>
  );
}
