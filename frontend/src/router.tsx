import { createBrowserRouter } from "react-router-dom";
import { RouteErrorElement } from "./ErrorBoundary";
import App from "./App";
import NotFound, { unknownPathAtBoot } from "./NotFound";
import About from "./About";
import Disclaimer from "./Disclaimer";
import Contact from "./Contact";
import Privacy from "./Privacy";
import Terms from "./Terms";

// Exported separately from main.tsx so state.ts (a vanilla Zustand store,
// not a component -- no access to useNavigate()) can import the router's
// imperative `.navigate()` to keep the address bar in sync with the active
// room. Importing the router straight from main.tsx would create a
// circular import (main.tsx -> App.tsx -> state.ts -> main.tsx); this file
// has no back-reference to either, so there's no cycle.
//
// A single catch-all `*` route for App -- not separate `/` and
// `/table/:roomId` entries -- is deliberate: two distinct route objects
// matching the same element would still remount App on every lobby<->table
// transition (React Router keys route matches by route id, not element
// identity), re-running its WS-connect effect. That's a real bug, not a
// cosmetic one: WSClient.connect() safely no-ops on an already-open socket,
// but the re-run would still re-arm store.init()'s "connecting" status/
// timeout with nothing left to flip it back once the socket's onopen
// handler (only ever assigned once, on the original connect()) doesn't
// fire again. App parses the room id out of the path itself (see
// state.ts's getUrlRoomId) rather than via useParams(), so one route can
// serve every path shape and never remounts on a room transition.
//
// Every route carries an `errorElement`, and it is not optional decoration:
// RouterProvider wraps each route in its own error boundary, INSIDE main.tsx's
// <ErrorBoundary>, so without one a render error never reaches ours -- the
// player gets React Router's built-in white page with a raw stack trace on it
// instead of the reload card. See ErrorBoundary.tsx's RouteErrorElement.
const errorElement = <RouteErrorElement />;

// The catch-all's element, and the reason it is a wrapper rather than a second
// route object: everything above is a real path, and everything else used to
// render the LOBBY as though the link had worked. A mistyped family link was
// therefore indistinguishable from one whose look had simply failed to load,
// which is exactly the report that led here.
//
// One route, two possible elements. Adding `{ path: "*", element: <NotFound/> }`
// alongside the App route would reintroduce the remount described above, and a
// not-found page is nowhere near worth that.
function AppOrNotFound() {
  return unknownPathAtBoot ? <NotFound path={unknownPathAtBoot} /> : <App />;
}

export const router = createBrowserRouter([
  { path: "/about", element: <About />, errorElement },
  { path: "/disclaimer", element: <Disclaimer />, errorElement },
  { path: "/contact", element: <Contact />, errorElement },
  { path: "/privacy", element: <Privacy />, errorElement },
  { path: "/terms", element: <Terms />, errorElement },
  { path: "*", element: <AppOrNotFound />, errorElement },
]);
