/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0f172a",
        sand: "#f5f1e8",
        // Overrides Tailwind's own `blue` scale (not just `accent`) so every
        // literal `blue-*` utility already sprinkled across the lobby/info
        // pages (App.tsx, SiteHeader.tsx, SiteFooter.tsx, RulesModals.tsx,
        // RoomInfoDrawer.tsx, ManageDrawer.tsx, WaitingListDrawer.tsx) gets
        // muted for free, without a second file-by-file sweep. First pass
        // (2026-08-11) reused stock Tailwind blue-600 (#2563eb) verbatim --
        // reported back the same day as too vivid/saturated for a "classy"
        // site next to the cream background. This is a bespoke desaturated
        // steel-blue ramp (hue ~205, well below stock blue's ~217 saturation)
        // instead, at the same lightness steps as Tailwind's default scale so
        // every existing blue-50..blue-900 usage keeps the same relative
        // contrast it was written against.
        blue: {
          50: "#eef2f6",
          100: "#dfe6ee",
          200: "#c3d0de",
          300: "#a0b3c7",
          400: "#7791ac",
          500: "#587490",
          600: "#445d75",
          700: "#384c60",
          800: "#2f3f4f",
          900: "#283542",
        },
        // Matches the new blue-600 above so `bg-accent`/`text-accent`/
        // `border-accent` (the non-literal-`blue-*` call sites) land on the
        // exact same ramp rather than a third similar-but-not-quite blue.
        accent: "#445d75",
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
