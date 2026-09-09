import SiteHeader from "./SiteHeader";
import SiteFooter from "./SiteFooter";

// The page for a link that matched nothing.
//
// Chosen by the catch-all's own wrapper in router.tsx, NOT by a second route.
// That route stays a single object on purpose -- see its comment: two route
// objects rendering App remount it on every path change and leave the WS
// status stuck on "connecting". A wrapper picking between two elements inside
// ONE route has no such effect, and it also means an unknown path never runs
// App's hooks or opens a socket at all.
//
// Worth having at all because the alternative is silence: every unknown path
// used to render the lobby exactly as if nothing had happened, so a mistyped
// family link -- the case that actually costs support time -- looked identical
// to a working one that had simply lost its look.

/**
 * A dreidel, drawn rather than animated frame by frame.
 *
 * Two motions, not one: a Y-axis turn plus a slower lean that is deliberately
 * out of phase with it. A single spin reads as a loading spinner; the lean is
 * what makes it read as an object with weight, resting on a point. One face
 * carries the nun, which is the face you see for most of a turn anyway.
 *
 * Honors prefers-reduced-motion by standing still on its point, which is also
 * how a dreidel ends up, so nothing looks broken when the motion is gone.
 */
function Dreidel() {
  return (
    <div className="k-nf-dreidel" aria-hidden="true">
      <svg viewBox="0 0 120 150" width="120" height="150" role="img">
        <defs>
          <linearGradient id="nf-wood" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#e8c98a" />
            <stop offset="45%" stopColor="#c9922f" />
            <stop offset="100%" stopColor="#8a5f1c" />
          </linearGradient>
          <linearGradient id="nf-face" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f7e7c4" />
            <stop offset="100%" stopColor="#d9ac52" />
          </linearGradient>
        </defs>

        {/* handle */}
        <rect x="54" y="4" width="12" height="26" rx="5" fill="url(#nf-wood)" />
        {/* body */}
        <path d="M22 34 h76 a6 6 0 0 1 6 6 v52 a6 6 0 0 1 -6 6 h-76 a6 6 0 0 1 -6 -6 v-52 a6 6 0 0 1 6 -6 z" fill="url(#nf-wood)" />
        {/* lit face */}
        <rect x="30" y="40" width="60" height="52" rx="4" fill="url(#nf-face)" opacity="0.55" />
        {/* Two letters, one shown at a time.
            Spinning, it shows the nun -- the face you see through most of a
            turn, and the one that means nothing happens, which is the honest
            letter for a page that found nothing.
            Standing still, it lands on GIMMEL: a dreidel at rest has landed on
            something, and gimmel is the one worth landing on. Swapped in CSS
            rather than in JS because the thing that decides is a media query
            (prefers-reduced-motion), not state. */}
        <text x="60" y="80" textAnchor="middle" className="k-nf-letter k-nf-spinning" fill="#4a3208" fontSize="44">
          &#1504;
        </text>
        <text x="60" y="80" textAnchor="middle" className="k-nf-letter k-nf-landed" fill="#4a3208" fontSize="44">
          &#1490;
        </text>
        {/* point */}
        <path d="M22 98 h76 l-38 42 z" fill="url(#nf-wood)" />
      </svg>
    </div>
  );
}

// Paths this app actually serves. Everything else is a link that matched
// nothing, and used to render the lobby as though it had worked.
//
// Read once at module load, BEFORE React mounts, for the same reason
// familyProfile.ts reads its own slug there: loadFamilyProfile() rewrites
// /m/<slug> to "/" with replaceState during boot, so by first render a family
// link is already indistinguishable from the front page. A room path is left
// to state.ts's own parser; this only decides whether the shape is one the app
// knows at all.
//
// The info pages are listed even though router.tsx matches them first and they
// never reach the catch-all. Belt and braces on purpose: the cost of a missing
// entry is a not-found page in front of the legal pages, which is a very quiet
// way to lose them, and the cost of a redundant one is nothing.
const KNOWN_PATH_RE = /^\/(?:table\/[^/]+\/?|m\/[^/]+\/?|about|disclaimer|contact|privacy|terms)?\/?$/;

/** The path that matched nothing, or "" when this boot landed somewhere real. */
export const unknownPathAtBoot: string = (() => {
  try {
    return KNOWN_PATH_RE.test(window.location.pathname) ? "" : window.location.pathname;
  } catch {
    return "";
  }
})();

export interface NotFoundProps {
  /** The path that matched nothing, shown back so a typo is obvious. */
  path?: string;
}

export default function NotFound({ path }: NotFoundProps) {
  const shown = (path ?? "").slice(0, 80);
  return (
    <div className="min-h-screen bg-blue-50/40">
      <div className="mx-auto max-w-3xl px-4 py-6">
        <SiteHeader showNav />
        <main className="py-12 sm:py-16 flex flex-col items-center text-center">
          <Dreidel />
          <h1 className="mt-6 text-2xl font-bold text-blue-800">That link didn&rsquo;t match anything</h1>
          <p className="mt-3 max-w-md text-sm text-slate-600">
            It landed on nothing at all. Usually that means a character went missing on the way into the group
            chat, or the table it pointed at has since been closed.
          </p>
          {shown && shown !== "/" && (
            <p className="mt-3 text-xs text-slate-500">
              You asked for <code className="rounded bg-white px-1.5 py-0.5 font-mono text-slate-700">{shown}</code>
            </p>
          )}
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <a
              href="/"
              className="rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-accent/85"
            >
              Go to the lobby
            </a>
            <a
              href="/contact"
              className="rounded-lg border border-blue-300 bg-white px-5 py-2.5 text-sm font-semibold text-blue-800 transition-colors hover:bg-blue-50"
            >
              Tell us about it
            </a>
          </div>
          <p className="mt-8 max-w-md text-xs text-slate-500">
            If somebody sent you a table code, you can type it straight into the Join form in the lobby &mdash;
            you don&rsquo;t need the link.
          </p>
        </main>
        <SiteFooter />
      </div>
    </div>
  );
}
