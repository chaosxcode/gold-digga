/**
 * Self-hosted audio manager — HTMLAudio, no external requests.
 * Music layer (looping bgm with state switching + ducking) and an SFX layer
 * (cloned playback for overlapping one-shots). Everything starts MUTED until
 * a user gesture; the on/off preference persists.
 */

interface SfxDef {
  src: string;
  vol: number;
}

const MUTE_KEY = 'slot.muted';

class AudioManager {
  private sfx = new Map<string, HTMLAudioElement>();
  private sfxDefs = new Map<string, SfxDef>();
  private music = new Map<string, HTMLAudioElement>();
  private currentMusic: string | null = null;
  private _muted = true;
  private unlocked = false;
  private musicVol = 0.55;
  private duckLevel = 1;

  constructor() {
    const saved = localStorage.getItem(MUTE_KEY);
    this._muted = saved == null ? false : saved === '1';
  }

  /** Register a one-shot. */
  defineSfx(name: string, src: string, vol = 0.6): void {
    this.sfxDefs.set(name, { src, vol });
  }

  /** Register a music loop (lazy: bytes fetch on first play, not at boot). */
  defineMusic(name: string, src: string, loop = true): void {
    const el = new Audio();
    el.loop = loop;
    el.preload = 'none';
    el.src = src;
    this.music.set(name, el);
  }

  /** Call once from the first user gesture. */
  unlock(): void {
    if (this.unlocked) return;
    this.unlocked = true;
    for (const [name, def] of this.sfxDefs) {
      const el = new Audio(def.src);
      el.preload = 'auto';
      el.volume = def.vol;
      this.sfx.set(name, el);
    }
    if (this.currentMusic) this.startMusic(this.currentMusic);
  }

  get muted(): boolean {
    return this._muted;
  }

  setMuted(m: boolean): void {
    this._muted = m;
    localStorage.setItem(MUTE_KEY, m ? '1' : '0');
    this.applyMusicVol();
    if (m) {
      for (const el of this.music.values()) el.pause();
    } else if (this.currentMusic && this.unlocked) {
      this.startMusic(this.currentMusic);
    }
  }

  play(name: string, opts?: { overlap?: boolean; vol?: number; rate?: number }): void {
    if (this._muted || !this.unlocked) return;
    const base = this.sfx.get(name);
    const def = this.sfxDefs.get(name);
    if (!base || !def) return;
    let el = base;
    if (opts?.overlap) {
      el = base.cloneNode(true) as HTMLAudioElement;
      el.volume = opts?.vol ?? def.vol;
    } else {
      el.currentTime = 0;
      el.volume = opts?.vol ?? def.vol;
    }
    if (opts?.rate) el.playbackRate = opts.rate;
    void el.play().catch(() => {});
  }

  /** Switch the looping bed; cross-state, not cross-fade (simple + reliable). */
  setMusic(name: string | null): void {
    if (this.currentMusic === name) return;
    if (this.currentMusic) this.music.get(this.currentMusic)?.pause();
    this.currentMusic = name;
    if (name && this.unlocked && !this._muted) this.startMusic(name);
  }

  private startMusic(name: string): void {
    const el = this.music.get(name);
    if (!el) return;
    this.applyMusicVol();
    void el.play().catch(() => {});
  }

  /** Duck the bed under a stinger; restore with duck(1). */
  duck(level: number, ms = 250): void {
    this.duckLevel = level;
    const target = this.effectiveMusicVol();
    const el = this.currentMusic ? this.music.get(this.currentMusic) : null;
    if (!el) return;
    const from = el.volume;
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      el.volume = from + (target - from) * k;
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  private effectiveMusicVol(): number {
    return this._muted ? 0 : this.musicVol * this.duckLevel;
  }

  private applyMusicVol(): void {
    const el = this.currentMusic ? this.music.get(this.currentMusic) : null;
    if (el) el.volume = this.effectiveMusicVol();
  }
}

export const audio = new AudioManager();
