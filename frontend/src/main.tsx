import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { router } from "./router";
import { ErrorBoundary } from "./ErrorBoundary";
import { registerServiceWorker } from "./pwa";
import { loadClientConfig } from "./clientConfig";
import "./index.css";

// Imported for its side effect as much as this call: pwa.ts parks the
// `beforeinstallprompt` event at module scope, and that event can fire before
// React mounts. See pwa.ts.
registerServiceWorker();

// Appearance defaults the operator can change without a build. Not awaited:
// React must not wait on a network round trip to paint, and the stylesheet
// already holds the right answer if this never lands. See clientConfig.ts.
loadClientConfig();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <RouterProvider router={router} />
    </ErrorBoundary>
  </React.StrictMode>
);
