import { ReactNode, useRef, useState } from "react";
import { APP_VERSION, firstPushedDate } from "./version";
import { useEscapeKey } from "./useEscapeKey";
import { useClickOutside } from "./table/clickOutside";

const NAV_LINKS = [
  { href: "/about", label: "About" },
  { href: "/disclaimer", label: "Disclaimer" },
  { href: "/contact", label: "Contact" },
];

// "September 3, 2026" from version.ts's "2026-09-03". Split and handed to
// Date.UTC rather than `new Date("2026-09-03")` -- the latter parses as UTC
// midnight and then renders in the VIEWER'S OWN timezone, which puts anyone
// west of Greenwich a day early. The date only ever needs to read as the
// calendar day it was recorded under, never as a moment in time.
function formatShipDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export interface SiteFooterProps {
  active?: string;
  // Lobby-only extras (WS status, sound toggles) render between the brand
  // badge and the nav -- everything else about the footer is identical
  // across pages, so this is the one seam that needs to differ.
  children?: ReactNode;
}

export default function SiteFooter({ active, children }: SiteFooterProps) {
  // Asked for directly: a way to answer "did I get today's fix" without
  // reading git log, since that's the whole reason this badge exists
  // (see version.ts's own comment) but a bare number doesn't say WHEN.
  const [showShipDate, setShowShipDate] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEscapeKey(() => setShowShipDate(false), showShipDate);
  useClickOutside([wrapRef], () => setShowShipDate(false), showShipDate);
  const shipDate = firstPushedDate(APP_VERSION);

  return (
    <footer className="mt-8 border-t border-blue-200/70 pt-4 text-xs text-slate-500 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div className="flex items-center gap-3">
        <span className="font-semibold text-slate-600">Kvitlach.us</span>
        <div ref={wrapRef} className="relative">
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:border-blue-300 hover:bg-blue-100"
            onClick={() => setShowShipDate((v) => !v)}
            aria-expanded={showShipDate}
          >
            v{APP_VERSION}
            <span className="text-blue-700">Beta</span>
          </button>
          {showShipDate && (
            <div
              role="status"
              className="absolute bottom-full left-0 z-10 mb-2 w-max max-w-[calc(100vw-2rem)] rounded-lg border border-blue-200 bg-white px-3 py-2 text-[11px] font-normal text-slate-600 shadow-lg"
            >
              {shipDate ? (
                <>
                  v{APP_VERSION} first shipped <span className="font-semibold text-slate-700">{formatShipDate(shipDate)}</span>
                </>
              ) : (
                // Only reachable if a bump landed here without its
                // VERSION_HISTORY entry -- see the comment in version.ts.
                <>No ship date recorded yet for v{APP_VERSION}.</>
              )}
            </div>
          )}
        </div>
      </div>
      {children}
      <nav className="flex items-center gap-4">
        {NAV_LINKS.map((link) => (
          <a
            key={link.href}
            href={link.href}
            className={active === link.href ? "text-ink font-semibold" : "hover:text-ink underline-offset-4 hover:underline"}
          >
            {link.label}
          </a>
        ))}
      </nav>
      <span>
        © SWS 2026 · Developed by{" "}
        <a
          href="https://computerrabbis.com"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-ink underline-offset-4 hover:underline"
        >
          ComputerRabbis.com
        </a>
      </span>
    </footer>
  );
}
