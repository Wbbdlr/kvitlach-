import { useEffect, useRef } from "react";

// Companion to useEscapeKey. That hook gave these dialogs a keyboard way OUT;
// this one gives them a keyboard way IN, and stops Tab wandering off behind
// them. Every dialog here already carries role="dialog" + aria-modal="true",
// which tells a screen reader the rest of the page is inert -- but nothing
// actually made it inert, so Tab walked straight out into the felt underneath
// while the dialog stayed open on top. Focus also never moved into the dialog
// at all: it sat on whatever button opened it, so a screen-reader user got no
// announcement and a keyboard user's first Tab landed in the page, not the
// thing that just appeared.
//
// Returns a ref to put on the dialog container. `enabled` mirrors
// useEscapeKey's: several of these components early-return null when closed,
// so hooks have to be called above that return and told whether they're live.
const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

// Deliberately no visibility filter. These dialogs show or hide controls by
// mounting/unmounting them, not with display:none, so a hidden control is not
// in the DOM to be found in the first place -- and the obvious filter
// (offsetParent !== null) is always false under jsdom, which has no layout, so
// it would have disabled the trap entirely in every component test.
function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
}

export function useDialogFocus<T extends HTMLElement>(enabled = true) {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!enabled) return;
    const dialog = ref.current;
    if (!dialog) return;

    // Captured before we move focus, restored on close. Without this, closing
    // a dialog dropped focus back to <body> and a keyboard user restarted
    // their Tab journey from the top of the page every time.
    const opener = document.activeElement as HTMLElement | null;

    const initial = focusableWithin(dialog)[0];
    if (initial) {
      initial.focus();
    } else {
      // Nothing focusable inside (a purely informational dialog) -- make the
      // container itself the focus target so the dialog is still announced
      // and Escape still has somewhere sensible to fire from.
      if (!dialog.hasAttribute("tabindex")) dialog.setAttribute("tabindex", "-1");
      dialog.focus();
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = focusableWithin(dialog);
      if (items.length === 0) {
        // Nothing to cycle between, but Tab must still not escape.
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      // Wrap at both ends, and pull focus back in if it has somehow already
      // left the dialog (a click on the overlay, say).
      if (!dialog.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      // Restore only when focus is still ours to give back. Two cases count:
      // focus is literally inside the dialog, or it has already fallen to
      // <body>/nothing -- which is what actually happens on unmount, since
      // the focused node is gone by the time this cleanup runs. If something
      // else has deliberately taken focus since (a follow-up dialog, a toast
      // action), yanking it to the old opener would be the more surprising
      // behaviour, so leave it alone.
      const active = document.activeElement;
      const focusIsOurs = !active || active === document.body || dialog.contains(active);
      if (opener && focusIsOurs) opener.focus();
    };
  }, [enabled]);

  return ref;
}
