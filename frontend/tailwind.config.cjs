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
        // 'FrankRuhlLibre' first, and the reason is unicode-range rather than
        // order. Its @font-face (index.css) carries a Hebrew-only range, so it
        // can only ever be used for Hebrew characters: Latin skips past it and
        // lands on Inter exactly as before, measured unchanged at 151px for
        // the same word with and without it in the stack.
        //
        // Second would also work today, because Inter is not bundled and the
        // system copy this resolves to has no Hebrew either. First does not
        // depend on that staying true on every machine, which is the only
        // reason to prefer it. It costs nothing: a font that cannot match a
        // Latin character is not consulted for one.
        //
        // Asked for as "for Hebrew words, as the default, something nicer" --
        // so it applies app-wide, with no language attribute to maintain and
        // no per-string switching. A sentence mixing both scripts gets each in
        // the right face.
        body: ["'FrankRuhlLibre'", "'Inter'", "ui-sans-serif", "system-ui"],
        // And again on `sans`, which is what Preflight puts on <html> and what
        // every `font-sans` utility resolves to. Setting it on `body` alone
        // covered less than it looked: measured in the running app, the felt's
        // name plates and its watermark both computed to Tailwind's sans stack
        // rather than ours, so Hebrew on the felt -- the watermark being the
        // main place a banker writes any -- would have gone on rendering in
        // whatever the system offered. Same unicode-range gate, so Latin is
        // untouched here too.
        sans: ["'FrankRuhlLibre'", "'Inter'", "ui-sans-serif", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
