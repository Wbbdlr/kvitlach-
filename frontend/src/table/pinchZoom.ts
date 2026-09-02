import { RefObject, useCallback, useEffect, useRef, useState } from "react";

// Two-finger zoom and drag on the felt.
//
// Reported as "the two finger zooming around the table doesn't work". It did
// not, and the browser's own pinch was never going to stand in for it: the
// table view is a fixed 100dvh box with `overflow: hidden` and
// `overscroll-behavior: none` (see .k-fit), which is exactly the shape that
// leaves a page zoomable but unpannable -- and in fullscreen or as an
// installed PWA, the two ways this game is meant to be played, the browser
// disables page pinch outright. So the gesture has to be the app's own.
//
// It composes WITH --stage-scale rather than replacing it. stage.ts computes
// the one scale at which the whole table fits the viewport; that stays the
// resting state and the floor. This multiplies it, so zoom 1 is always "the
// table as designed" and no combination of viewport and gesture can leave a
// player looking at a felt smaller than the layout intends.
//
// Values are written to CSS custom properties on the element rather than held
// in React state. A pinch fires touchmove at screen rate, and re-rendering
// TableRoot -- twelve seats, their hands, the HUD -- on every frame of a drag
// is the difference between a gesture that tracks your fingers and one that
// stutters. Only `zoomed` is state, and it changes at most twice per gesture.

const MIN_ZOOM = 1;
// Past ~3x the 1280-wide stage is being upscaled far enough that the card art
// starts to soften, and the slice of felt visible at once is too small to
// still be reading a table from.
const MAX_ZOOM = 3;
// A one-finger drag pans only once the table is actually zoomed in, and only
// past this many px -- below it, every tap on a card would start a pan and
// fight the tap it was meant to be.
const PAN_SLOP_PX = 8;

interface Gesture {
  startDistance: number;
  startZoom: number;
  startMidX: number;
  startMidY: number;
  startPanX: number;
  startPanY: number;
}

function spread(a: Touch, b: Touch): number {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

export interface PinchZoom {
  /** True while the felt is zoomed past its resting size. */
  zoomed: boolean;
  /** Back to the layout's own scale, centred. */
  reset: () => void;
}

/**
 * @param wrapRef     the fixed viewport box (.k-fit) the gesture is read from
 * @param feltRef     the scaled stage (.felt-table) the gesture is written to
 * @param stageScale  stage.ts's fit-to-viewport scale, which this multiplies
 */
export function usePinchZoom(
  wrapRef: RefObject<HTMLElement>,
  feltRef: RefObject<HTMLElement>,
  stageScale: number
): PinchZoom {
  const [zoomed, setZoomed] = useState(false);
  const zoom = useRef(1);
  const pan = useRef({ x: 0, y: 0 });
  const gesture = useRef<Gesture | undefined>();
  const drag = useRef<{ x: number; y: number; panX: number; panY: number; live: boolean } | undefined>();

  // Keeps the felt covering the viewport: pan is bounded by however much of
  // the scaled felt is genuinely off-screen, so no gesture can drag the table
  // away and leave a player looking at the surround.
  const clampPan = useCallback(() => {
    const wrap = wrapRef.current;
    const felt = feltRef.current;
    if (!wrap || !felt) return;
    const slackX = Math.max(0, (felt.offsetWidth * stageScale * zoom.current - wrap.clientWidth) / 2);
    const slackY = Math.max(0, (felt.offsetHeight * stageScale * zoom.current - wrap.clientHeight) / 2);
    pan.current.x = Math.min(slackX, Math.max(-slackX, pan.current.x));
    pan.current.y = Math.min(slackY, Math.max(-slackY, pan.current.y));
  }, [wrapRef, feltRef, stageScale]);

  const paint = useCallback(() => {
    const felt = feltRef.current;
    if (!felt) return;
    felt.style.setProperty("--user-zoom", String(zoom.current));
    felt.style.setProperty("--pan-x", `${pan.current.x}px`);
    felt.style.setProperty("--pan-y", `${pan.current.y}px`);
  }, [feltRef]);

  const reset = useCallback(() => {
    zoom.current = 1;
    pan.current = { x: 0, y: 0 };
    paint();
    setZoomed(false);
  }, [paint]);

  // A viewport change (rotation, the address bar collapsing, a resize) already
  // recomputes stageScale, and a pan measured against the old one is stale.
  // Re-clamping is cheaper and far less surprising than dropping the zoom.
  useEffect(() => {
    clampPan();
    paint();
  }, [stageScale, clampPan, paint]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return undefined;

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length === 2) {
        const a = event.touches[0];
        const b = event.touches[1];
        gesture.current = {
          startDistance: spread(a, b) || 1,
          startZoom: zoom.current,
          startMidX: (a.clientX + b.clientX) / 2,
          startMidY: (a.clientY + b.clientY) / 2,
          startPanX: pan.current.x,
          startPanY: pan.current.y,
        };
        drag.current = undefined;
      } else if (event.touches.length === 1 && zoom.current > 1) {
        // Recorded, but not yet a pan -- see PAN_SLOP_PX. `live` flips only
        // once the finger has actually travelled, so a tap stays a tap.
        const t = event.touches[0];
        drag.current = { x: t.clientX, y: t.clientY, panX: pan.current.x, panY: pan.current.y, live: false };
      }
    };

    const onTouchMove = (event: TouchEvent) => {
      const g = gesture.current;
      if (g && event.touches.length === 2) {
        const a = event.touches[0];
        const b = event.touches[1];
        const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, (g.startZoom * spread(a, b)) / g.startDistance));
        // The midpoint is tracked as well as the spread: moving around a table
        // you have zoomed into is part of the same gesture, and making people
        // let go and drag separately is how a zoom becomes a thing you try
        // once and switch off.
        const midX = (a.clientX + b.clientX) / 2;
        const midY = (a.clientY + b.clientY) / 2;
        zoom.current = next;
        pan.current.x = g.startPanX + (midX - g.startMidX);
        pan.current.y = g.startPanY + (midY - g.startMidY);
        clampPan();
        paint();
        setZoomed(next > 1.01);
        // Only once this is certainly our gesture. Everything before this
        // point leaves the browser free to do what it would have done.
        if (event.cancelable) event.preventDefault();
        return;
      }
      const d = drag.current;
      if (d && event.touches.length === 1 && zoom.current > 1) {
        const t = event.touches[0];
        const dx = t.clientX - d.x;
        const dy = t.clientY - d.y;
        if (!d.live && Math.hypot(dx, dy) < PAN_SLOP_PX) return;
        d.live = true;
        pan.current.x = d.panX + dx;
        pan.current.y = d.panY + dy;
        clampPan();
        paint();
        if (event.cancelable) event.preventDefault();
      }
    };

    const onTouchEnd = (event: TouchEvent) => {
      if (event.touches.length < 2) gesture.current = undefined;
      if (event.touches.length === 0) drag.current = undefined;
    };

    // passive: false on touchmove because a live pinch has to be able to stop
    // the browser acting on the same fingers; the rest stay passive.
    wrap.addEventListener("touchstart", onTouchStart, { passive: true });
    wrap.addEventListener("touchmove", onTouchMove, { passive: false });
    wrap.addEventListener("touchend", onTouchEnd, { passive: true });
    wrap.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      wrap.removeEventListener("touchstart", onTouchStart);
      wrap.removeEventListener("touchmove", onTouchMove);
      wrap.removeEventListener("touchend", onTouchEnd);
      wrap.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [wrapRef, clampPan, paint]);

  return { zoomed, reset };
}
