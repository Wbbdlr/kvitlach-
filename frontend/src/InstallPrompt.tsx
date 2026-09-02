import { useState } from "react";
import { installNudgeDue, silenceInstallNudge, snoozeInstallNudge, useInstallPrompt } from "./pwa";
import { isIOS, isStandaloneDisplay } from "./table/platform";

// Lobby nudge toward installing the site as an app.
//
// Two different mechanisms behind one banner, because the two platforms share
// nothing: Chrome/Edge hand us a real `beforeinstallprompt` event and a native
// install dialog, while iOS Safari has no install API at all and the only
// route is telling someone which menu item to tap.
//
// The iOS branch reuses TableRoot's IOS_HINT_KEY on purpose. That hint says
// the same thing from inside the table, and someone who has already dismissed
// one should not meet the other -- being told twice how to install an app you
// have decided not to install is how a nudge turns into nagging.
const IOS_HINT_KEY = "kvitlach.iosInstallHintSeen";
const INSTALL_HINT_KEY = "kvitlach.installHintSeen";

export default function InstallPrompt() {
  const { canInstall, promptInstall } = useInstallPrompt();
  const iosCandidate = isIOS() && !isStandaloneDisplay();
  const storageKey = canInstall ? INSTALL_HINT_KEY : IOS_HINT_KEY;
  // "Not now" is a snooze, not a tombstone -- see pwa.ts. Read once on mount,
  // because a due date that flipped mid-session would pop the banner back up
  // under someone who had just closed it.
  const [dismissed, setDismissed] = useState(() => !installNudgeDue(storageKey));

  // Already installed and launched from the home screen: nothing to offer.
  if (isStandaloneDisplay()) return null;
  if (dismissed) return null;
  if (!canInstall && !iosCandidate) return null;

  const dismiss = () => {
    setDismissed(true);
    snoozeInstallNudge(storageKey);
  };

  return (
    <section className="card-surface mb-4 flex flex-wrap items-center gap-3 border-l-4 border-accent px-4 py-3">
      <svg className="h-5 w-5 shrink-0 text-accent" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path d="M7 2a2 2 0 00-2 2v12a2 2 0 002 2h6a2 2 0 002-2V4a2 2 0 00-2-2H7zm3 14a1 1 0 110-2 1 1 0 010 2z" />
      </svg>
      <div className="min-w-[14rem] flex-1 text-sm text-ink">
        <p className="font-semibold">Add Kvitlach to your phone</p>
        <p className="text-xs text-slate-600">
          {canInstall
            ? "Installs as an app: full screen, no browser bars, and it opens straight to the table."
            : "Tap Share, then “Add to Home Screen”. It opens full screen with no browser bars."}
        </p>
      </div>
      {canInstall && (
        <button
          type="button"
          className="rounded-full bg-accent px-4 py-2 text-xs font-semibold tracking-wide text-white shadow-sm transition-colors duration-200 hover:bg-accent/90"
          onClick={async () => {
            const outcome = await promptInstall();
            // "dismissed" here is the outcome of the BROWSER's own dialog, not
            // our banner. Chrome re-offers that on a later visit, so it is not
            // a no -- only an accept silences this for good.
            if (outcome === "accepted") {
              setDismissed(true);
              silenceInstallNudge(storageKey);
            }
          }}
        >
          Install
        </button>
      )}
      <button
        type="button"
        className="rounded-full border border-slate-300 px-3 py-2 text-xs font-semibold tracking-wide text-slate-600 transition-colors duration-200 hover:bg-slate-100"
        onClick={dismiss}
      >
        Not now
      </button>
    </section>
  );
}
