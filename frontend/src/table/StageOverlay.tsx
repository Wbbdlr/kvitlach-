import { ReactNode } from "react";
import { createPortal } from "react-dom";

// Renders children into document.body, escaping the table stage.
//
// The stage is CSS `transform: scale()`-d to fit the viewport, and a
// transformed ancestor becomes the containing block for `position: fixed`
// descendants. Anything modal rendered inside the stage therefore (a) gets
// shrunk by the stage scale -- on a landscape phone the manage drawer came
// out 197x170 physical px with ~8px text -- and (b) has its backdrop
// clipped to the stage box, leaving the letterbox bars undimmed and still
// clickable. Portalling to the body sidesteps both: modals stay at true
// viewport scale and genuinely cover the screen.
export function StageOverlay({ children }: { children: ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}
