/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0f172a",
        sand: "#f5f1e8",
        // Was orange (#f97316) -- re-themed 2026-08-11 to a classy, muted
        // blue against the existing cream (sand) background. Tailwind's own
        // blue-600, reused verbatim (not a bespoke hex) so every literal
        // `blue-*` utility class swapped in alongside this (App.tsx,
        // SiteHeader.tsx, SiteFooter.tsx, RulesModals.tsx) lines up on the
        // exact same ramp instead of two similar-but-not-quite blues.
        accent: "#2563eb",
        accent2: "#0ea5e9",
      },
      fontFamily: {
        display: ["'DidoneRoomNumbers'", "serif"],
        body: ["'Inter'", "ui-sans-serif", "system-ui"],
      },
    },
  },
  plugins: [],
};
