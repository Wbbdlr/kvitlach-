// Shared "tap to fan out an overlapping hand" behavior for Seat.tsx and
// Dealer.tsx -- both render a .k-hand that starts overlapping once it holds
// 4+ cards (see index.css), and both need the identical open/close rules:
// tap the hand to toggle it open, auto-close after a few seconds so it
// doesn't have to be dismissed by hand, or close early by tapping anywhere
// else (the existing useClickOutside, reused rather than hand-rolled here).

import { RefObject, useEffect, useRef, useState } from "react";
import { useClickOutside } from "./clickOutside";

// Long enough to actually read a fanned-out hand, short enough that it
// doesn't linger once you've looked away without tapping to confirm.
export const FAN_OUT_MS = 4000;

export function useHandFan(handRef: RefObject<HTMLDivElement>) {
  const [fanned, setFanned] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!fanned) return;
    timeoutRef.current = setTimeout(() => setFanned(false), FAN_OUT_MS);
    return () => clearTimeout(timeoutRef.current);
  }, [fanned]);

  // Only listens while actually fanned open -- no point paying for a global
  // mousedown listener on every seat's hand for the entire round.
  useClickOutside([handRef], () => setFanned(false), fanned);

  const toggle = () => setFanned((v) => !v);

  return { fanned, toggle };
}
