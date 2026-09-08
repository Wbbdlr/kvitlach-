// The client half of GET /api/config: the only thing the server tells this app
// about how the game should look.
//
// Fetched once, at boot, before React mounts. Deliberately not re-fetched on
// reconnect or polled: these are appearance defaults an operator changes rarely
// and deliberately, and a colour that changed under a player mid-round would
// read as a rendering fault rather than as a setting. The contract is "you get
// it on your next page load", and the admin page says exactly that.
//
// Everything here is best-effort. A blocked request, a dead backend, a cached
// bundle, a practice table with no network at all: the stylesheet's own :root
// values are already correct, so the failure mode is the shipped look, which is
// why nothing below ever throws or reports.

/** Mirrors CardEffectsRecord in backend/src/client-config.ts. */
interface CardEffects {
  winColor: string;
  winScalePeak: number;
  winScaleRest: number;
  futchColor: string;
  futchScale: number;
  futchSaturate: number;
}

// The same floors and ceilings the server clamps to, restated rather than
// imported -- there is no shared package between the two halves of this repo,
// and the alternative to restating them is trusting the response, which is the
// thing this file specifically does not do.
const BOUNDS: Record<string, [number, number]> = {
  winScalePeak: [1.02, 1.2],
  winScaleRest: [1.0, 1.12],
  futchScale: [0.8, 0.98],
  futchSaturate: [0, 0.9],
};

const HEX = /^#[0-9a-f]{6}$/;

/**
 * `#rrggbb` to the `r, g, b` triplet the keyframes need, or null.
 *
 * Re-validating a response from our own origin is not paranoia about the
 * server, it is about the destination: this string is written into a CSS custom
 * property, which is not parsed until it is substituted, so anything that
 * reaches it can author CSS on the table. The server already refuses everything
 * but a hex colour; a second check on this side costs one regex and means no
 * single compromised link in the chain is enough.
 */
export function hexToTriplet(hex: unknown): string | null {
  if (typeof hex !== "string") return null;
  const value = hex.trim().toLowerCase();
  if (!HEX.test(value)) return null;
  return [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16)).join(", ");
}

function clamped(value: unknown, key: string): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const [min, max] = BOUNDS[key];
  return String(Math.min(max, Math.max(min, value)));
}

/**
 * Writes the effects onto <html> as inline custom properties, which beat the
 * stylesheet's :root defaults by specificity.
 *
 * Per-property rather than all-or-nothing: a payload with one bad field still
 * applies its five good ones, and the bad one keeps the shipped value. Exported
 * for the tests, which is the only way to prove this without a server.
 */
export function applyCardEffects(raw: Partial<CardEffects> | undefined | null): void {
  if (!raw || typeof raw !== "object") return;
  const root = document.documentElement;
  const set = (prop: string, value: string | null) => {
    if (value !== null) root.style.setProperty(prop, value);
  };
  set("--k-win-rgb", hexToTriplet(raw.winColor));
  set("--k-win-scale-peak", clamped(raw.winScalePeak, "winScalePeak"));
  set("--k-win-scale-rest", clamped(raw.winScaleRest, "winScaleRest"));
  set("--k-futch-rgb", hexToTriplet(raw.futchColor));
  set("--k-futch-scale", clamped(raw.futchScale, "futchScale"));
  set("--k-futch-saturate", clamped(raw.futchSaturate, "futchSaturate"));
}

/**
 * Fetches the config and applies it. Never rejects, never reports.
 *
 * Not awaited by the caller: React must not wait on a network round trip to
 * paint, and a card cannot win a hand in the milliseconds before this lands.
 */
export function loadClientConfig(): void {
  try {
    fetch("/api/config", { headers: { accept: "application/json" } })
      .then((res) => (res.ok ? res.json() : null))
      .then((doc) => applyCardEffects(doc?.cardEffects))
      .catch(() => {});
  } catch {
    // fetch itself throwing (no such API, a hostile polyfill) is not worth a
    // second code path -- the stylesheet already has the right answer.
  }
}
