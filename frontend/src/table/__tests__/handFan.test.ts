import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { RefObject } from "react";
import { FAN_OUT_MS, useHandFan } from "../handFan";

// useClickOutside (the shared hook this wraps) only ever reads ref.current,
// so a plain object stands in for a real React ref without fighting
// createRef's readonly typing.
function fakeRef(el: HTMLElement): RefObject<HTMLDivElement> {
  return { current: el as HTMLDivElement };
}

describe("useHandFan", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup() {
    const el = document.createElement("div");
    document.body.appendChild(el);
    return { ref: fakeRef(el), el };
  }

  it("starts collapsed", () => {
    const { ref } = setup();
    const { result } = renderHook(() => useHandFan(ref));
    expect(result.current.fanned).toBe(false);
  });

  it("toggle opens it, and toggling again closes it immediately", () => {
    const { ref } = setup();
    const { result } = renderHook(() => useHandFan(ref));
    act(() => result.current.toggle());
    expect(result.current.fanned).toBe(true);
    act(() => result.current.toggle());
    expect(result.current.fanned).toBe(false);
  });

  it("auto-collapses on its own after FAN_OUT_MS, without another tap", () => {
    const { ref } = setup();
    const { result } = renderHook(() => useHandFan(ref));
    act(() => result.current.toggle());
    expect(result.current.fanned).toBe(true);
    act(() => vi.advanceTimersByTime(FAN_OUT_MS - 1));
    expect(result.current.fanned).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.fanned).toBe(false);
  });

  it("collapses early on a tap outside the hand", () => {
    const { ref } = setup();
    const { result } = renderHook(() => useHandFan(ref));
    act(() => result.current.toggle());
    expect(result.current.fanned).toBe(true);
    act(() => {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      vi.advanceTimersByTime(FAN_OUT_MS - 1); // well before the auto-collapse
    });
    expect(result.current.fanned).toBe(false);
  });

  it("does not collapse on a tap inside the hand itself", () => {
    const { ref, el } = setup();
    const { result } = renderHook(() => useHandFan(ref));
    act(() => result.current.toggle());
    act(() => {
      el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(result.current.fanned).toBe(true);
  });

  it("resets to collapsed when roundId changes", () => {
    // Regression: Seat.tsx/Dealer.tsx are keyed by player id, not round id
    // (see TableRoot.tsx), so this hook's state otherwise survives a round
    // change -- a hand fanned right as a round ends could still read
    // fanned:true once the NEXT round's hand regrows to 4+ cards, rendering
    // pre-expanded before the player ever taps it that round.
    const { ref } = setup();
    const { result, rerender } = renderHook(({ roundId }) => useHandFan(ref, roundId), {
      initialProps: { roundId: "round-1" },
    });
    act(() => result.current.toggle());
    expect(result.current.fanned).toBe(true);

    rerender({ roundId: "round-2" });

    expect(result.current.fanned).toBe(false);
  });

  it("does not reset on a re-render that keeps the same roundId", () => {
    const { ref } = setup();
    const { result, rerender } = renderHook(({ roundId }) => useHandFan(ref, roundId), {
      initialProps: { roundId: "round-1" },
    });
    act(() => result.current.toggle());
    expect(result.current.fanned).toBe(true);

    rerender({ roundId: "round-1" });

    expect(result.current.fanned).toBe(true);
  });

  it("never arms the outside-click listener (or the timer) while collapsed", () => {
    // Regression guard for "no point paying for a global mousedown listener
    // on every seat's hand for the entire round" -- a stray outside click
    // must not somehow flip an already-collapsed hand.
    const { ref } = setup();
    const { result } = renderHook(() => useHandFan(ref));
    act(() => {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      vi.advanceTimersByTime(FAN_OUT_MS);
    });
    expect(result.current.fanned).toBe(false);
  });
});
