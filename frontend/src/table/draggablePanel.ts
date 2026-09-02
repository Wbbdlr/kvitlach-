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
// TWO positioning modes, and the split is the whole point:
//
//   UNTOUCHED -- no positioning at all. The panel sits exactly where the
//   layout puts it (.k-dock-stack, above the dock), byte-for-byte the layout
//   it was before this hook existed.
//
//   MOVED -- `position: fixed` at viewport coordinates. Once a player has put
//   it somewhere, that somewhere is a place on their screen, and nothing on
//   the felt gets to move it again.
//
// It used to be a TRANSFORM in both modes -- an offset from wherever the
// layout had put the panel. That reads as elegant and is wrong, because the
// layout position is not a constant: the readout anchors to .k-dock-stack's
// left edge and top (index.css), the stack is content-width and centred, and
// the dock's contents change on every deal, every round boundary, and every
// state where there is no dock at all. So the resting position slid sideways
// as the controls changed width and jumped vertically as they wrapped or
// vanished, carrying the player's offset along with it. Reported as "that
// panel is pushed around the screen as cards are dealt and as rounds progress"
// -- a floating panel needs a frame that does not move, and the only one on
// offer is the viewport.
//
// A position saved in landscape is off the bottom of the same phone in
// portrait, so fixed coordinates are clamped back on screen whenever the
// viewport changes under them -- see `clamp`.

const STORE_PREFIX = "kvitlach.panel.";
const MIN_SCALE = 0.75;
const MAX_SCALE = 1.8;
// A pointer has to travel this far before it is a drag rather than a press.
// The panel carries no controls today, but it is the kind of thing that grows
// one, and a panel that jumps on contact feels broken either way.
const DRAG_SLOP_PX = 6;
// Keep at least this much of the panel reachable, in screen px.
const KEEP_PX = 44;

interface Placement {
  /** Viewport px of the panel's top-left, or null while it is still in flow. */
  x: number | null;
  y: number | null;
  scale: number;
}

/**
 * A placement written by the transform-offset version of this hook. It cannot
 * be converted without knowing where the layout was putting the panel, which
 * is only knowable once it has been laid out -- so it is carried separately
 * and cashed in on the first measured pass, rather than discarded. Discarding
 * would silently move every existing player's panel back to the corner.
 */
interface LegacyOffset {
  dx: number;
  dy: number;
}

const DEFAULT: Placement = { x: null, y: null, scale: 1 };

function boundScale(value: unknown): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number(value) || 1));
}

function load(key: string): { placement: Placement; legacy?: LegacyOffset } {
  if (typeof window === "undefined" || !window.localStorage) return { placement: DEFAULT };
  try {
    const raw = window.localStorage.getItem(STORE_PREFIX + key);
    if (!raw) return { placement: DEFAULT };
    const parsed = JSON.parse(raw) as Partial<Placement & LegacyOffset>;
    // Clamped on the way IN as well as on the way out: this is player-editable
    // storage, and a hand-set 40 would render a readout wider than the screen
    // with no way to reach the grip that would fix it.
    const scale = boundScale(parsed.scale);
    if (Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) {
      return { placement: { x: parsed.x as number, y: parsed.y as number, scale } };
    }
    const dx = Number.isFinite(parsed.dx) ? (parsed.dx as number) : 0;
    const dy = Number.isFinite(parsed.dy) ? (parsed.dy as number) : 0;
    if (dx === 0 && dy === 0) return { placement: { ...DEFAULT, scale } };
    return { placement: { x: null, y: null, scale }, legacy: { dx, dy } };
  } catch {
    return { placement: DEFAULT };
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
  /** Spread onto the panel: its positioning, and the drag pointer handler. */
  panelProps: { style: CSSProperties; onPointerDown: (event: ReactPointerEvent) => void };
  /** Spread onto the resize grip. */
  gripProps: { onPointerDown: (event: ReactPointerEvent) => void };
  /** True once the player has moved or resized it -- gates the "reset" affordance. */
  moved: boolean;
  reset: () => void;
}

/**
 * @param ref  the panel itself, measured to keep it on screen and to find its
 *             resting position the first time it is dragged
 * @param key  storage key, scoped per panel
 */
export function useDraggablePanel(ref: RefObject<HTMLElement>, key: string): DraggablePanel {
  const initial = useRef(load(key));
  const [placement, setPlacement] = useState<Placement>(initial.current.placement);
  const legacy = useRef(initial.current.legacy);
  const live = useRef(placement);
  live.current = placement;

  // Pull a floating panel back on screen. Works in viewport px throughout,
  // which is what makes it simple now: the panel's own rendered box is the
  // only thing to measure, and there is no resting position to subtract out.
  const clamp = useCallback(
    (next: Placement): Placement => {
      if (next.x === null || next.y === null) return next;
      const el = ref.current;
      if (!el || typeof window === "undefined") return next;
      const box = el.getBoundingClientRect();
      // A zero-sized rect means it is not laid out yet; there is nothing to
      // measure against and no correction worth guessing at.
      if (box.width === 0 || box.height === 0) return next;
      return {
        scale: next.scale,
        x: Math.min(window.innerWidth - KEEP_PX, Math.max(KEEP_PX - box.width, next.x)),
        y: Math.min(window.innerHeight - KEEP_PX, Math.max(KEEP_PX - box.height, next.y)),
      };
    },
    [ref]
  );

  const rescue = useCallback(() => {
    setPlacement((current) => {
      // Cash in a saved transform offset now that there is a real box to read:
      // with the legacy transform still applied, the panel's rect IS the
      // position the player chose, so freezing it is exact rather than a guess.
      if (current.x === null && legacy.current) {
        const box = ref.current?.getBoundingClientRect();
        if (!box || box.width === 0) return current;
        legacy.current = undefined;
        const frozen = clamp({ scale: current.scale, x: box.left, y: box.top });
        save(key, frozen);
        return frozen;
      }
      const bounded = clamp(current);
      // Persisted, not merely applied. Without this the correction lives only
      // in React state, and the next mount reads the same out-of-bounds value
      // straight back out of storage -- which is the bug this is here to stop,
      // just deferred to the next page load.
      if (bounded.x !== current.x || bounded.y !== current.y) save(key, bounded);
      return bounded;
    });
  }, [clamp, key, ref]);

  // On mount as well as on resize. A resize listener only helps a player who
  // is watching when it happens; a position saved on a phone in landscape, or
  // on another device entirely, is already out of bounds by the time this
  // renders and there is no event coming to fix it.
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    // After first paint, so the panel has a real rect to be measured against.
    const raf = window.requestAnimationFrame(rescue);
    // A ResizeObserver rather than the window's resize event. RO callbacks
    // fire after layout and outside the event dispatch, so a re-render cannot
    // remove the listener mid-dispatch. stage.ts reaches for the same tool a
    // few lines away.
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
      let from = { ...live.current };
      // The handoff from flow to floating: read where the layout has the panel
      // right now and start from there, so the first drag does not jump.
      if (mode === "move" && from.x === null) {
        const box = ref.current?.getBoundingClientRect();
        if (!box || box.width === 0) return;
        legacy.current = undefined;
        from = { ...from, x: box.left, y: box.top };
      }
      const target = event.currentTarget as HTMLElement;
      let dragging = false;
      target.setPointerCapture?.(event.pointerId);

      const onMove = (moveEvent: PointerEvent) => {
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        if (!dragging && Math.hypot(dx, dy) < DRAG_SLOP_PX) return;
        dragging = true;
        if (mode === "move") {
          // Viewport px on both sides now, so a drag of N screen px moves the
          // panel N screen px with nothing to divide out.
          setPlacement(clamp({ ...from, x: (from.x as number) + dx, y: (from.y as number) + dy }));
        } else {
          // Down-right grows it. Both axes count so the gesture works whichever
          // way the grip is dragged, at 200px of travel per full size step.
          const next = from.scale + (dx + dy) / 200;
          setPlacement({ ...live.current, scale: boundScale(next) });
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
    [clamp, commit, ref]
  );

  const reset = useCallback(() => {
    legacy.current = undefined;
    setPlacement(DEFAULT);
    save(key, DEFAULT);
  }, [key]);

  const floating = placement.x !== null;
  const moved = floating || Boolean(legacy.current) || placement.scale !== 1;

  // Fixed and flow modes need different scale origins. Floating, the panel is
  // pinned by its top-left, so growing it must not drag that corner; in flow
  // it is anchored to the corner the layout puts it in, so growing it pushes
  // into the empty felt rather than off the bottom of the screen.
  const style: CSSProperties = floating
    ? {
        position: "fixed",
        left: placement.x as number,
        top: placement.y as number,
        margin: 0,
        transform: `scale(${placement.scale})`,
        transformOrigin: "top left",
        touchAction: "none",
      }
    : {
        transform: `translate(${legacy.current?.dx ?? 0}px, ${legacy.current?.dy ?? 0}px) scale(${placement.scale})`,
        transformOrigin: "bottom left",
        touchAction: "none",
      };

  return {
    panelProps: { style, onPointerDown: (event) => begin(event, "move") },
    gripProps: { onPointerDown: (event) => begin(event, "resize") },
    moved,
    reset,
  };
}
