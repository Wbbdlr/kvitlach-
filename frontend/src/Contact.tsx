import { useEffect, useState } from "react";
import PageShell from "./PageShell";

// Operator-authored copy, edited from /admin and served by the backend
// through an exact-path nginx proxy (frontend/nginx.conf). Same shape and
// same reasoning as About.tsx's own useAboutExtra -- see its comment for why
// this is rendered as TEXT, split into <p> elements, never as HTML.
interface ContactExtra {
  heading: string;
  body: string;
}

function useContactExtra(): ContactExtra | null {
  const [extra, setExtra] = useState<ContactExtra | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/contact", { headers: { accept: "application/json" } })
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

export default function Contact() {
  const extra = useContactExtra();
  return (
    <PageShell active="/contact">
      <h1 className="text-3xl font-bold text-amber-800">Contact</h1>

      <section className="space-y-3 border-l-2 border-amber-200 pl-4">
        <p>
          Questions, bug reports, feature ideas, or feedback? We'd love to hear from you.
        </p>
        <p>
          Reach us at{" "}
          <a href="mailto:info@kvitlach.us" className="text-amber-700 font-semibold hover:underline">
            info@kvitlach.us
          </a>
          .
        </p>
      </section>

      <section className="space-y-2 border-l-2 border-amber-200 pl-4">
        <h2 className="text-lg font-semibold text-amber-700">What to include</h2>
        <ul className="list-disc list-inside space-y-1">
          <li><strong>Bug reports:</strong> describe what happened, what you expected, and what browser / device you were on.</li>
          <li><strong>Feature ideas:</strong> tell us the game situation where this would help.</li>
          <li><strong>General feedback:</strong> anything from gameplay feel to wording - it all helps.</li>
        </ul>
      </section>

      <section className="space-y-2 border-l-2 border-amber-200 pl-4">
        <h2 className="text-lg font-semibold text-amber-700">Response time</h2>
        <p>
          This is a small project maintained by a small team. We read everything but can't guarantee a reply on any specific timeline. For urgent issues during a live game, try refreshing - most transient bugs resolve on reconnect.
        </p>
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
