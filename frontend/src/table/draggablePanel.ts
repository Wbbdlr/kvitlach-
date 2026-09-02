import { CSSProperties, PointerEvent as ReactPointerEvent, RefObject, useCallback, useEffect, useRef, useState } from "react";

// Let a HUD panel be dragged somewhere else and stay there.
//
// Asked for directly: "the box that has your money and total and status should
// just be floating and resizable so players can drag and leave it wherever they
// are most comfortable". Which is the right instinct -- there is no one correct
// corner for it. A left-handed player holding a phone in landscape covers the
// bottom-left with their thumb; a banker watching the felt wants it small and
// out of the way; someone squinting at a crowded table wants it big.
//
// Expressed as a TRANSFORM on the panel, not as position/top/left. The panel
// stays exactly where the layout puts it (.k-hud-bottom-left, flow-laid above
// the tray -- see docs/mobile-ui.md Part 2 rule 2), and this is an offset FROM
// that. Two things fall out of that choice: an untouched panel is byte-for-byte
// the layout it was before, and a player who drags it into a corner that later
// stops existing (rotate the phone, resize the window) is pulled back to
// something on-screen rather than stranded off it.

const STORE_PREFIX = "kvitlach.panel.";
const MIN_SCALE = 0.75;
const MAX_SCALE = 1.8;
// A pointer has to travel this far before it is a drag rather than a press.
// The panel carries no controls today, but it is the kind of thing that grows
// one, and a panel that jumps on contact feels broken either way.
const DRAG_SLOP_PX = 6;

interface Placement {
  dx: number;
  dy: number;
  scale: number;
}

const DEFAULT: Placement = { dx: 0, dy: 0, scale: 1 };

function load(key: string): Placement {
  if (typeof window === "undefined" || !window.localStorage) return DEFAULT;
  try {
    const raw = window.localStorage.getItem(STORE_PREFIX + key);
    if (!raw) return DEFAULT;
    const parsed = JSON.parse(raw) as Partial<Placement>;
    return {
      dx: Number.isFinite(parsed.dx) ? (parsed.dx as number) : 0,
      dy: Number.isFinite(parsed.dy) ? (parsed.dy as number) : 0,
      // Clamped on the way IN as well as on the way out: this is player-
      // editable storage, and a hand-set 40 would render a readout wider than
      // the screen with no way to reach the grip that would fix it.
      scale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number(parsed.scale) || 1)),
    };
  } catch {
    return DEFAULT;
  }
}

function save(key: string, placement: Placement): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(STORE_PREFIX + key, JSON.stringify(placement));
  } catch {
    /* private mode -- the panel simply forgets between visits */
  }
}

export interface DraggablePanel {
  /** Spread onto the panel: the transform, and the drag pointer handler. */
  panelProps: { style: CSSProperties; onPointerDown: (event: ReactPointerEvent) => void };
  /** Spread onto the resize grip. */
  gripProps: { onPointerDown: (event: ReactPointerEvent) => void };
  /** True once the player has moved or resized it -- gates the "reset" affordance. */
  moved: boolean;
  reset: () => void;
}

/**
 * @param ref      the panel itself, measured to keep it on screen
 * @param key      storage key, scoped per panel
 * @param hostScale  any scale already applied by an ancestor, so a drag of N
 *                   screen px moves the panel N screen px rather than N/scale
 */
export function useDraggablePanel(ref: RefObject<HTMLElement>, key: string, hostScale = 1): DraggablePanel {
  const [placement, setPlacement] = useState<Placement>(() => load(key));
  const live = useRef(placement);
  live.current = placement;

  // Pull a panel back on screen whenever the viewport changes under it. A
  // position saved in landscape is off the bottom of the same phone in
  // portrait, and the panel is the thing a player would be looking for to
  // work out what had happened.
  const clamp = useCallback(
    (next: Placement): Placement => {
      const el = ref.current;
      if (!el || typeof window === "undefined") return next;
      // An UNMOVED panel is never rescued. Where it sits is the layout's
      // business, and the layout is what keeps it on screen -- nothing here
      // has a better answer than .k-hud-bottom-left's own flow position.
      //
      // Not merely an optimisation. The mount pass measures shortly after
      // first paint, and the bottom band is anchored to --stage-h, which
      // TableRoot only sets once it has measured the viewport -- so an early
      // pass can read a rect the panel is about to leave, decide it is out of
      // bounds, and bake in a correction that is wrong the moment layout
      // settles. Measured at 800x360: an untouched readout was translated
      // (236, -225) out of its corner and onto the bank's own total.
      if (next.dx === 0 && next.dy === 0) return next;
      const box = el.getBoundingClientRect();
      // A zero-sized rect means it is not laid out yet; there is nothing to
      // measure against and no correction worth guessing at.
      if (box.width === 0 || box.height === 0) return next;
      // Where the panel sits with the CURRENT offset already applied, so the
      // resting position is recovered by subtracting it.
      const restLeft = box.left - live.current.dx * hostScale;
      const restTop = box.top - live.current.dy * hostScale;
      // Keep at least this much of it reachable, in screen px.
      const keep = 44;
      const minDx = (-restLeft - box.width + keep) / hostScale;
      const maxDx = (window.innerWidth - restLeft - keep) / hostScale;
      const minDy = (-restTop - box.height + keep) / hostScale;
      const maxDy = (window.innerHeight - restTop - keep) / hostScale;
      return {
        scale: next.scale,
        dx: Math.min(maxDx, Math.max(minDx, next.dx)),
        dy: Math.min(maxDy, Math.max(minDy, next.dy)),
      };
    },
    [ref, hostScale]
  );

  const rescue = useCallback(() => {
    setPlacement((current) => {
      const bounded = clamp(current);
      // Persisted, not merely applied. Without this the correction lives only
      // in React state, and the next mount reads the same out-of-bounds value
      // straight back out of storage -- which is the bug this is here to stop,
      // just deferred to the next page load.
      if (bounded.dx !== current.dx || bounded.dy !== current.dy) save(key, bounded);
      return bounded;
    });
  }, [clamp, key]);

  // On mount as well as on resize. A resize listener only helps a player who
  // is watching when it happens; a position saved on a phone in landscape, or
  // on another device entirely, is already out of bounds by the time this
  // renders and there is no event coming to fix it.
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    // After first paint, so the panel has a real rect to be measured against.
    const raf = window.requestAnimationFrame(rescue);
    // A ResizeObserver rather than the window's resize event, and for a
    // specific reason: this hook re-registers its listeners whenever hostScale
    // changes, and hostScale changes ON RESIZE -- so the re-render triggered by
    // the very event being listened for can remove the listener mid-dispatch,
    // before it is called. Measured: shrinking 1280x800 to 640x360 clamped the
    // panel vertically (from the mount pass) and not horizontally (the resize
    // pass never ran). RO callbacks fire after layout, outside the event
    // dispatch, so there is no ordering to lose. stage.ts reaches for the same
    // tool a few lines away.
    const observer =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => rescue()) : undefined;
    observer?.observe(document.documentElement);
    // Kept as the fallback for browsers without RO, and for orientation
    // changes that do not alter the documentElement's box.
    window.addEventListener("resize", rescue);
    window.addEventListener("orientationchange", rescue);
    return () => {
      window.cancelAnimationFrame(raf);
      observer?.disconnect();
      window.removeEventListener("resize", rescue);
      window.removeEventListener("orientationchange", rescue);
    };
  }, [rescue]);

  const commit = useCallback(
    (next: Placement) => {
      const bounded = clamp(next);
      setPlacement(bounded);
      save(key, bounded);
    },
    [clamp, key]
  );

  // One gesture implementation for both, differing only in what the delta
  // means. Pointer events rather than touch: this has to work under a finger
  // and a mouse, and setPointerCapture is what keeps a drag alive when the
  // pointer leaves the panel -- which, when the panel is what you are moving,
  // is immediately.
  const begin = useCallback(
    (event: ReactPointerEvent, mode: "move" | "resize") => {
      if (event.button !== undefined && event.button !== 0) return;
      const startX = event.clientX;
      const startY = event.clientY;
      const from = { ...live.current };
      const target = event.currentTarget as HTMLElement;
      let dragging = false;
      target.setPointerCapture?.(event.pointerId);

      const onMove = (moveEvent: PointerEvent) => {
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        if (!dragging && Math.hypot(dx, dy) < DRAG_SLOP_PX) return;
        dragging = true;
        if (mode === "move") {
          setPlacement(clamp({ ...from, dx: from.dx + dx / hostScale, dy: from.dy + dy / hostScale }));
        } else {
          // Down-right grows it. Both axes count so the gesture works whichever
          // way the grip is dragged, at 200px of travel per full size step.
          const next = from.scale + (dx + dy) / 200;
          setPlacement({ ...live.current, scale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, next)) });
        }
        moveEvent.preventDefault();
      };
      const onUp = () => {
        target.releasePointerCapture?.(event.pointerId);
        target.removeEventListener("pointermove", onMove);
        target.removeEventListener("pointerup", onUp);
        target.removeEventListener("pointercancel", onUp);
        if (dragging) commit(live.current);
      };
      target.addEventListener("pointermove", onMove);
      target.addEventListener("pointerup", onUp);
      target.addEventListener("pointercancel", onUp);
    },
    [clamp, commit, hostScale]
  );

  const reset = useCallback(() => {
    setPlacement(DEFAULT);
    save(key, DEFAULT);
  }, [key]);

  const moved = placement.dx !== 0 || placement.dy !== 0 || placement.scale !== 1;

  return {
    panelProps: {
      style: {
        transform: `translate(${placement.dx}px, ${placement.dy}px) scale(${placement.scale})`,
        // Anchored to the corner the layout already puts it in, so growing it
        // pushes into the empty felt rather than off the bottom of the screen.
        transformOrigin: "bottom left",
        touchAction: "none",
      },
      onPointerDown: (event) => begin(event, "move"),
    },
    gripProps: { onPointerDown: (event) => begin(event, "resize") },
    moved,
    reset,
  };
}
