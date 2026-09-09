/** @type {import('tailwindcss').Config} */
const plugin = require("tailwindcss/plugin");
const palette = require("tailwindcss/colors");

// ---------------------------------------------------------------------------
// Dark mode for the LOBBY AND INFO PAGES ONLY -- never the table, which is a
// lit felt in a dark room already and has its own art direction.
//
// Mechanism, and it is chosen to be complete BY CONSTRUCTION rather than by
// diligence: every colour these pages use is emitted as a CSS variable, and
// dark mode redefines the variables. Nothing is themed by hand at a call site,
// so there is no such thing as a utility somebody forgot to give a `dark:`
// variant to. That failure mode is not hypothetical -- it is exactly how the
// admin panel came to serve white text on white fields, twice.
//
// The dark ramp is the light ramp REVERSED (50 <-> 900, 100 <-> 800, ...),
// which is what makes it systematic instead of forty separate judgement calls:
// a `bg-blue-50` surface becomes the darkest blue, `text-blue-800` becomes a
// pale one, and every pairing an author already chose for contrast keeps that
// contrast with its polarity flipped. Neutrals do the same, with `white` and
// `ink` as each other's opposites.
//
// Values come from Tailwind's own palette object rather than being copied in
// as hex, so the LIGHT rendering is unchanged by construction too.
const RAMP = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];
const MIRROR = { 50: 900, 100: 800, 200: 700, 300: 600, 400: 500, 500: 400, 600: 300, 700: 200, 800: 100, 900: 50 };

// The bespoke steel-blue below, restated here so the loop can read it like any
// other family. Kept in one place: FAMILIES is the source for both.
const STEEL = {
  50: "#eef2f6", 100: "#dfe6ee", 200: "#c3d0de", 300: "#a0b3c7", 400: "#7791ac",
  500: "#587490", 600: "#445d75", 700: "#384c60", 800: "#2f3f4f", 900: "#283542",
};

const FAMILIES = {
  blue: STEEL,
  slate: palette.slate,
  amber: palette.amber,
  red: palette.red,
  emerald: palette.emerald,
  rose: palette.rose,
};

/** "#rrggbb" -> "r g b", the channel form Tailwind's <alpha-value> needs. */
function channels(hex) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)).join(" ");
}

const INK = "#0f172a";
const WHITE = "#ffffff";

function varsFor(dark) {
  const out = {};
  for (const [family, ramp] of Object.entries(FAMILIES)) {
    for (const step of RAMP) {
      const source = dark ? ramp[MIRROR[step]] : ramp[step];
      if (source) out[`--k-${family}-${step}`] = channels(source);
    }
  }
  // A surface and the text on it, as each other's opposites in both modes.
  out["--k-white"] = channels(dark ? palette.slate[900] : WHITE);
  out["--k-ink"] = channels(dark ? palette.slate[100] : INK);
  out["--k-sand"] = channels(dark ? palette.slate[800] : "#f5f1e8");
  // The one accent outside the ramps. Lightened rather than mirrored: it is
  // already a bright sky blue, and its mirror would be darker, not lighter.
  out["--k-accent2"] = channels(dark ? palette.sky[300] : "#0ea5e9");
  // The tagline under the wordmark. Gold in dark, matching the wordmark
  // itself; the same gold on the light sand ground measures about 1.9:1 at
  // 13px, so light keeps the readable steel-blue. Asked for as "in the same
  // gold as Kvitlach (at least in dark mode)" -- this is the "at least".
  out["--k-tagline"] = dark ? channels("#e6a44b") : channels(STEEL[700]);
  // Form fields. Without an explicit colour they fall to the USER AGENT's dark
  // field grey (roughly #2b2b2b), which is a flat neutral sitting on a slate
  // palette -- reported as "this ugly grey background". Deeper than the card
  // it sits on rather than lighter, so a field reads as a well in the surface.
  out["--k-field"] = channels(dark ? palette.slate[950] : "#ffffff");
  out["--k-field-border"] = channels(dark ? palette.slate[600] : palette.slate[300]);
  return out;
}

/** theme colours that read the variables above. */
function themeFamily(family) {
  return Object.fromEntries(RAMP.map((step) => [step, `rgb(var(--k-${family}-${step}) / <alpha-value>)`]));
}

// Applied to BODY, not :root, and only when no table is on screen. .k-fit is
// the table's viewport box, so a table renders with the light values exactly
// as it does today -- including anything StageOverlay portals out to <body>.
const DARK_SCOPE = 'body:not(:has(.k-fit))';

module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "rgb(var(--k-ink) / <alpha-value>)",
        sand: "rgb(var(--k-sand) / <alpha-value>)",
        white: "rgb(var(--k-white) / <alpha-value>)",
        slate: themeFamily("slate"),
        amber: themeFamily("amber"),
        red: themeFamily("red"),
        emerald: themeFamily("emerald"),
        rose: themeFamily("rose"),
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
        blue: themeFamily("blue"),
        // Matches the new blue-600 above so `bg-accent`/`text-accent`/
        // `border-accent` (the non-literal-`blue-*` call sites) land on the
        // exact same ramp rather than a third similar-but-not-quite blue.
        // Reads the SAME variable as blue-600, which is what it has always
        // been a copy of -- so it follows the ramp into dark mode instead of
        // staying a fixed steel-blue on a slate ground. It was left literal in
        // the first pass and the contrast sweep found it immediately: "How to
        // play" and "What is Kvitlach?" came out at 1.41:1 and 1.83:1.
        accent: "rgb(var(--k-blue-600) / <alpha-value>)",
        accent2: "rgb(var(--k-accent2) / <alpha-value>)",
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
  plugins: [
    plugin(({ addBase }) => {
      const light = varsFor(false);
      const dark = varsFor(true);
      addBase({
        ":root": light,
        // An explicit choice wins in both directions; "system" is the absence
        // of the attribute, which is what a viewer who has never chosen has.
        [`html[data-page-theme="dark"] ${DARK_SCOPE}`]: dark,
        "@media (prefers-color-scheme: dark)": {
          [`html:not([data-page-theme="light"]) ${DARK_SCOPE}`]: dark,
        },
      });
    }),
  ],
};
