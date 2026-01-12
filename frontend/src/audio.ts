type Tone = { freq: number; duration: number; type?: OscillatorType; gain?: number };

export class AudioManager {
  private ctx: AudioContext | undefined;
  private musicOsc?: OscillatorNode;
  private musicGain?: GainNode;
  private userInteracted = false;
  private musicEnabled = false;
  private sfxEnabled = false;

  noteInteraction() {
    this.userInteracted = true;
    if (this.ctx && this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
  }

  setMusicEnabled(enabled: boolean) {
    this.musicEnabled = enabled;
    if (enabled) {
      this.startMusic();
    } else {
      this.stopMusic();
    }
  }

  setSfxEnabled(enabled: boolean) {
    this.sfxEnabled = enabled;
  }

  playSfx(name: "deal" | "win" | "bust") {
    if (!this.sfxEnabled || !this.userInteracted) return;
    const ctx = this.ensureContext();
    const now = ctx.currentTime;
    const tones: Tone[] = this.pickSfx(name);
    tones.forEach((tone, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = tone.type ?? "sine";
      osc.frequency.value = tone.freq;
      gain.gain.value = tone.gain ?? 0.06;
      osc.connect(gain).connect(ctx.destination);
      const startAt = now + idx * 0.04;
      osc.start(startAt);
      osc.stop(startAt + tone.duration);
    });
  }

  private pickSfx(name: "deal" | "win" | "bust"): Tone[] {
    if (name === "deal") return [{ freq: 520, duration: 0.06, type: "triangle", gain: 0.04 }];
    if (name === "win")
      return [
        { freq: 660, duration: 0.12, type: "square", gain: 0.05 },
        { freq: 880, duration: 0.12, type: "square", gain: 0.05 },
      ];
    return [
      { freq: 180, duration: 0.2, type: "sawtooth", gain: 0.06 },
      { freq: 140, duration: 0.18, type: "sawtooth", gain: 0.04 },
    ];
  }

  private startMusic() {
    if (!this.musicEnabled) return;
    if (!this.userInteracted) return;
    if (this.musicOsc && this.musicGain) return;
    const ctx = this.ensureContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 240;
    gain.gain.value = 0.02;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    this.musicOsc = osc;
    this.musicGain = gain;
  }

  private stopMusic() {
    if (this.musicOsc) {
      this.musicOsc.stop();
      this.musicOsc.disconnect();
      this.musicOsc = undefined;
    }
    if (this.musicGain) {
      this.musicGain.disconnect();
      this.musicGain = undefined;
    }
  }

  private ensureContext(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext();
    return this.ctx;
  }
}
