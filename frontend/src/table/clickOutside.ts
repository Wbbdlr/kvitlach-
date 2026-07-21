// Declarative click-outside-closes hook for popovers (seat menu, bank top-up,
// watermark editor, reaction picker, felt switcher) — one shared listener
// per open popover instead of each component hand-rolling its own.

import { RefObject, useEffect } from "react";

export function useClickOutside(refs: Array<RefObject<HTMLElement>>, onClose: () => void, active = true): void {
  useEffect(() => {
    if (!active) return;
    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node;
      const isInside = refs.some((ref) => ref.current?.contains(target));
      if (!isInside) onClose();
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, onClose]);
}
