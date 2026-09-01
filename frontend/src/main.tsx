import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { router } from "./router";
import { ErrorBoundary } from "./ErrorBoundary";
import { registerServiceWorker } from "./pwa";
import "./index.css";

// Imported for its side effect as much as this call: pwa.ts parks the
// `beforeinstallprompt` event at module scope, and that event can fire before
// React mounts. See pwa.ts.
registerServiceWorker();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <RouterProvider router={router} />
    </ErrorBoundary>
  </React.StrictMode>
);
