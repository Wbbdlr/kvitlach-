import { useEffect, useState } from "react";

// Lets a component react to the same breakpoint a CSS rule uses, so the two
// can't disagree. Added for the rotate-hint overlap: `.k-rotate-hint` is
// shown purely by a media query (index.css), but the two one-time nudges are
// React state, and nothing connected them -- on a portrait phone all three
// rendered into the same strip at the top of the screen at once, on top of
// each other and on top of the controls row.
//
// Keep the query string identical to the CSS rule's. If one moves, the other
// has to move with it.
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange(); // the query may already have changed before this effect ran
    // addListener is the deprecated form, still the only one on older iOS
    // Safari -- which is exactly the platform this hook exists to serve.
    if (mql.addEventListener) {
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    }
    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  }, [query]);

  return matches;
}
