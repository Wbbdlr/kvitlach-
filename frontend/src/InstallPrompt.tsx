import { useState } from "react";
import { useInstallPrompt } from "./pwa";
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

function readDismissed(key: string): boolean {
  if (typeof window === "undefined" || !window.localStorage) return true;
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    // Private mode and "block site data" both throw here. Showing the banner
    // is the safe failure: it is dismissible, it just will not stay dismissed.
    return false;
  }
}

function markDismissed(key: string): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(key, "1");
  } catch {
    /* ignore -- reappears next visit, not worth failing over */
  }
}

export default function InstallPrompt() {
  const { canInstall, promptInstall } = useInstallPrompt();
  const iosCandidate = isIOS() && !isStandaloneDisplay();
  const storageKey = canInstall ? INSTALL_HINT_KEY : IOS_HINT_KEY;
  const [dismissed, setDismissed] = useState(() => readDismissed(storageKey));

  // Already installed and launched from the home screen: nothing to offer.
  if (isStandaloneDisplay()) return null;
  if (dismissed) return null;
  if (!canInstall && !iosCandidate) return null;

  const dismiss = () => {
    setDismissed(true);
    markDismissed(storageKey);
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
            // "dismissed" is not a no -- Chrome re-offers on a later visit, so
            // the banner is only silenced for good once they accept.
            if (outcome === "accepted") dismiss();
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
