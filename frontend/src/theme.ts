// Felt theme system for the table UI overhaul.
// Felt is a per-user preference (like the sound/music toggles), persisted to
// localStorage so each player's table color sticks across reloads. It only
// affects the local client's view — never other players'.

import { useCallback, useEffect, useState } from "react";

export type FeltName = "green" | "burgundy" | "navy";

export interface Felt {
  hi: string;   // lighter center of the felt gradient
  lo: string;   // darker edge of the felt gradient
  rail: string; // wooden rail border
  label: string;
  bet: string;   // bet/blatt button accent, coordinated with this felt
  hit: string;   // hit button accent
  stand: string; // stand button accent
}

// Bet stays amber/gold-ish across felts (the app's one universal accent);
// hit and stand vary per felt so neither blends into that felt's own hue.
export const FELTS: Record<FeltName, Felt> = {
  green: { hi: "#24503a", lo: "#12271c", rail: "#4a3320", label: "Green", bet: "#d97706", hit: "#2f7dc9", stand: "#a8532e" },
  burgundy: { hi: "#5a2733", lo: "#280f16", rail: "#4a3320", label: "Burgundy", bet: "#d9a441", hit: "#2f9e6f", stand: "#6b4423" },
  navy: { hi: "#24405e", lo: "#0d1a2b", rail: "#3a3320", label: "Navy", bet: "#d9a441", hit: "#c2622a", stand: "#5a3d7a" },
};

export const DEFAULT_FELT: FeltName = "green";

const STORAGE_KEY = "kvitlach.felt";

export function loadFelt(): FeltName {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved && saved in FELTS) return saved as FeltName;
  } catch {
    /* localStorage unavailable (private mode, etc.) — fall back to default */
  }
  return DEFAULT_FELT;
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
  try {
    const saved = window.localStorage.getItem(CHIP_STORAGE_KEY);
    if (saved && saved in CHIPS) return saved as ChipName;
  } catch {
    /* localStorage unavailable (private mode, etc.) -- fall back to default */
  }
  return DEFAULT_CHIP;
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

  const setChip = useCallback((name: ChipName) => {
    setChipState(name);
    saveChip(name);
  }, []);

  return [chip, setChip];
}
