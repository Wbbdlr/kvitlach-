import { act, fireEvent, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useDraggablePanel } from "../draggablePanel";

const KEY = "kvitlach.panel.testpanel";

// The panel's resting position, as the layout would give it. jsdom lays
// nothing out, so every test that measures has to say what it would have
// measured.
let rect = { left: 100, top: 500, width: 160, height: 60 };

function Panel() {
  const ref = useRef<HTMLDivElement>(null);
  const { panelProps, gripProps, moved } = useDraggablePanel(ref, "testpanel");
  return (
    <div ref={ref} data-testid="panel" data-moved={moved ? "yes" : "no"} {...panelProps}>
      {/* stopPropagation as ViewerHud does -- without it the same press starts
          a move and a resize at once. */}
      <span
        data-testid="grip"
        onPointerDown={(event) => {
          event.stopPropagation();
          gripProps.onPointerDown(event);
        }}
      />
    </div>
  );
}

function drag(el: HTMLElement, dx: number, dy: number) {
  fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
  fireEvent.pointerMove(el, { pointerId: 1, clientX: dx, clientY: dy });
  fireEvent.pointerUp(el, { pointerId: 1 });
}

function stored() {
  const raw = window.localStorage.getItem(KEY);
  return raw ? JSON.parse(raw) : undefined;
}

beforeEach(() => {
  rect = { left: 100, top: 500, width: 160, height: 60 };
  window.localStorage.clear();
  Element.prototype.getBoundingClientRect = function () {
    return { ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height, x: rect.left, y: rect.top, toJSON: () => ({}) } as DOMRect;
  };
  window.innerWidth = 1000;
  window.innerHeight = 800;
});

afterEach(() => {
  window.localStorage.clear();
});

describe("the switch from flow to floating", () => {
  // The panel is laid out in flow by .k-dock-stack > .k-viewer-hud, which
  // anchors it with `bottom: 100%`. Going floating sets position: fixed plus
  // `top` and `left` -- and does NOT remove that `bottom`, because an inline
  // style only overrides the properties it names.
  //
  // A fixed box with `top` AND `bottom` set and height:auto is over-constrained:
  // the used height becomes viewport - top - bottom. So the first drag turned a
  // 160x60 readout into a wide empty strip with its own name and total spilling
  // out below it, and the panel's gradient painted over the wrong box. Reported
  // as dragging "destroying the background", which is what it looks like from
  // the outside, and as the panel being "broken" on both desktop and mobile.
  //
  // jsdom will not compute the over-constrained height for us, so this asserts
  // the cause rather than the symptom: the inline style must neutralise both
  // offsets it does not own.
  it("clears the offsets the flow layout set, not just the ones it sets itself", () => {
    const { getByTestId } = render(<Panel />);
    const panel = getByTestId("panel");
    drag(panel, 40, -30);
    expect(panel.style.position).toBe("fixed");
    expect(panel.style.bottom).toBe("auto");
    expect(panel.style.right).toBe("auto");
  });

  it("leaves a panel in flow alone -- no offsets, no fixed positioning", () => {
    // The other half of the same rule: an untouched panel must inherit the
    // layout's anchoring untouched, so clearing bottom/right unconditionally
    // would break the resting state to fix the dragged one.
    const { getByTestId } = render(<Panel />);
    const panel = getByTestId("panel");
    expect(panel.style.position).toBe("");
    expect(panel.style.bottom).toBe("");
    expect(panel.style.right).toBe("");
  });
});

describe("useDraggablePanel", () => {
  it("adds no positioning at all to a panel nobody has touched", () => {
    const { getByTestId } = render(<Panel />);
    const panel = getByTestId("panel");
    // The layout owns it. Anything else here would be this hook deciding where
    // a panel goes before the player has expressed any opinion.
    expect(panel.style.position).toBe("");
    expect(panel.style.transform).toBe("translate(0px, 0px) scale(1)");
    expect(panel.dataset.moved).toBe("no");
    expect(stored()).toBeUndefined();
  });

  // The bug this rewrite exists for. As a transform offset the panel's real
  // position was layout + delta, and the layout half moved on every deal --
  // the dock is content-width and centred, so its left edge slides. Fixed
  // coordinates have no layout half to move.
  it("leaves the layout entirely on the first drag, and remembers viewport px", () => {
    const { getByTestId } = render(<Panel />);
    const panel = getByTestId("panel");
    drag(panel, 40, -30);
    expect(panel.style.position).toBe("fixed");
    expect(panel.style.left).toBe("140px"); // 100 resting + 40 dragged
    expect(panel.style.top).toBe("470px"); // 500 resting - 30 dragged
    expect(panel.dataset.moved).toBe("yes");
    expect(stored()).toMatchObject({ x: 140, y: 470 });
  });

  it("ignores a press that never travels far enough to be a drag", () => {
    const { getByTestId } = render(<Panel />);
    const panel = getByTestId("panel");
    drag(panel, 3, 2);
    expect(panel.style.position).toBe("");
    expect(stored()).toBeUndefined();
  });

  // A saved position from the transform era cannot be converted without a
  // laid-out box, so it is carried until there is one rather than thrown away
  // -- discarding it would silently move every existing player's panel back.
  it("converts a placement saved by the old transform version, in place", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ dx: 25, dy: -60, scale: 1.2 }));
    // With the legacy transform applied, the rendered rect IS where the player
    // put it, so freezing that rect is exact rather than a guess.
    rect = { left: 125, top: 440, width: 160, height: 60 };
    const { getByTestId } = render(<Panel />);
    act(() => {
      // The conversion runs on the post-paint pass, not during render.
      window.dispatchEvent(new Event("resize"));
    });
    const panel = getByTestId("panel");
    expect(panel.style.position).toBe("fixed");
    expect(panel.style.left).toBe("125px");
    expect(panel.style.top).toBe("440px");
    expect(stored()).toMatchObject({ x: 125, y: 440, scale: 1.2 });
    expect(stored().dx).toBeUndefined();
  });

  it("pulls a panel back on screen when the viewport shrinks under it", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ x: 900, y: 700, scale: 1 }));
    rect = { left: 900, top: 700, width: 160, height: 60 };
    const { getByTestId } = render(<Panel />);
    window.innerWidth = 400;
    window.innerHeight = 300;
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    const panel = getByTestId("panel");
    // 44px of it stays reachable on each axis -- otherwise the panel a player
    // would be looking for to work out what happened is the thing off screen.
    expect(Number.parseFloat(panel.style.left)).toBe(400 - 44);
    expect(Number.parseFloat(panel.style.top)).toBe(300 - 44);
    expect(stored()).toMatchObject({ x: 356, y: 256 });
  });

  it("rejects a hand-edited scale rather than rendering a panel wider than the screen", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ x: 10, y: 10, scale: 40 }));
    const { getByTestId } = render(<Panel />);
    expect(getByTestId("panel").style.transform).toBe("scale(1.8)");
  });

  it("resizes without moving, and keeps the panel in flow while it does", () => {
    const { getByTestId } = render(<Panel />);
    drag(getByTestId("grip"), 60, 60);
    const panel = getByTestId("panel");
    expect(panel.style.position).toBe("");
    expect(panel.style.transform).toBe("translate(0px, 0px) scale(1.6)");
    expect(panel.dataset.moved).toBe("yes");
  });
});
