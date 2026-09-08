// Felt theme system for the table UI overhaul.
// Felt is a per-user preference (like the sound/music toggles), persisted to
// localStorage so each player's table color sticks across reloads. It only
// affects the local client's view - never other players'.

import { useCallback, useEffect, useState } from "react";

export type FeltName = "green" | "burgundy" | "navy" | "spruce" | "plum";

export interface Felt {
  hi: string;   // lighter center of the felt gradient
  lo: string;   // darker edge of the felt gradient
  rail: string; // wooden rail border
  label: string;
  bet: string;   // bet/blatt button accent, coordinated with this felt
  hit: string;   // hit button accent
  stand: string; // stand button accent
  /**
   * Whether the felt switcher offers it. False means a family profile can name
   * it and nothing else can reach it.
   *
   * A flag rather than a "family felts" list, deliberately: the switcher
   * filters on this, and nothing anywhere asks "is this a family table". Adding
   * a third reserved felt is then a row here, not a branch somewhere.
   */
  listed: boolean;
}

// Bet stays amber/gold-ish across felts (the app's one universal accent);
// hit and stand vary per felt so neither blends into that felt's own hue.
export const FELTS: Record<FeltName, Felt> = {
  green: { hi: "#24503a", lo: "#12271c", rail: "#4a3320", label: "Green", bet: "#d97706", hit: "#2f7dc9", stand: "#a8532e", listed: true },
  burgundy: { hi: "#5a2733", lo: "#280f16", rail: "#4a3320", label: "Burgundy", bet: "#d9a441", hit: "#2f9e6f", stand: "#6b4423", listed: true },
  navy: { hi: "#24405e", lo: "#0d1a2b", rail: "#3a3320", label: "Navy", bet: "#d9a441", hit: "#c2622a", stand: "#5a3d7a", listed: true },
  // The two held back for family profiles. Chosen to sit clear of the three
  // above under the felt's own gradient -- spruce leans blue so it does not
  // read as green, plum leans blue-purple so it does not read as burgundy --
  // and both hold gold, which matters because gold is the app's one fixed
  // accent: the card highlights, the active-turn glow and the wordmark are not
  // themeable and have to keep working over whatever felt is underneath.
  spruce: { hi: "#1f4a44", lo: "#0e2724", rail: "#43331f", label: "Spruce", bet: "#d9a441", hit: "#2f7dc9", stand: "#a8532e", listed: false },
  plum: { hi: "#43304e", lo: "#20162a", rail: "#43331f", label: "Plum", bet: "#d9a441", hit: "#2f9e6f", stand: "#a8532e", listed: false },
};

/** What the felt switcher offers. See Felt.listed. */
export const LISTED_FELTS: FeltName[] = (Object.keys(FELTS) as FeltName[]).filter((n) => FELTS[n].listed);

// Navy, not the green this shipped with. Green is also the felt every one of
// the twelve capture viewports photographs, and the felt-contrast audit
// (e2e/tests/felt-contrast.spec.ts) measures it as the WORST of the three for
// text sitting on the felt -- 3.1:1 for the shoe/discard captions against
// navy's 3.5:1. Changing the default does not fix that (the fix is that those
// captions carry their own background), but it is worth knowing the default
// and the worst case were the same colour.
//
// Only affects clients with nothing saved: loadFelt() below prefers
// localStorage, so anyone who has ever picked a felt keeps theirs.
export const DEFAULT_FELT: FeltName = "navy";

const STORAGE_KEY = "kvitlach.felt";

// The operator's chosen defaults, if this client has heard them. Held in module
// scope rather than written into localStorage, and that is the important part:
// writing them would record a choice the player never made, and a later change
// to the house theme would then never reach them -- they would look, to this
// code, exactly like somebody who had picked that felt on purpose.
//
// Precedence, decided rather than fallen into: SAVED CHOICE beats HOUSE beats
// SHIPPED DEFAULT. A player who chose burgundy in December opens in burgundy
// however the house feels about it.
let houseFelt: FeltName | null = null;
let houseChip: ChipName | null = null;
// A family profile's own colours, kept SEPARATE from the operator's house
// default above rather than sharing one variable. They arrive from different
// places at different times -- /api/config at boot, a family profile from a
// link or from a table's room state -- and with one variable whichever landed
// second silently won. Two, with a stated order, is the only way the answer
// does not depend on network timing. Precedence below in loadFelt().
let familyFelt: FeltName | null = null;
let familyChip: ChipName | null = null;

/** Fires when either set of defaults lands, so the hooks below can catch up. */
export const HOUSE_THEME_EVENT = "kvitlach:house-theme";

/**
 * Applied by clientConfig.ts when GET /api/config resolves -- which may be
 * before or after React mounts, hence the event. Unknown names are ignored
 * rather than stored, so a payload naming a felt this build does not have
 * leaves the player on the shipped one.
 */
export function setHouseTheme(felt: unknown, chip: unknown): void {
  houseFelt = typeof felt === "string" && felt in FELTS ? (felt as FeltName) : null;
  houseChip = typeof chip === "string" && chip in CHIPS ? (chip as ChipName) : null;
  announce();
}

/**
 * A family profile's colours, or null to go back to the house look.
 *
 * Clearing has to be possible, and that is not obvious until you leave a family
 * table: an earlier version only ever SET these, so walking away from a
 * family's felt left you on it forever. Passing an unknown name clears for the
 * same reason it does above -- a felt this build has never heard of is not a
 * felt, and silently keeping the last one would be a stranger answer than
 * falling back.
 */
export function setFamilyTheme(felt: unknown, chip: unknown): void {
  familyFelt = typeof felt === "string" && felt in FELTS ? (felt as FeltName) : null;
  familyChip = typeof chip === "string" && chip in CHIPS ? (chip as ChipName) : null;
  announce();
}

function announce(): void {
  try {
    window.dispatchEvent(new Event(HOUSE_THEME_EVENT));
  } catch {
    /* no window (tests, SSR) -- the values above are still set */
  }
}

/** The raw stored value, or null. What separates "chose this" from "never chose". */
function stored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function loadFelt(): FeltName {
  const saved = stored(STORAGE_KEY);
  if (saved && saved in FELTS) return saved as FeltName;
  // saved choice > the family's felt > the operator's house default > shipped.
  return familyFelt ?? houseFelt ?? DEFAULT_FELT;
}

export function saveFelt(name: FeltName): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, name);
  } catch {
    /* ignore persistence failures */
  }
}

// Apply a felt to the document root via CSS custom properties. Components read
// var(--felt-hi) / var(--felt-lo) / var(--felt-rail) so a single call recolors
// the whole table instantly.
export function applyFelt(name: FeltName): void {
  const felt = FELTS[name] ?? FELTS[DEFAULT_FELT];
  const root = document.documentElement;
  root.style.setProperty("--felt-hi", felt.hi);
  root.style.setProperty("--felt-lo", felt.lo);
  root.style.setProperty("--felt-rail", felt.rail);
  root.style.setProperty("--btn-bet", felt.bet);
  root.style.setProperty("--btn-hit", felt.hit);
  root.style.setProperty("--btn-stand", felt.stand);
}

// React hook: current felt + a setter that persists and re-applies. Use in the
// topbar felt switcher; the initial value is applied on mount.
export function useFelt(): [FeltName, (name: FeltName) => void] {
  const [felt, setFeltState] = useState<FeltName>(loadFelt);

  useEffect(() => {
    applyFelt(felt);
  }, [felt]);

  // The config fetch can land after this mounts. Without this the CSS would
  // take the house felt while the switcher went on showing the shipped one as
  // selected. Guarded on there being no saved choice, so a player who has
  // picked one is never moved off it.
  useEffect(() => {
    const onHouse = () => {
      if (!stored(STORAGE_KEY)) setFeltState(loadFelt());
    };
    window.addEventListener(HOUSE_THEME_EVENT, onHouse);
    return () => window.removeEventListener(HOUSE_THEME_EVENT, onHouse);
  }, []);

  const setFelt = useCallback((name: FeltName) => {
    setFeltState(name);
    saveFelt(name);
  }, []);

  return [felt, setFelt];
}

// Chip theme system -- same shape and same per-user/unsynced/localStorage
// pattern as felt above (TASKS.md's "theming beyond felt colour + watermark"
// backlog item), deliberately scoped narrow: this recolors ONLY .k-chip-btn,
// the floating pill-button chrome (Reshuffle, Leave, Skip, React, felt/chip
// swatches themselves, etc.), not the felt's separate gold accent language
// (card highlights, active-turn glow, Eleveroon star, natural-21 flash, the
// brand wordmark) -- that gold is a fixed identity mark, not a themeable
// preference, and unpicking it everywhere it's hardcoded across index.css
// would be a much bigger, riskier refactor than this pass is meant to be.
export type ChipName = "gold" | "ruby" | "sapphire" | "silver";

export interface Chip {
  border: string;    // .k-chip-btn's border (kept at the same alpha as the original fixed gold)
  ink: string;        // resting text color
  inkHover: string;   // text color on hover (brighter, same hue)
  swatch: string;      // solid color for the picker's own preview circle
  label: string;
}

// "gold" reproduces .k-chip-btn's ORIGINAL fixed values exactly (border
// rgba(230,164,75,.35), ink #e6d3ab) -- so a player who never touches this
// switcher sees the identical chrome they always have; this is purely an
// added choice, not a default-behavior change.
export const CHIPS: Record<ChipName, Chip> = {
  gold: { border: "rgba(230, 164, 75, 0.35)", ink: "#e6d3ab", inkHover: "#f3e6c8", swatch: "#e6a44b", label: "Gold" },
  ruby: { border: "rgba(212, 92, 92, 0.4)", ink: "#e0b8b4", inkHover: "#f2d2ce", swatch: "#b5453f", label: "Ruby" },
  sapphire: { border: "rgba(92, 138, 212, 0.4)", ink: "#b9c8e0", inkHover: "#d3e0f2", swatch: "#2f5fa8", label: "Sapphire" },
  silver: { border: "rgba(180, 190, 200, 0.4)", ink: "#d2d8dd", inkHover: "#e8ecf0", swatch: "#9aa5ad", label: "Silver" },
};

export const DEFAULT_CHIP: ChipName = "gold";

const CHIP_STORAGE_KEY = "kvitlach.chip";

export function loadChip(): ChipName {
  const saved = stored(CHIP_STORAGE_KEY);
  if (saved && saved in CHIPS) return saved as ChipName;
  return familyChip ?? houseChip ?? DEFAULT_CHIP;
}

export function saveChip(name: ChipName): void {
  try {
    window.localStorage.setItem(CHIP_STORAGE_KEY, name);
  } catch {
    /* ignore persistence failures */
  }
}

export function applyChip(name: ChipName): void {
  const chip = CHIPS[name] ?? CHIPS[DEFAULT_CHIP];
  const root = document.documentElement;
  root.style.setProperty("--chip-border", chip.border);
  root.style.setProperty("--chip-ink", chip.ink);
  root.style.setProperty("--chip-ink-hover", chip.inkHover);
}

export function useChip(): [ChipName, (name: ChipName) => void] {
  const [chip, setChipState] = useState<ChipName>(loadChip);

  useEffect(() => {
    applyChip(chip);
  }, [chip]);

  // Same catch-up as useFelt, for the same reason.
  useEffect(() => {
    const onHouse = () => {
      if (!stored(CHIP_STORAGE_KEY)) setChipState(loadChip());
    };
    window.addEventListener(HOUSE_THEME_EVENT, onHouse);
    return () => window.removeEventListener(HOUSE_THEME_EVENT, onHouse);
  }, []);

  const setChip = useCallback((name: ChipName) => {
    setChipState(name);
    saveChip(name);
  }, []);

  return [chip, setChip];
}
