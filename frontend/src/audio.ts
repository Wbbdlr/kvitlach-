type SfxKey = "deal" | "win" | "natural21" | "bust" | "lose" | "shuffle" | "chip" | "eleveroon";

const SFX_PATHS: Record<SfxKey, string[]> = {
  deal:        ["/sounds/card-place-1.ogg", "/sounds/card-place-2.ogg"],
  win:         ["/sounds/chips-stack-1.ogg"],
  // Hitting 21 outright is its own moment -- App.tsx plays this instead of
  // "win" when a hand goes straight from "pending" to "won" (calcState fires
  // the instant 21 is reachable, mid-turn), reserving the generic "win" for
  // a showdown win decided later by the banker's own hand.
  // Was card-slide-1.ogg (a repurposed card-motion sample, layered under
  // "win" in App.tsx as a workaround -- see git history) until this real
  // fanfare replaced it 2026-08-10: Mixkit's free SFX library ("Fantasy game
  // success notification", mixkit.co/free-sound-effects/win/ -- Mixkit
  // License, no attribution required). The layering workaround came out
  // along with it.
  natural21:   ["/sounds/natural21.mp3"],
  // "bust" is the futch horn -- it means the hand went over 21, and nothing
  // else. Losing the showdown with a good hand is a different event and gets
  // its own chips-swept-away sound, so a futch stays the thing that turns
  // heads at the table.
  bust:        ["/sounds/futch.mp3"],
  lose:        ["/sounds/chips-collide-1.ogg"],
  shuffle:     ["/sounds/card-shuffle.ogg"],
  chip:        ["/sounds/chip-lay-1.ogg"],
  eleveroon:   ["/sounds/eleveroon.mp3"],
};

// Every SFX used to play at the same flat 0.5 regardless of which sound it
// was -- the deal click and the futch horn were coded identically loud, but
// the source files themselves aren't mastered to the same level, so in
// practice the futch (the biggest moment at the table) read as no louder
// than the card-place click that happens on every single card. Missing keys
// fall back to the 0.5 default below.
const SFX_VOLUME: Partial<Record<SfxKey, number>> = {
  bust: 1.0, // the futch horn -- deliberately the loudest thing in the game
  deal: 0.35, // happens on every card, every turn; should recede, not compete
  natural21: 0.75, // a real fanfare now, but still a big moment -- keep it up with bust
};

const BGM_PATH = "/sounds/bgm.m4a";

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export class AudioManager {
  private sfxEnabled = false;
  private musicEnabled = false;
  private userInteracted = false;
  private bgm: HTMLAudioElement | null = null;
  private sfxPool: Partial<Record<SfxKey, HTMLAudioElement[]>> = {};
  private toneCtx: AudioContext | null = null;

  noteInteraction() {
    this.userInteracted = true;
    if (this.musicEnabled) this.startMusic();
  }

  setSfxEnabled(enabled: boolean) {
    this.sfxEnabled = enabled;
    if (enabled) this.preloadSfx();
  }

  setMusicEnabled(enabled: boolean) {
    this.musicEnabled = enabled;
    if (enabled && this.userInteracted) {
      this.startMusic();
    } else {
      this.stopMusic();
    }
  }

  playSfx(name: SfxKey) {
    if (!this.sfxEnabled || !this.userInteracted) return;
    const paths = SFX_PATHS[name];
    if (!paths?.length) return;
    const path = pickRandom(paths);
    const pool = this.sfxPool[name];
    const idle = pool?.find((a) => a.paused || a.ended);
    const el = idle ?? new Audio(path);
    // Always point at the freshly picked file. preloadSfx() bakes ONE random
    // variant into the pooled element, so reusing it as-is meant multi-file
    // keys (the two card-place samples) replayed the same sample forever.
    if (!el.src.endsWith(path)) el.src = path;
    el.currentTime = 0;
    el.volume = SFX_VOLUME[name] ?? 0.5;
    void el.play().catch(() => { /* blocked before interaction */ });
    if (!idle) {
      const arr = this.sfxPool[name] ?? [];
      arr.push(el);
      this.sfxPool[name] = arr;
    }
  }

  /**
   * "It's your turn."
   *
   * Synthesised rather than loaded, and that is the point: there is no
   * turn-alert file in public/sounds and inventing one means picking a
   * licence, a mastering level and a download for something that should be
   * two notes and 200ms. Two short sine blips through the Web Audio API cost
   * nothing to ship, cannot be mis-mastered against the rest of the set, and
   * are quiet enough to sit under a room full of people talking.
   *
   * Local by construction. Nothing about this is broadcast: App.tsx fires it
   * on the edge where the active turn becomes THIS client's own player, so it
   * plays on that person's phone and on no one else's - which is what was
   * asked for ("A sound that only plays for that person on their phone").
   *
   * Gated by the same two conditions as playSfx: the SFX toggle, and a real
   * user interaction having happened, because a browser will not start an
   * AudioContext before one.
   */
  playTurnAlert() {
    if (!this.sfxEnabled || !this.userInteracted) return;
    const Ctor: typeof AudioContext | undefined =
      typeof window !== "undefined"
        ? window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        : undefined;
    if (!Ctor) return;
    try {
      // One context, kept: creating one per alert leaks them on iOS, which
      // caps how many a page may open.
      this.toneCtx = this.toneCtx ?? new Ctor();
      const ctx = this.toneCtx;
      // A context created before the first gesture starts suspended.
      if (ctx.state === "suspended") void ctx.resume();
      const now = ctx.currentTime;
      // A rising fifth (A5 -> E6). Rising reads as a prompt; falling reads as
      // something going wrong, which this is not.
      [
        { freq: 880, at: 0, len: 0.11 },
        { freq: 1318.5, at: 0.1, len: 0.16 },
      ].forEach(({ freq, at, len }) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        // Ramped, not switched: a square-edged gain change is an audible
        // click on its own, which would be louder than the note.
        gain.gain.setValueAtTime(0.0001, now + at);
        gain.gain.exponentialRampToValueAtTime(0.22, now + at + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + at + len);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now + at);
        osc.stop(now + at + len + 0.02);
      });
    } catch {
      /* no audio output available; the haptic buzz still fires */
    }
  }

  private preloadSfx() {
    (Object.keys(SFX_PATHS) as SfxKey[]).forEach((key) => {
      if (this.sfxPool[key]?.length) return;
      const el = new Audio(pickRandom(SFX_PATHS[key]));
      el.preload = "auto";
      this.sfxPool[key] = [el];
    });
  }

  private startMusic() {
    if (this.bgm && !this.bgm.paused) return;
    if (!this.bgm) {
      const el = new Audio(BGM_PATH);
      el.loop = true;
      el.volume = 0.03;
      el.preload = "auto";
      this.bgm = el;
    }
    void this.bgm.play().catch(() => { /* blocked before interaction */ });
  }

  private stopMusic() {
    if (!this.bgm) return;
    this.bgm.pause();
    this.bgm.currentTime = 0;
  }
}
