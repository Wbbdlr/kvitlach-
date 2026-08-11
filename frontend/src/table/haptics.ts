// Short vibration cues for the moments a phone player already gets a sound
// cue for. Same posture as wakeLock.ts and fullscreen.ts's orientation
// lock: unconditional, feature-detected, silently no-op where unsupported
// (iOS Safari has never shipped the Vibration API at all) -- a nicety, never
// something to surface an error over, and deliberately no on/off setting of
// its own. Vibration also respects a phone's own ring/silent switch on iOS
// and a "vibrate" ringer mode on Android automatically, unlike SFX, so it's
// not tied to the sfxEnabled toggle -- muting the table's sound (common in a
// shared room) shouldn't also mute the one channel that still reaches a
// player whose phone is face-down or in a pocket.
type HapticKey = "turn" | "chip" | "deal" | "win" | "lose" | "bust";

const PATTERNS: Record<HapticKey, number | number[]> = {
  // It's your turn -- has to be noticeable through a pocket without being
  // alarming; a short double-pulse reads as "look" rather than "emergency".
  turn: [15, 40, 15],
  // Bet placed / card dealt -- mirrors audio.ts's own restraint on these two
  // (SFX_VOLUME turns them down because they fire on every single action):
  // barely-there ticks, not buzzes.
  chip: 10,
  deal: 8,
  win: [20, 30, 20, 30, 40],
  lose: 25,
  // The futch horn is the loudest SFX in the game on purpose (see audio.ts) --
  // the strongest buzz matches it.
  bust: [60, 40, 60],
};

function vibrateFn(): ((pattern: number | number[]) => boolean) | undefined {
  return typeof navigator === "undefined" ? undefined : navigator.vibrate?.bind(navigator);
}

export function buzz(key: HapticKey) {
  try {
    vibrateFn()?.(PATTERNS[key]);
  } catch {
    /* some browsers throw calling vibrate() outside a user-gesture context;
       never worth surfacing over a nicety */
  }
}
