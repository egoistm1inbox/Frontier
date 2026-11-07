/**
 * Procedural audio. No sample files — everything is synthesised in WebAudio so
 * the prototype ships with zero binary assets and still has an engine, wind,
 * boost and impact layer.
 */
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.master = null;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);

    // ---- engine: two detuned saws through a lowpass
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter = this.ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 700;
    this.engineFilter.Q.value = 6;

    this.oscA = this.ctx.createOscillator();
    this.oscA.type = 'sawtooth';
    this.oscA.frequency.value = 70;
    this.oscB = this.ctx.createOscillator();
    this.oscB.type = 'square';
    this.oscB.frequency.value = 94;

    this.oscA.connect(this.engineFilter);
    this.oscB.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.master);
    this.oscA.start();
    this.oscB.start();

    // ---- wind: filtered noise
    const bufferSize = 2 * this.ctx.sampleRate;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    this.noise = this.ctx.createBufferSource();
    this.noise.buffer = noiseBuffer;
    this.noise.loop = true;

    this.windFilter = this.ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 900;
    this.windFilter.Q.value = 0.7;
    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0;
    this.noise.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.master);
    this.noise.start();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(muted) {
    this.enabled = !muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.5;
  }

  updateEngine(speedRatio, throttle, boosting, drifting) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const base = 58 + speedRatio * 132 + (boosting ? 34 : 0);
    this.oscA.frequency.setTargetAtTime(base, t, 0.08);
    this.oscB.frequency.setTargetAtTime(base * 1.34, t, 0.08);
    this.engineFilter.frequency.setTargetAtTime(
      480 + speedRatio * 2600 + (boosting ? 1400 : 0) + throttle * 320,
      t,
      0.1
    );
    this.engineGain.gain.setTargetAtTime(0.055 + speedRatio * 0.11 + throttle * 0.03, t, 0.12);
    this.windGain.gain.setTargetAtTime(speedRatio * speedRatio * 0.19, t, 0.15);
    this.windFilter.frequency.setTargetAtTime(600 + speedRatio * 2200, t, 0.15);
    if (drifting) {
      this.windFilter.Q.setTargetAtTime(3.2, t, 0.2);
    } else {
      this.windFilter.Q.setTargetAtTime(0.7, t, 0.2);
    }
  }

  blip(freq = 440, dur = 0.12, type = 'sine', gain = 0.18) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 1.6, t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  whoosh() {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const g = this.ctx.createGain();
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(2800, t + 0.45);
    f.Q.value = 1.4;
    g.gain.setValueAtTime(0.28, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise.buffer;
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t);
    src.stop(t + 0.55);
  }

  impact(power = 1) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const g = this.ctx.createGain();
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(120 + Math.random() * 40, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.3);
    g.gain.setValueAtTime(Math.min(0.5, 0.16 * power), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + 0.36);
  }

  pickup() {
    if (!this.ctx || !this.enabled) return;
    [660, 880, 1320].forEach((f, i) => {
      setTimeout(() => this.blip(f, 0.1, 'triangle', 0.16), i * 55);
    });
  }
}
