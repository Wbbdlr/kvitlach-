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

export function useHandFan(handRef: RefObject<HTMLDivElement>, roundId?: string) {
  const [fanned, setFanned] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!fanned) return;
    timeoutRef.current = setTimeout(() => setFanned(false), FAN_OUT_MS);
    return () => clearTimeout(timeoutRef.current);
  }, [fanned]);

  // Seat.tsx/Dealer.tsx are keyed by player id, not round id (see
  // TableRoot.tsx), so this hook's state survives a round change by design --
  // that's what lets the auto-collapse timer above keep running across a
  // round boundary instead of getting reset early. Without this, a hand
  // fanned right as a round ends could still read `fanned: true` once the
  // NEW round's hand regrows to 4+ cards, rendering pre-expanded before the
  // player ever taps it this round. Normally the 4s timeout beats any round
  // transition, but nothing here should depend on winning that race.
  useEffect(() => {
    setFanned(false);
  }, [roundId]);

  // Only listens while actually fanned open -- no point paying for a global
  // mousedown listener on every seat's hand for the entire round.
  useClickOutside([handRef], () => setFanned(false), fanned);

  const toggle = () => setFanned((v) => !v);

  return { fanned, toggle };
}
