import { describe, expect, it, vi } from "vitest";
import { DEFAULT_LIMITS, RuntimeLimits, limitsFromEnv, normalizeLimit } from "../limits.js";
import { GameStore } from "../store.js";

describe("normalizeLimit", () => {
  it("clamps rather than refusing, so a fat-fingered form still lands somewhere sane", () => {
    expect(normalizeLimit("maxRooms", 5000)).toBe(1000);
    expect(normalizeLimit("maxRooms", 0)).toBe(1);
    expect(normalizeLimit("maxPlayersPerRoom", 1)).toBe(2);
  });

  it("takes the numeric strings that HTML forms actually post", () => {
    expect(normalizeLimit("maxRooms", " 42 ")).toBe(42);
  });

  // A cap of NaN compares false against everything, which does not throw --
  // it silently removes the limit. That is the failure this guard exists for.
  it("refuses anything that is not a whole number", () => {
    for (const bad of ["", "abc", "12.5", 12.5, NaN, Infinity, null, undefined, {}]) {
      expect(normalizeLimit("maxRooms", bad)).toBeUndefined();
    }
  });
});

describe("RuntimeLimits", () => {
  it("starts at the documented defaults", () => {
    const limits = new RuntimeLimits();
    expect(limits.maxRooms).toBe(DEFAULT_LIMITS.maxRooms);
    expect(limits.maxPracticeRooms).toBe(DEFAULT_LIMITS.maxPracticeRooms);
    expect(limits.maxPlayersPerRoom).toBe(DEFAULT_LIMITS.maxPlayersPerRoom);
  });

  it("reports a change to its persistence callback", () => {
    const onChange = vi.fn();
    const limits = new RuntimeLimits(onChange);
    expect(limits.set("maxRooms", 40)).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].maxRooms).toBe(40);
  });

  it("does not persist, or change anything, on a rejected value", () => {
    const onChange = vi.fn();
    const limits = new RuntimeLimits(onChange);
    expect(limits.set("maxRooms", "nonsense")).toBe(false);
    expect(limits.maxRooms).toBe(DEFAULT_LIMITS.maxRooms);
    expect(onChange).not.toHaveBeenCalled();
  });

  // hydrate() reads JSON out of a database. A row that was hand-edited, or
  // half-written, must not be able to disable a cap.
  it("sanitises what it loads from storage", () => {
    const limits = new RuntimeLimits();
    limits.hydrate({ maxRooms: NaN, maxPracticeRooms: 9_000_000, maxPlayersPerRoom: 12 } as never);
    expect(limits.maxRooms).toBe(DEFAULT_LIMITS.maxRooms);
    expect(limits.maxPracticeRooms).toBe(500);
    expect(limits.maxPlayersPerRoom).toBe(12);
  });

  it("does not fire onChange while hydrating", () => {
    const onChange = vi.fn();
    new RuntimeLimits(onChange).hydrate({ maxRooms: 10 } as never);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("resets back to defaults", () => {
    const limits = new RuntimeLimits();
    limits.set("maxRooms", 3);
    limits.resetToDefaults();
    expect(limits.maxRooms).toBe(DEFAULT_LIMITS.maxRooms);
    expect(limits.isDefault("maxRooms")).toBe(true);
  });
});

describe("limitsFromEnv", () => {
  it("ignores what is not set and clamps what is", () => {
    expect(limitsFromEnv({} as NodeJS.ProcessEnv)).toEqual({});
    expect(limitsFromEnv({ MAX_ROOMS: "12", MAX_PLAYERS_PER_ROOM: "9999" } as NodeJS.ProcessEnv)).toEqual({
      maxRooms: 12,
      maxPlayersPerRoom: 500,
    });
  });
});

describe("GameStore enforcement", () => {
  // The point of making these runtime values is that lowering one takes effect
  // on the very next createRoom, with no restart. A store that read the cap
  // once at construction would pass every other test in this file.
  it("refuses a new room once the live cap is reached", () => {
    const limits = new RuntimeLimits();
    limits.set("maxRooms", 1);
    const store = new GameStore(undefined, limits);
    store.createRoom({ firstName: "One" });
    expect(() => store.createRoom({ firstName: "Two" })).toThrow("room_capacity");
  });

  it("picks up a cap raised after the refusal, without a restart", () => {
    const limits = new RuntimeLimits();
    limits.set("maxRooms", 1);
    const store = new GameStore(undefined, limits);
    store.createRoom({ firstName: "One" });
    expect(() => store.createRoom({ firstName: "Two" })).toThrow("room_capacity");
    limits.set("maxRooms", 5);
    expect(() => store.createRoom({ firstName: "Two" })).not.toThrow();
  });

  it("caps players per room from the same live value", () => {
    const limits = new RuntimeLimits();
    limits.set("maxPlayersPerRoom", 2);
    const store = new GameStore(undefined, limits);
    const { room } = store.createRoom({ firstName: "Banker" });
    store.joinRoom(room.roomId, { firstName: "Second" });
    expect(() => store.joinRoom(room.roomId, { firstName: "Third" })).toThrow("room_full");
  });
});
