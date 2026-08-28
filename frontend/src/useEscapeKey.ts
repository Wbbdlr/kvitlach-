import { useEffect } from "react";

// Every dialog here already carries role="dialog", aria-modal and a label --
// that work was done -- and every one of them can be dismissed by clicking the
// overlay. None of them closed on Escape, which is the one keyboard behaviour
// people expect from a dialog without being told, and the only way out for
// someone not using a mouse.
//
// `enabled` exists because several of these components early-return null when
// closed. Hooks can't live after that return, so they call this above it and
// pass `open` -- attaching a listener that fires onClose while the dialog is
// hidden would be its own small bug.
export function useEscapeKey(onClose: () => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    // Listening on document, not the dialog: focus may still be on the button
    // that opened it, since none of these move focus into the dialog on open.
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, enabled]);
}
