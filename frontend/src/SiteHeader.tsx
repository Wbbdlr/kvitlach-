const NAV_LINKS = [
  { href: "/about", label: "About" },
  { href: "/disclaimer", label: "Disclaimer" },
  { href: "/contact", label: "Contact" },
];

export interface SiteHeaderProps {
  // Info pages (About/Disclaimer/Contact) show the top nav; the lobby
  // doesn't -- it's the home page, and the footer already links out to
  // these, so a second copy right above it would just be clutter.
  showNav?: boolean;
  active?: string;
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
            src="/11.png"
            alt=""
            aria-hidden="true"
            className="absolute h-9 w-auto -rotate-[24deg] -translate-x-[2px] drop-shadow-sm z-10"
            loading="lazy"
          />
          <img
            src="/12.png"
            alt=""
            aria-hidden="true"
            className="absolute h-9 w-auto rotate-[23deg] translate-x-[16px] drop-shadow-sm"
            loading="lazy"
          />
        </span>
        <span className="text-blue-600">Kvitlach</span>
      </a>
      <span className="self-end -translate-y-[4px] text-[10px] font-serif uppercase tracking-[0.2em] text-blue-700/80 leading-tight">
        Ah Heimishe Chanukah Shpil
      </span>
      <span className="self-end -translate-y-[2px] inline-flex items-center gap-1 rounded-full border border-blue-300 bg-blue-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-blue-700 shadow-sm">
        Beta
      </span>
      {showNav && (
        <nav className="ml-auto flex items-center gap-4 text-xs">
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
    </header>
  );
}
