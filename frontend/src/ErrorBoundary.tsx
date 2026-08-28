import React from "react";
import { APP_VERSION } from "./version";

interface Props {
  children: React.ReactNode;
}

interface State {
  error?: Error;
}

// Without this, one throw anywhere in render unmounts the entire tree and
// leaves a blank white page -- no message, no way back except knowing to
// refresh. That is a poor failure for a game people are sitting at mid-hand,
// and an unnecessary one: the session lives in localStorage and the room
// lives on the server, so a reload genuinely does put them back at the table.
// Deliberately does NOT clear the session on the way out, for that reason.
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = {};

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // The browser console is the only place this can go -- there is no
    // client-side error reporting wired up. Logged in full so a player who
    // can be talked through opening the console gives something actionable.
    console.error("Render error caught by ErrorBoundary", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">Something went wrong</h1>
          <p className="mt-2 text-sm text-slate-600">
            The page hit an unexpected error. Your seat at the table is still there — reloading should
            put you straight back in.
          </p>
          <button
            type="button"
            className="mt-4 w-full rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-slate-700"
            onClick={() => window.location.reload()}
          >
            Reload the page
          </button>
          <p className="mt-4 text-xs text-slate-400">
            v{APP_VERSION}
            {this.state.error.message ? ` — ${this.state.error.message}` : ""}
          </p>
        </div>
      </div>
    );
  }
}
