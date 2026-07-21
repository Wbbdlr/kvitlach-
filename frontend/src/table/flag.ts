// Feature flag for the "around the table" redesign. Opt-in, per-user, default
// off — persisted to localStorage like the felt preference in theme.ts, with a
// one-time ?table=1 / ?table=0 URL override on mount for shareable QA links.

import { useEffect, useState } from "react";

const STORAGE_KEY = "kvitlach.tableUI";

function loadTableUIFlag(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    /* localStorage unavailable (private mode, etc.) — fall back to default off */
    return false;
  }
}

function saveTableUIFlag(enabled: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    /* ignore persistence failures */
  }
}

export function useTableUIFlag(): [boolean, (enabled: boolean) => void] {
  const [enabled, setEnabledState] = useState<boolean>(loadTableUIFlag);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get("table");
    if (fromQuery === "1") {
      setEnabledState(true);
      saveTableUIFlag(true);
    } else if (fromQuery === "0") {
      setEnabledState(false);
      saveTableUIFlag(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setEnabled = (next: boolean) => {
    setEnabledState(next);
    saveTableUIFlag(next);
  };

  return [enabled, setEnabled];
}
