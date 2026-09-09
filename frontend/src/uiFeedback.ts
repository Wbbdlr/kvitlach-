import { buzz } from "./table/haptics";

// The small click-and-tick a control gives back when you flip it.
//
// Separate from AudioManager on purpose, rather than reaching for the table's
// instance: this fires on the LOBBY and the info pages too, where no table
// audio exists at all, and the table's manager owns music, per-key volumes and
// a randomised sample pool that a UI click has no business inheriting.
//
// The sound is chip-lay-1.ogg -- the chip already in the game (Kenney CC0, see
// About.tsx's Credits), reused rather than adding a file. It is the right
// sound anyway: this is a game about chips, and a synthesised UI blip beside
// it would be the one noise in the app that came from nowhere.
//
// Deliberately quieter than the table's own chip. That one marks a wager
// somebody made; this one marks a preference somebody flipped, and a
// preference should not be as loud as a bet.
const CLICK_SRC = "/sounds/chip-lay-1.ogg";
const CLICK_VOLUME = 0.3;

let soundEnabled = true;
let element: HTMLAudioElement | undefined;

/**
 * Kept in step with the table's own SFX toggle by App.
 *
 * Haptics are NOT gated by it, and that asymmetry is inherited from
 * haptics.ts's own reasoning: muting the table (common in a room full of
 * people) should not also mute the channel that still works for a phone in a
 * pocket. Vibration already respects the phone's ring/silent switch by itself.
 */
export function setUiSoundEnabled(enabled: boolean): void {
  soundEnabled = enabled;
}

/**
 * A click and a short tick, for a control that has just changed state.
 *
 * One shared element, rewound rather than re-created: flipping three switches
 * quickly should sound like three clicks, not build a pile of Audio objects,
 * and cutting the previous one off is what a real switch does anyway.
 *
 * Never throws and never reports. Autoplay policy blocks this before the first
 * interaction on some browsers -- but every call here IS an interaction, so in
 * practice the catch only covers the odd browser that refuses anyway. A
 * silent switch is a missing nicety, not a fault worth surfacing.
 */
export function toggleFeedback(): void {
  buzz("chip");
  if (!soundEnabled) return;
  try {
    if (!element) {
      element = new Audio(CLICK_SRC);
      element.preload = "auto";
      element.volume = CLICK_VOLUME;
    }
    element.currentTime = 0;
    void element.play().catch(() => {
      /* autoplay policy, or no output device */
    });
  } catch {
    /* no Audio constructor (SSR, tests) */
  }
}
