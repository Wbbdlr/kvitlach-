import { ReactNode } from "react";
import SiteHeader from "./SiteHeader";
import SiteFooter from "./SiteFooter";

export default function PageShell({ children, active }: { children: ReactNode; active?: string }) {
  return (
    <div className="max-w-3xl mx-auto px-4 py-8 flex flex-col gap-6 min-h-screen">
      <SiteHeader showNav active={active} />

      <main className="flex-1 space-y-4 text-slate-700">{children}</main>

      <SiteFooter active={active} />
    </div>
  );
}
