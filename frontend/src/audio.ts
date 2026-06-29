type SfxKey = "deal" | "win" | "bust" | "shuffle" | "chip" | "chipCollide" | "chipStack" | "futch" | "eleveroon";

const SFX_PATHS: Record<SfxKey, string[]> = {
  deal:        ["/sounds/card-place-1.ogg", "/sounds/card-place-2.ogg"],
  win:         ["/sounds/chips-stack-1.ogg"],
  bust:        ["/sounds/futch.ogg"],
  shuffle:     ["/sounds/card-shuffle.ogg"],
  chip:        ["/sounds/chip-lay-1.ogg"],
  chipCollide: ["/sounds/chips-collide-1.ogg"],
  chipStack:   ["/sounds/chips-stack-1.ogg"],
  futch:       ["/sounds/futch.ogg"],
  eleveroon:   ["/sounds/eleveroon.ogg"],
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
    el.src = path;
    el.currentTime = 0;
    el.volume = 0.5;
    void el.play().catch(() => { /* blocked before interaction */ });
    if (!idle) {
      const arr = this.sfxPool[name] ?? [];
      arr.push(el);
      this.sfxPool[name] = arr;
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
      el.volume = 0.2;
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
