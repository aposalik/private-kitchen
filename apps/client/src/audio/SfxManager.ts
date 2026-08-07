type SfxName =
  | "pick_up"
  | "drop"
  | "chop"
  | "add_to_pot"
  | "win"
  | "lose"
  | "timer_warning";

class SfxManager {
  private ctx: AudioContext | undefined;
  private masterGain: GainNode | undefined;
  private masterVolume = 1;

  private getCtx(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.masterVolume;
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  setMasterVolume(volume: number): void {
    this.masterVolume = Math.max(0, Math.min(1, volume));
    if (this.masterGain) {
      this.masterGain.gain.setTargetAtTime(
        this.masterVolume,
        this.getCtx().currentTime,
        0.05,
      );
    }
  }

  play(name: SfxName): void {
    try {
      switch (name) {
        case "pick_up":      return this.playPickUp();
        case "drop":         return this.playDrop();
        case "chop":         return this.playChop();
        case "add_to_pot":   return this.playAddToPot();
        case "win":          return this.playWin();
        case "lose":         return this.playLose();
        case "timer_warning": return this.playTimerWarning();
      }
    } catch {
      // Web Audio unavailable — silent fail
    }
  }

  private tone(
    freq: number,
    startAt: number,
    duration: number,
    gainPeak: number,
    type: OscillatorType = "sine",
  ): void {
    const ctx = this.getCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, startAt);
    gain.gain.setValueAtTime(0, startAt);
    gain.gain.linearRampToValueAtTime(gainPeak, startAt + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, startAt + duration);
    osc.connect(gain);
    gain.connect(this.masterGain!);
    osc.start(startAt);
    osc.stop(startAt + duration + 0.02);
  }

  private noise(startAt: number, duration: number, gainPeak: number): void {
    const ctx = this.getCtx();
    const bufferSize = Math.ceil(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainPeak, startAt);
    gain.gain.exponentialRampToValueAtTime(0.001, startAt + duration);
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 2000;
    filter.Q.value = 0.5;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain!);
    source.start(startAt);
    source.stop(startAt + duration + 0.02);
  }

  private playPickUp(): void {
    const t = this.getCtx().currentTime;
    this.tone(440, t, 0.08, 0.3, "sine");
    this.tone(660, t + 0.05, 0.08, 0.2, "sine");
  }

  private playDrop(): void {
    const t = this.getCtx().currentTime;
    this.tone(300, t, 0.06, 0.3, "sine");
    this.tone(200, t + 0.04, 0.08, 0.2, "sine");
  }

  private playChop(): void {
    const t = this.getCtx().currentTime;
    this.noise(t, 0.08, 0.4);
    this.tone(180, t, 0.06, 0.15, "sawtooth");
  }

  private playAddToPot(): void {
    const t = this.getCtx().currentTime;
    this.tone(523, t, 0.1, 0.25, "sine");
    this.tone(659, t + 0.07, 0.1, 0.2, "sine");
    this.tone(784, t + 0.14, 0.12, 0.15, "sine");
  }

  private playWin(): void {
    const t = this.getCtx().currentTime;
    const melody = [523, 659, 784, 1047];
    melody.forEach((f, i) => this.tone(f, t + i * 0.12, 0.18, 0.35, "sine"));
    this.tone(1319, t + 0.5, 0.35, 0.3, "sine");
  }

  private playLose(): void {
    const t = this.getCtx().currentTime;
    const melody = [523, 466, 415, 370];
    melody.forEach((f, i) => this.tone(f, t + i * 0.15, 0.2, 0.3, "sine"));
  }

  private playTimerWarning(): void {
    const t = this.getCtx().currentTime;
    this.tone(880, t, 0.07, 0.3, "square");
    this.tone(880, t + 0.18, 0.07, 0.3, "square");
  }
}

export const sfx = new SfxManager();
