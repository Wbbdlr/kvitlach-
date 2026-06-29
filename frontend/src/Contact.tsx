import PageShell from "./PageShell";

export default function Contact() {
  return (
    <PageShell active="/contact">
      <h1 className="text-2xl font-semibold text-ink">Contact</h1>

      <section className="space-y-3">
        <p>
          Questions, bug reports, feature ideas, or feedback? We'd love to hear from you.
        </p>
        <p>
          Reach us at{" "}
          <a href="mailto:kvitlach@swdhs.com" className="text-amber-700 font-semibold hover:underline">
            kvitlach@swdhs.com
          </a>
          .
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-xl font-semibold text-ink">What to include</h2>
        <ul className="list-disc list-inside space-y-1">
          <li><strong>Bug reports:</strong> describe what happened, what you expected, and what browser / device you were on.</li>
          <li><strong>Feature ideas:</strong> tell us the game situation where this would help.</li>
          <li><strong>General feedback:</strong> anything from gameplay feel to wording — it all helps.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-xl font-semibold text-ink">Response time</h2>
        <p>
          This is a small project maintained by a small team. We read everything but can't guarantee a reply on any specific timeline. For urgent issues during a live game, try refreshing — most transient bugs resolve on reconnect.
        </p>
      </section>
    </PageShell>
  );
}
