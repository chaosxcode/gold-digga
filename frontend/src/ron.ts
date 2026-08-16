/**
 * BIG RON — the load-bearing mascot. A master sprite sheet (ron_anim.webp +
 * ron_anim.json) drives real frame animation per game event; the ambient bob,
 * lean, entrance punch and tremble stay procedural on top. Poses without their
 * own clip yet alias onto the closest animated one. Full figure lives beside the
 * grid when space allows; the HUD dock face carries him on phones/popout.
 */
import { Assets, AnimatedSprite, Container, Sprite, Spritesheet, Texture, Ticker } from 'pixi.js';
import { raf, alive } from './anim';

const ANIM_FPS = 12; // reaction animations
const IDLE_FPS_DEFAULT = 6; // idle breathes slowly; real value comes from the atlas

let shadowTex: Texture | null = null;
function getShadowTex(): Texture {
  if (shadowTex) return shadowTex;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 48;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 24, 4, 64, 24, 60);
  grad.addColorStop(0, 'rgba(30, 20, 8, 0.42)');
  grad.addColorStop(1, 'rgba(30, 20, 8, 0)');
  g.fillStyle = grad;
  g.save();
  g.translate(64, 24);
  g.scale(1, 0.36);
  g.translate(-64, -24);
  g.fillRect(0, -50, 128, 150);
  g.restore();
  shadowTex = Texture.from(c);
  return shadowTex;
}

export type RonPose =
  | 'idle'
  | 'sweep'
  | 'alert'
  | 'slump'
  | 'soaked'
  | 'thumbs'
  | 'roar'
  | 'slam'
  | 'faint';

// poses that don't have their own generated clip yet fall back to the closest
// animated beat (keeps every trigger animated at a consistent scale)
const POSE_ALIAS: Partial<Record<RonPose, RonPose>> = {
  slam: 'roar',
  soaked: 'slump',
};

// Event → a POOL of fitting animations. react() picks one at random and never
// repeats the last reaction, so wins/losses/anticipation stay varied and the big
// celebrations (incl. faint) can land on ANY big win, not just the max.
export type RonMood = 'bigwin' | 'win' | 'loss' | 'alert';
const MOOD_POSES: Record<RonMood, RonPose[]> = {
  bigwin: ['roar', 'slam', 'faint'],
  win: ['thumbs', 'roar', 'slam'],
  loss: ['slump', 'soaked'],
  alert: ['alert'],
};

const ATLAS_JSON = 'assets/ron/ron_anim.json';

export class Ron extends Container {
  private sprite = new AnimatedSprite([Texture.EMPTY]);
  private inner = new Container();
  private pose: RonPose = 'idle';
  private revertTimer: number | null = null;
  private bobPhase = 0;
  private targetH = 240;

  private anims: Partial<Record<RonPose, Texture[]>> = {};
  private loopPoses = new Set<RonPose>(['idle', 'sweep']);
  private idleBodyH = 240; // her idle body height inside a sheet frame (px)
  private feetGap = 0; // scaled px from the source frame bottom down to her feet
  private idleFps = IDLE_FPS_DEFAULT; // playback fps for the long breathing idle
  private lastReact: RonPose | null = null; // for "never the same reaction twice"

  private shadow = new Sprite();

  constructor() {
    super();
    this.sprite.anchor.set(0.5, 1);
    this.sprite.animationSpeed = ANIM_FPS / 60;
    this.sprite.autoUpdate = true;
    // AnimatedSprite.autoUpdate advances off Ticker.shared; the Application runs
    // its own ticker, so ensure the shared one is actually running or frames freeze
    if (!Ticker.shared.started) Ticker.shared.start();
    // soft AO ellipse under the boots grounds him on the horizon — without it
    // the figure reads as pasted onto the scene
    this.shadow.texture = getShadowTex();
    this.shadow.anchor.set(0.5, 0.5);
    this.addChild(this.shadow);
    this.inner.addChild(this.sprite);
    this.addChild(this.inner);
    // ambient bob on the inner container — never conflicts with pose swaps
    const tick = (now: number) => {
      if (this.destroyed) return;
      this.bobPhase = now / 1000;
      // gentle ambient bob — kept light because the idle clip now breathes for real
      this.inner.y = Math.sin(this.bobPhase * 1.1) * this.targetH * 0.004;
      this.inner.rotation = Math.sin(this.bobPhase * 0.7) * 0.006;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  async load(): Promise<void> {
    // one high-res sheet per pose (near-source resolution so nothing upscales);
    // trimmed frames carry a shared sourceSize so every pose stays aligned
    const manifest = await fetch(ATLAS_JSON).then((r) => r.json());
    this.idleBodyH = manifest?.meta?.idleBodyH ?? 240;
    this.feetGap = manifest?.meta?.feetGap ?? 0;
    this.idleFps = manifest?.meta?.idleFps ?? IDLE_FPS_DEFAULT;
    this.loopPoses = new Set<RonPose>(['idle', ...((manifest?.meta?.loop ?? []) as RonPose[])]);
    for (const s of manifest.sheets as Array<{ image: string; atlas: unknown }>) {
      const tex = (await Assets.load(`assets/ron/${s.image}`)) as Texture;
      const sheet = new Spritesheet(tex, s.atlas as ConstructorParameters<typeof Spritesheet>[1]);
      await sheet.parse();
      for (const [name, textures] of Object.entries(sheet.animations)) {
        this.anims[name as RonPose] = textures as Texture[];
      }
    }
    this.applyPose('idle');
  }

  setHeight(h: number): void {
    this.targetH = h;
    this.applyScale();
    this.shadow.width = h * 0.62;
    this.shadow.height = h * 0.12;
    this.shadow.y = -h * 0.01;
  }

  /** Resolve a pose to the animation it should actually play. */
  private resolve(pose: RonPose): RonPose {
    if (this.anims[pose]) return pose;
    const alias = POSE_ALIAS[pose];
    if (alias && this.anims[alias]) return alias;
    return 'idle';
  }

  private applyScale(): void {
    // scale so her idle body maps to targetH; nudge down by the (scaled) gap
    // from the source-frame bottom to her feet so she stays grounded on the shadow
    const s = this.targetH / this.idleBodyH;
    this.sprite.scale.set(s);
    this.sprite.y = this.feetGap * s;
  }

  private applyPose(pose: RonPose): void {
    const key = this.resolve(pose);
    const textures = this.anims[key];
    if (!textures) return;
    this.sprite.textures = textures;
    this.sprite.loop = this.loopPoses.has(key);
    this.sprite.animationSpeed = (key === 'idle' ? this.idleFps : ANIM_FPS) / 60;
    this.sprite.gotoAndPlay(0);
    this.applyScale();
  }

  /** Switch pose; optionally auto-revert to idle after ms. */
  show(pose: RonPose, revertMs?: number): void {
    if (this.destroyed) return; // guard a revert timer firing after teardown
    if (this.revertTimer) {
      clearTimeout(this.revertTimer);
      this.revertTimer = null;
    }
    this.pose = pose;
    this.applyPose(pose);
    // small entrance punch
    void raf(160, (k) => this.inner.scale.set(0.94 + 0.06 * k), { guard: alive(this.inner) });
    if (revertMs) {
      // Let a one-shot reaction ALWAYS play its full length before reverting —
      // a 12fps clip can run ~2s, so a short event-matched revertMs was cutting
      // it off mid-play (looked rushed/jittery). Hold the pose until the clip has
      // finished (+ a small beat), or revertMs, whichever is longer.
      const key = this.resolve(pose);
      let waitMs = revertMs;
      if (!this.loopPoses.has(key)) {
        const frames = this.anims[key]?.length ?? 0;
        const clipMs = (frames / ANIM_FPS) * 1000;
        waitMs = Math.max(revertMs, clipMs + 300);
      }
      this.revertTimer = window.setTimeout(() => this.show('idle'), waitMs);
    }
  }

  /** Play a random animation for a mood, never repeating the previous reaction. */
  react(mood: RonMood, revertMs?: number): void {
    const group = MOOD_POSES[mood].filter((p) => this.anims[p]);
    const src = group.length ? group : MOOD_POSES[mood];
    const pool =
      src.length > 1 && this.lastReact && src.includes(this.lastReact)
        ? src.filter((p) => p !== this.lastReact)
        : src;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    this.lastReact = pick;
    this.show(pick, revertMs);
  }

  /** Excitement tremble for beep steps 3-4. */
  tremble(durationMs = 600): void {
    void raf(
      durationMs,
      (k) => {
        if (this.inner.destroyed) return;
        this.inner.x = (Math.random() - 0.5) * 3 * (1 - k);
      },
      { ease: (t) => t, guard: alive(this.inner) },
    ).then(() => {
      if (!this.inner.destroyed) this.inner.x = 0;
    });
  }
}
