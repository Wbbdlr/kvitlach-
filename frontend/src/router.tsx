import { createBrowserRouter } from "react-router-dom";
import App from "./App";
import About from "./About";
import Disclaimer from "./Disclaimer";
import Contact from "./Contact";

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
export const router = createBrowserRouter([
  { path: "/about", element: <About /> },
  { path: "/disclaimer", element: <Disclaimer /> },
  { path: "/contact", element: <Contact /> },
  { path: "*", element: <App /> },
]);
