import { describe, expect, it, vi, beforeEach } from "vitest";
import { AudioManager } from "./audio";

// Asked for after a game night: "we should trigger a nice quick sound to
// alert somebody that it is their turn. A sound that only plays for that
// person on their phone."
//
// There was already a haptic buzz on that edge, which a phone lying on the
// felt cannot deliver and a phone in a pocket cannot show. The 90s turn timer
// is what collects the difference.
//
// Synthesised rather than shipped as a file: two sine blips through the Web
// Audio API need no asset, no licence and no download. These pin the two
// things that can go wrong with that - playing when the player has sound
// turned off, and playing before the browser will allow any audio at all.

class FakeParam {
  setValueAtTime = vi.fn();
  exponentialRampToValueAtTime = vi.fn();
  value = 0;
}
class FakeNode {
  connect = vi.fn(() => this);
}
class FakeOsc extends FakeNode {
  type = "";
  frequency = new FakeParam();
  start = vi.fn();
  stop = vi.fn();
}
class FakeGain extends FakeNode {
  gain = new FakeParam();
}

const created: FakeOsc[] = [];
class FakeCtx {
  state = "running";
  currentTime = 0;
  destination = new FakeNode();
  resume = vi.fn();
  createOscillator() { const o = new FakeOsc(); created.push(o); return o; }
  createGain() { return new FakeGain(); }
}

beforeEach(() => {
  created.length = 0;
  (window as any).AudioContext = FakeCtx;
});

function ready() {
  const audio = new AudioManager();
  audio.setSfxEnabled(true);
  audio.noteInteraction();
  return audio;
}

describe("the it's-your-turn alert", () => {
  it("plays two notes", () => {
    ready().playTurnAlert();
    expect(created).toHaveLength(2);
    created.forEach((osc) => expect(osc.start).toHaveBeenCalled());
  });

  // Rising, not falling: a falling pair reads as something going wrong.
  it("rises rather than falls", () => {
    ready().playTurnAlert();
    expect(created[1].frequency.value).toBeGreaterThan(created[0].frequency.value);
  });

  it("stays silent when the player has sound effects off", () => {
    const audio = new AudioManager();
    audio.setSfxEnabled(false);
    audio.noteInteraction();
    audio.playTurnAlert();
    expect(created).toHaveLength(0);
  });

  // Every browser refuses audio until the page has been interacted with, and
  // an AudioContext opened before that just sits suspended. playSfx already
  // guards on this; so does the alert, rather than opening one and hoping.
  it("stays silent before the page has been interacted with", () => {
    const audio = new AudioManager();
    audio.setSfxEnabled(true);
    audio.playTurnAlert();
    expect(created).toHaveLength(0);
  });

  it("does not throw when the browser has no Web Audio at all", () => {
    delete (window as any).AudioContext;
    expect(() => ready().playTurnAlert()).not.toThrow();
  });

  // One context for the life of the manager: iOS caps how many a page may
  // open, and a turn alert fires on every hand of every round.
  it("reuses one audio context across turns", () => {
    const audio = ready();
    audio.playTurnAlert();
    audio.playTurnAlert();
    audio.playTurnAlert();
    expect(created).toHaveLength(6);
  });
});
