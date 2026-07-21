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
