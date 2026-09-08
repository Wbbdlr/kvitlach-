import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // The dev twin of nginx.conf's three `location = /api/...` blocks.
    // Anchored regex per route, not an `/api` prefix, for the same reason
    // it is an exact match there: the backend's HTTP port also serves
    // /admin, and dev should not teach a habit that is a security hole in
    // production. Without one of these, that page's own /api/... call in
    // dev returns index.html and the page silently shows no extra section
    // (About/Contact) or no override (Disclaimer) -- which looks identical
    // to the feature not working. Add a new anchored entry here, and a new
    // exact-match location in nginx.conf, together -- one without the other
    // fails in only one of the two environments.
    proxy: {
      "^/api/about$": {
        target: `http://localhost:${process.env.BACKEND_PORT || 3000}`,
        changeOrigin: true,
      },
      "^/api/contact$": {
        target: `http://localhost:${process.env.BACKEND_PORT || 3000}`,
        changeOrigin: true,
      },
      "^/api/disclaimer$": {
        target: `http://localhost:${process.env.BACKEND_PORT || 3000}`,
        changeOrigin: true,
      },
      // Mirrors frontend/nginx.conf, which is what carries this in
      // production. Without it a crash in `npm run dev` posts into Vite's
      // own 404 and the whole point of the feature -- being able to read
      // what crashed -- is missing exactly where it is being developed.
      "^/api/client-error$": {
        target: `http://localhost:${process.env.BACKEND_PORT || 3000}`,
        changeOrigin: true,
      },
    },
  },
});
