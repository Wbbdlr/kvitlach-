import { useEffect, useState } from "react";
import { cardImages } from "./table/selectors";
import { PAGE_THEME_EVENT, loadPageTheme, resolvesDark, togglePageTheme } from "./pageTheme";
import { toggleFeedback } from "./uiFeedback";
const NAV_LINKS = [
  { href: "/about", label: "About" },
  { href: "/disclaimer", label: "Disclaimer" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/contact", label: "Contact" },
];

export interface SiteHeaderProps {
  // Info pages (About/Disclaimer/Contact) show the top nav; the lobby
  // doesn't -- it's the home page, and the footer already links out to
  // these, so a second copy right above it would just be clutter.
  showNav?: boolean;
  active?: string;
}


// Light/dark, for the lobby and info pages only -- the table has its own art
// direction and is excluded in CSS (see tailwind.config.cjs).
//
// The icon shows what you will GET, not what you are in: a control captioned
// with the current state reads as a status readout and gets pressed by people
// trying to reach the other one.
function ThemeToggle() {
  const [dark, setDark] = useState(() => resolvesDark(loadPageTheme()));

  useEffect(() => {
    const sync = () => setDark(resolvesDark(loadPageTheme()));
    window.addEventListener(PAGE_THEME_EVENT, sync);
    // Anyone still on "system" follows the device, including a change made
    // while the page is open -- sunset on a phone, or a laptop switching
    // itself. Without this the CSS would flip and this icon would not.
    // Guarded: jsdom has no matchMedia at all, and an unguarded call here
    // threw during render -- which took out every page that renders this
    // header, nineteen tests across five suites, for a listener that only ever
    // provides a nicety.
    let media: MediaQueryList | undefined;
    try {
      media = window.matchMedia("(prefers-color-scheme: dark)");
      media.addEventListener?.("change", sync);
    } catch {
      /* no matchMedia; the theme still applies, it just will not track a
         device change made while the page is open */
    }
    sync();
    return () => {
      window.removeEventListener(PAGE_THEME_EVENT, sync);
      media?.removeEventListener?.("change", sync);
    };
  }, []);

  return (
    <button
      type="button"
      onClick={() => {
        toggleFeedback();
        setDark(togglePageTheme() === "dark");
      }}
      className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-blue-200 bg-white text-blue-700 transition-colors hover:border-blue-300 hover:bg-blue-50"
      aria-label={dark ? "Switch to the light look" : "Switch to the dark look"}
      title={dark ? "Switch to the light look" : "Switch to the dark look"}
    >
      {dark ? (
        // A sun: pressing this returns you to light.
        <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <circle cx="10" cy="10" r="3.4" />
          <path strokeLinecap="round" d="M10 2.4v1.7M10 15.9v1.7M2.4 10h1.7M15.9 10h1.7M4.6 4.6l1.2 1.2M14.2 14.2l1.2 1.2M15.4 4.6l-1.2 1.2M5.8 14.2l-1.2 1.2" />
        </svg>
      ) : (
        // A moon, drawn as one path rather than a circle with a bite taken
        // out of it, so it keeps its shape against any background.
        <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden="true">
          <path d="M16.3 12.6A6.9 6.9 0 0 1 7.4 3.7a1 1 0 0 0-1.3-1.2 8.6 8.6 0 1 0 11.4 11.4 1 1 0 0 0-1.2-1.3z" />
        </svg>
      )}
    </button>
  );
}

export default function SiteHeader({ showNav = false, active }: SiteHeaderProps) {
  return (
    <header className="flex items-center gap-3 flex-wrap border-b border-blue-200/70 pb-4">
      <a
        href="/"
        className="flex items-center gap-2 text-2xl sm:text-3xl font-bold leading-none text-ink hover:opacity-80 transition-opacity"
      >
        <span className="relative inline-flex h-9 w-10 items-center justify-center pointer-events-none">
          <img
            src={cardImages["11"]}
            alt=""
            aria-hidden="true"
            className="absolute h-9 w-auto -rotate-[24deg] -translate-x-[2px] drop-shadow-sm z-10"
            loading="lazy"
          />
          <img
            src={cardImages["12"]}
            alt=""
            aria-hidden="true"
            className="absolute h-9 w-auto rotate-[23deg] translate-x-[16px] drop-shadow-sm"
            loading="lazy"
          />
        </span>
        {/* Gold, not the lobby's blue accent -- this is the game's own brand
            mark, not a themeable UI element, so it doesn't follow the blue
            reskin below it. `var(--gold)` (index.css :root), the exact same
            custom value the in-table wordmark (.k-logo-word) uses -- an
            earlier pass here reached for Tailwind's amber-600 as a "close
            enough" gold, but side by side the two don't actually match
            (amber-600 reads noticeably more orange/yellow); this is the
            real one, not an approximation. */}
        <span className="k-brand-face" style={{ color: "var(--gold)" }}>
          Kvitlach
          {/* Unregistered-use claim, not a registration mark -- no filing
              behind this, so it stays TM rather than (r). Small and
              baseline-aligned so it reads as a mark on the word, not a
              fourth character in it; see Disclaimer.tsx's IP section for
              the actual notice this points at. */}
          <sup className="text-[0.5em] font-normal align-super ml-0.5">&trade;</sup>
        </span>
      </a>
      {/* Set in the serif rather than as letterspaced micro-caps. It is a
          phrase, not a label, and caps at 10px with 0.2em tracking read as UI
          chrome next to a wordmark that is trying to be a wordmark.
          NOT italic: this Newsreader subset ships upright only (see its
          @font-face), so `italic` would be synthesised by slanting the
          uprights -- which is exactly the smear the subset's own comment warns
          about for synthesised bold. */}
      {/* Tucked in closer to the wordmark and sitting on the same floor as it:
          the header's own gap-3 plus a 3px lift left it reading as a separate
          item in the row rather than as the wordmark's tagline. No vertical
          nudge at all -- self-end puts it on the wordmark's own baseline, and
          both a lift and a drop were tried and looked detached. */}
      <span className="k-tagline self-end -ml-1.5 text-[13px] leading-tight" style={{ fontFamily: "var(--k-plate-font)" }}>
        Ah Heimishe Chanukah Shpil
      </span>
      <div className={showNav ? "ml-auto flex items-center gap-4" : "ml-auto"}>
        {showNav && (
          <nav className="flex items-center gap-4 text-xs">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className={
                active === link.href
                  ? "font-semibold text-ink underline underline-offset-4 decoration-blue-400"
                  : "text-slate-500 hover:text-ink hover:underline underline-offset-4"
              }
            >
              {link.label}
            </a>
            ))}
          </nav>
        )}
        <ThemeToggle />
      </div>
    </header>
  );
}
