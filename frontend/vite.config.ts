import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // The dev twin of nginx.conf's `location = /api/about`. Anchored regex,
    // not a `/api` prefix, for the same reason it is an exact match there: the
    // backend's HTTP port also serves /admin, and dev should not teach a habit
    // that is a security hole in production. Without this, /api/about in dev
    // returns index.html and the About page silently shows no extra section,
    // which looks identical to the feature not working.
    proxy: {
      "^/api/about$": {
        target: `http://localhost:${process.env.BACKEND_PORT || 3000}`,
        changeOrigin: true,
      },
    },
  },
});
