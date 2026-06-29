import { ReactNode } from "react";

const NAV_LINKS = [
  { href: "/", label: "← Back to table" },
  { href: "/about", label: "About" },
  { href: "/disclaimer", label: "Disclaimer" },
  { href: "/contact", label: "Contact" },
];

export default function PageShell({ children, active }: { children: ReactNode; active?: string }) {
  return (
    <div className="max-w-3xl mx-auto px-4 py-8 flex flex-col gap-6 min-h-screen">
      <header className="flex items-center gap-3 flex-wrap border-b border-slate-200 pb-4">
        <a href="/" className="flex items-center gap-2 text-3xl font-bold leading-none text-ink hover:opacity-80 transition-opacity">
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
          <span className="text-amber-600">Kvitlach</span>
        </a>
        <span className="self-end -translate-y-[4px] text-[10px] font-serif uppercase tracking-[0.2em] text-amber-700 leading-tight">
          Ah Heimishe Chanukah Shpil
        </span>
        <span className="self-end -translate-y-[2px] inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-700 shadow-sm">
          Beta
        </span>
        <nav className="ml-auto flex items-center gap-3 text-xs">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className={
                active === link.href
                  ? "font-semibold text-ink underline underline-offset-2"
                  : "text-slate-500 hover:text-ink hover:underline underline-offset-2"
              }
            >
              {link.label}
            </a>
          ))}
        </nav>
      </header>

      <main className="flex-1 space-y-4 text-slate-700">
        {children}
      </main>

      <footer className="mt-8 border-t border-slate-200 pt-4 text-xs text-slate-500 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="font-semibold text-slate-600">Kvitlach</span>
          <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-600">
            v1.5
            <span className="text-amber-700">Beta</span>
          </span>
        </div>
        <nav className="flex items-center gap-4">
          {NAV_LINKS.filter((l) => l.href !== "/").map((link) => (
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
    </div>
  );
}
