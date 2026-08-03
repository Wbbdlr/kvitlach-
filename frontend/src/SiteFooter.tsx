import { ReactNode } from "react";

const NAV_LINKS = [
  { href: "/about", label: "About" },
  { href: "/disclaimer", label: "Disclaimer" },
  { href: "/contact", label: "Contact" },
];

export interface SiteFooterProps {
  active?: string;
  // Lobby-only extras (WS status, sound toggles) render between the brand
  // badge and the nav -- everything else about the footer is identical
  // across pages, so this is the one seam that needs to differ.
  children?: ReactNode;
}

export default function SiteFooter({ active, children }: SiteFooterProps) {
  return (
    <footer className="mt-8 border-t border-amber-200/70 pt-4 text-xs text-slate-500 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div className="flex items-center gap-3">
        <span className="font-semibold text-slate-600">Kvitlach.us</span>
        <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-slate-600">
          v2.5
          <span className="text-amber-700">Beta</span>
        </span>
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
      <span>© SWS 2026</span>
    </footer>
  );
}
