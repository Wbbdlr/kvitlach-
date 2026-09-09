import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { router } from "./router";
import { ErrorBoundary } from "./ErrorBoundary";
import { registerServiceWorker } from "./pwa";
import { loadClientConfig } from "./clientConfig";
import { loadFamilyProfile } from "./familyProfile";
import { initPageTheme } from "./pageTheme";
import "./index.css";

// Imported for its side effect as much as this call: pwa.ts parks the
// `beforeinstallprompt` event at module scope, and that event can fire before
// React mounts. See pwa.ts.
registerServiceWorker();

// Appearance defaults the operator can change without a build. Not awaited:
// React must not wait on a network round trip to paint, and the stylesheet
// already holds the right answer if this never lands. See clientConfig.ts.
loadClientConfig();

// Light or dark for the lobby and info pages. Before React paints, or the page
// flashes light and then corrects itself -- which is worse on a dark page than
// never having offered dark at all.
initPageTheme();

// The family link, kvitlach.us/m/<slug>. Read off the pathname here rather
// than as a route: router.tsx is a deliberate single catch-all, and a second
// route object would remount App on every path change. See familyProfile.ts.
loadFamilyProfile();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <RouterProvider router={router} />
    </ErrorBoundary>
  </React.StrictMode>
);
