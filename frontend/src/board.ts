/**
 * The 6×6 buried field — PixiJS view.
 * Face-down soil plugs (stratum tile-backs) flip/flood open to reveal finds;
 * Hot Signal tag chips surface on tiles; Dig Deeper slides survivors down and
 * drops fresh plugs in one stratum deeper. All motion is rAF (see anim.ts).
 */
import { Assets, Container, Graphics, Sprite, Text, TextStyle, Texture } from 'pixi.js';
import {
  COLS,
  EvUpdateGrid,
  ROWS,
  Stratum,
  SymbolId,
  TILES,
  TagDrop,
  colOf,
  rowOf,
} from './books';
import { alive, easeInQuad, easeOutBack, easeOutCubic, ms, raf, squash } from './anim';
import { audio } from './audio';

// symbol fill fraction of a tile. main.ts trims it ~10% on desktop (the big
// desktop board made the symbols read too large / crowded).
let SYM_FILL = 0.82;
export function setSymbolFill(v: number): void {
  SYM_FILL = v;
}

// symbols with a loaded texture (see loadBoardTextures). setState falls back to
// these so an unexpected/unloaded symbol can never render a blank placeholder.
const LOADED_SYMS: ReadonlySet<string> = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'L1', 'L2', 'L3', 'L4', 'SC', 'PP']);

// doc tags_sheet bands: verdigris bronze / silver-blue / glowing red-gold —
// band 1 must NOT read as the UI's meadow-green (one hue = one meaning)
const TAG_COLORS: Record<1 | 2 | 3, { bg: number; edge: number; text: number }> = {
  1: { bg: 0x8a6d35, edge: 0x57806a, text: 0xf3ecd9 },
  2: { bg: 0x8fb6d9, edge: 0x4a7099, text: 0x0d2b45 },
  3: { bg: 0xd94f3d, edge: 0xe8b54a, text: 0xffe9b0 },
};

class TileView extends Container {
  plug: Sprite;
  symbol: Sprite;
  pit: Graphics;
  chip: Container | null = null;
  ring: Graphics;
  content: Container;
  sym: SymbolId | null = null;
  stratum: Stratum = 0;
  faceUp = false;
  /** Right-column tiles hang their tag chip on the LEFT corner so the mascot's
   * hair can never cover the value (Stake round-2 item). */
  chipLeft = false;
  cell: number;
  phase = 0;
  pulseSpeed = 1;
  wiggleSpeed = 5;

  constructor(cell: number) {
    super();
    this.cell = cell;
    this.pit = new Graphics();
    this.pit.visible = false;
    this.symbol = new Sprite();
    this.symbol.anchor.set(0.5);
    this.symbol.visible = false;
    this.plug = new Sprite();
    this.plug.anchor.set(0.5);
    // ambient "alive" wrapper — idle pulse/wiggle live here so they never
    // fight the reveal/pop tweens that write plug/symbol/tile scale directly.
    this.content = new Container();
    this.content.addChild(this.pit, this.symbol, this.plug);
    this.ring = new Graphics();
    this.ring.visible = false;
    this.addChild(this.content, this.ring);
    this.phase = Math.random() * Math.PI * 2;
    this.pulseSpeed = 0.7 + Math.random() * 0.9; // independent interval per tile
    this.wiggleSpeed = 4 + Math.random() * 3;
  }

  /** Ambient idle motion — makes the board feel alive. Independent per tile;
   * the top-payer (H1) also wiggles when it's face-up. */
  tick(t: number): void {
    const s = 1 + 0.06 * Math.sin(t * this.pulseSpeed + this.phase);
    this.content.scale.set(s);
    this.content.rotation =
      this.faceUp && this.sym === 'H1' ? 0.08 * Math.sin(t * this.wiggleSpeed + this.phase) : 0;
  }

  setState(sym: SymbolId, stratum: Stratum, faceUp: boolean): void {
    this.sym = sym;
    this.stratum = stratum;
    this.faceUp = faceUp;
    // clamp stratum to the 3 loaded plug textures; fall back symbol so an
    // unloaded/unknown symbol never renders as a blank placeholder
    this.plug.texture = Texture.from(`tile${Math.min(Math.max(stratum, 0), 2)}`);
    this.plug.visible = !faceUp;
    this.plug.scale.set(this.cell / this.plug.texture.width);
    this.symbol.texture = Texture.from(`sym_${sym && LOADED_SYMS.has(sym) ? sym : 'L1'}`);
    this.symbol.visible = faceUp;
    this.pit.visible = faceUp;
    this.fit();
  }

  fit(): void {
    const s = this.cell;
    this.plug.width = this.plug.height = s;
    const symScale = (s * SYM_FILL) / 512;
    this.symbol.scale.set(symScale);
    // dug-out pit recess behind revealed finds — keeps the grid readable
    const r = Math.max(6, s * 0.12);
    this.pit
      .clear()
      .roundRect(-s / 2 + 1, -s / 2 + 1, s - 2, s - 2, r)
      .fill({ color: 0x4a3418, alpha: 0.55 })
      .roundRect(-s / 2 + 1, -s / 2 + 1, s - 2, s - 2, r)
      .stroke({ width: Math.max(2, s * 0.035), color: 0xe8d9b8, alpha: 0.7 });
  }

  resize(cell: number): void {
    this.cell = cell;
    this.fit();
    if (this.chip) this.positionChip();
  }

  /** Flip open: plug shrinks on X, symbol pops. */
  async reveal(fast: boolean): Promise<void> {
    if (this.faceUp) return;
    this.faceUp = true;
    const dur = ms(fast ? 90 : 140, 60);
    await raf(dur, (k) => (this.plug.scale.x = ((1 - k) * this.cell) / this.plug.texture.width), {
      ease: easeInQuad,
      guard: alive(this),
    });
    if (this.destroyed) return;
    this.plug.visible = false;
    this.pit.visible = true;
    this.symbol.visible = true;
    this.symbol.scale.set(0.001);
    const target = (this.cell * SYM_FILL) / 512;
    await raf(dur * 1.2, (k) => this.symbol.scale.set(target * k), {
      ease: easeOutBack,
      guard: alive(this),
    });
    if (!this.destroyed) this.symbol.scale.set(target);
  }

  addTag(tag: TagDrop): void {
    this.removeTag();
    const c = new Container();
    const col = TAG_COLORS[tag.band];
    const r = this.cell * 0.19;
    const hex = new Graphics();
    // hexagonal chip
    hex.moveTo(r, 0);
    for (let i = 1; i <= 6; i++) {
      const a = (i * Math.PI) / 3;
      hex.lineTo(r * Math.cos(a), r * Math.sin(a));
    }
    hex.fill(col.bg).stroke({ width: Math.max(2, r * 0.16), color: col.edge });
    const label = new Text({
      text: `x${tag.value}`,
      style: new TextStyle({
        fontFamily: 'GDTitle, Baloo2',
        fontSize: Math.max(11, r * 0.95),
        fontWeight: '800',
        fill: col.text,
        stroke: { color: col.edge, width: Math.max(1.5, r * 0.09) },
      }),
    });
    label.anchor.set(0.5);
    c.addChild(hex, label);
    this.chip = c;
    this.addChild(c);
    this.positionChip();
    c.scale.set(0.001);
    void raf(ms(240, 130), (k) => c.scale.set(k), { ease: easeOutBack, guard: alive(c) });
  }

  private positionChip(): void {
    if (!this.chip) return;
    // chipLeft rides the tile's LEFT edge (-0.5): at desktop the mascot's hair
    // reaches past the -0.28 corner, and her react frames swing it further
    this.chip.position.set(this.cell * (this.chipLeft ? -0.5 : 0.28), -this.cell * 0.28);
  }

  removeTag(): void {
    if (this.chip) {
      this.chip.destroy({ children: true });
      this.chip = null;
    }
  }

  /** Sharp white additive win ring, held so wins read before clearing. */
  flashRing(on: boolean): void {
    this.ring.visible = on;
    if (!on) return;
    const s = this.cell;
    this.ring.clear().roundRect(-s / 2 + 2, -s / 2 + 2, s - 4, s - 4, s * 0.12).stroke({ width: Math.max(3, s * 0.055), color: 0xffffff });
    this.ring.blendMode = 'add';
    this.ring.alpha = 0;
    void raf(ms(180, 100), (k) => (this.ring.alpha = k), { guard: alive(this) });
  }
}

export interface BoardCallbacks {
  onTagSurfaced?: (tag: TagDrop) => void;
  onTileRevealed?: (tile: number, sym: SymbolId) => void;
}

export class BoardView extends Container {
  private tiles: (TileView | null)[] = new Array(TILES).fill(null);
  private cell = 64;
  private gap = 6;
  cb: BoardCallbacks = {};
  /** Server-bonus books ship a full face-up field per sweep and emit NO
   * sweepSegment to flip it, so refilled tiles must arrive face-up. Mock books
   * (progressive dig) keep this false. Set by the presenter per book. */
  boardDriven = false;

  /** Board pixel size for layout callers. */
  get sizePx(): number {
    return COLS * this.cell + (COLS - 1) * this.gap;
  }

  /** Drive the ambient idle motion — call every frame. */
  tick(t: number): void {
    for (const tv of this.tiles) tv?.tick(t);
  }

  layout(cell: number, gap: number): void {
    this.cell = cell;
    this.gap = gap;
    for (let t = 0; t < TILES; t++) {
      const tv = this.tiles[t];
      if (!tv) continue;
      tv.resize(cell);
      const { x, y } = this.posOf(t);
      tv.position.set(x, y);
    }
  }

  posOf(t: number): { x: number; y: number } {
    return {
      x: colOf(t) * (this.cell + this.gap) + this.cell / 2,
      y: rowOf(t) * (this.cell + this.gap) + this.cell / 2,
    };
  }

  /** Seed a fresh face-down field. */
  setField(board: SymbolId[], strata: Stratum[], faceUp = false): void {
    for (let t = 0; t < TILES; t++) {
      let tv = this.tiles[t];
      if (!tv) {
        tv = new TileView(this.cell);
        this.tiles[t] = tv;
        this.addChild(tv);
      }
      tv.removeTag();
      tv.flashRing(false);
      tv.chipLeft = colOf(t) === COLS - 1;
      tv.setState(board[t], strata[t], faceUp);
      const { x, y } = this.posOf(t);
      tv.position.set(x, y);
      tv.alpha = 1;
      tv.scale.set(1);
    }
  }

  /** Re-bury between bonus sweeps: plugs drop back in from above. */
  async rebury(refills: Array<{ tile: number; symbol: SymbolId; stratum: Stratum }>): Promise<void> {
    const drops: Promise<void>[] = [];
    for (const r of refills) {
      const tv = this.tiles[r.tile];
      if (!tv) continue;
      tv.removeTag();
      tv.flashRing(false);
      tv.setState(r.symbol, r.stratum, false);
      const { x, y } = this.posOf(r.tile);
      const fromY = y - (rowOf(r.tile) + 2) * (this.cell + this.gap) * 0.6;
      tv.position.set(x, fromY);
      drops.push(
        raf(ms(300, 160), (k) => (tv.y = fromY + (y - fromY) * k), {
          delay: colOf(r.tile) * ms(18, 8),
          guard: alive(tv),
        }).then(() => {
          if (!tv.destroyed) tv.y = y;
        }),
      );
    }
    await Promise.all(drops);
  }

  /** Reveal a segment. Flood = staggered burst; flip = single. */
  async revealSegment(tiles: number[], kind: 'flip' | 'flood', tags: TagDrop[]): Promise<void> {
    const tagByTile = new Map(tags.map((t) => [t.tile, t]));
    if (kind === 'flip') {
      for (const t of tiles) {
        const tv = this.tiles[t];
        if (!tv) continue;
        await tv.reveal(true);
        this.cb.onTileRevealed?.(t, tv.sym!);
        const tag = tagByTile.get(t);
        if (tag) {
          tv.addTag(tag);
          this.cb.onTagSurfaced?.(tag);
        }
      }
      return;
    }
    audio.play('flood_pop');
    const per = ms(46, 24);
    const jobs = tiles.map((t, i) => {
      const tv = this.tiles[t];
      if (!tv) return Promise.resolve();
      return (async () => {
        await raf(1, () => {}, { delay: i * per });
        await tv.reveal(true);
        this.cb.onTileRevealed?.(t, tv.sym!);
        await squash(tv, 0.1, ms(180, 100));
        const tag = tagByTile.get(t);
        if (tag) {
          tv.addTag(tag);
          this.cb.onTagSurfaced?.(tag);
        }
      })();
    });
    await Promise.all(jobs);
  }

  /** Win highlight rings, held; returns tile positions for amount floats. */
  highlight(tiles: number[]): void {
    for (const t of tiles) this.tiles[t]?.flashRing(true);
  }

  /** Guarantee the given tiles are face-up before highlighting/popping. reveal()
   * no-ops on already-face-up tiles, so this is free for mock/base and flips any
   * server-bonus straggler that never got a sweepSegment. */
  async ensureFaceUp(tiles: number[]): Promise<void> {
    await Promise.all(tiles.map((t) => this.tiles[t]?.reveal(true) ?? Promise.resolve()));
  }

  clearHighlights(): void {
    for (const tv of this.tiles) tv?.flashRing(false);
  }

  /** Pop + clear winning tiles. */
  async popTiles(tiles: number[]): Promise<void> {
    const jobs = tiles.map((t, i) => {
      const tv = this.tiles[t];
      if (!tv) return Promise.resolve();
      return raf(
        ms(230, 130),
        (k) => {
          if (tv.destroyed) return;
          const s = k < 0.35 ? 1 + k * 0.5 : Math.max(0.001, 1.175 * (1 - (k - 0.35) / 0.65));
          tv.scale.set(s);
          tv.alpha = 1 - Math.max(0, (k - 0.5) / 0.5);
        },
        { delay: i * ms(16, 6), ease: (x) => x, guard: alive(tv) },
      );
    });
    await Promise.all(jobs);
  }

  /**
   * Dig Deeper — apply updateGrid: cleared tiles gone, survivors slide to
   * their new positions, incoming face-down plugs drop in from just above.
   */
  async applyUpdateGrid(ev: EvUpdateGrid): Promise<void> {
    audio.play('strata_crack');
    // snapshot views by source tile
    const bySrc = new Map<number, TileView>();
    for (let t = 0; t < TILES; t++) if (this.tiles[t]) bySrc.set(t, this.tiles[t]!);

    for (const t of ev.clearedTiles) {
      const tv = bySrc.get(t);
      if (tv) {
        bySrc.delete(t);
        tv.destroy({ children: true });
      }
    }

    const next: (TileView | null)[] = new Array(TILES).fill(null);
    const moves: Promise<void>[] = [];
    for (const s of ev.slides) {
      const tv = bySrc.get(s.from);
      if (!tv) continue;
      bySrc.delete(s.from);
      next[s.to] = tv;
      tv.chipLeft = colOf(s.to) === COLS - 1;
      const { x, y } = this.posOf(s.to);
      const fy = tv.y;
      moves.push(
        raf(ms(320, 170), (k) => (tv.y = fy + (y - fy) * k), { guard: alive(tv), ease: easeOutCubic }).then(() => {
          if (!tv.destroyed) {
            tv.y = y;
            tv.x = x;
          }
        }),
      );
    }
    // unmoved survivors stay in place
    for (const [t, tv] of bySrc) next[t] = tv;

    for (const inc of ev.incoming) {
      const tv = new TileView(this.cell);
      tv.chipLeft = colOf(inc.tile) === COLS - 1;
      // server bonus has no sweepSegment to reveal these later → arrive face-up
      tv.setState(inc.symbol, inc.stratum, this.boardDriven);
      const { x, y } = this.posOf(inc.tile);
      const startY = y - (rowOf(inc.tile) + 1.5) * (this.cell + this.gap);
      tv.position.set(x, startY);
      this.addChild(tv);
      next[inc.tile] = tv;
      moves.push(
        raf(ms(340, 180), (k) => (tv.y = startY + (y - startY) * k), {
          delay: colOf(inc.tile) * ms(20, 8),
          guard: alive(tv),
        }).then(() => {
          if (!tv.destroyed) tv.y = y;
        }),
      );
    }
    this.tiles = next;
    await Promise.all(moves);
  }

  /** The pipe strike beat on its tile. */
  async pipeStrike(tile: number): Promise<void> {
    const tv = this.tiles[tile];
    if (!tv) return;
    audio.play('pipe_clunk');
    await squash(tv, 0.22, ms(280, 160));
  }

  tileView(t: number): Container | null {
    return this.tiles[t];
  }

  /** Authoritative map of revealed paying symbols by tile (for pips). */
  revealedSymbols(): Map<number, SymbolId> {
    const out = new Map<number, SymbolId>();
    for (let t = 0; t < TILES; t++) {
      const tv = this.tiles[t];
      if (tv?.faceUp && tv.sym && tv.sym !== 'PP') out.set(t, tv.sym);
    }
    return out;
  }

  /** Global position of a tile's center (for FX/floats in other layers). */
  tileGlobal(t: number): { x: number; y: number } {
    const { x, y } = this.posOf(t);
    const p = this.toGlobal({ x, y });
    return { x: p.x, y: p.y };
  }
}

/** Preload all board textures into the Assets cache with friendly keys. */
export async function loadBoardTextures(): Promise<void> {
  const entries: Array<[string, string]> = [
    ['tile0', 'assets/tiles/tile0.webp'],
    ['tile1', 'assets/tiles/tile1.webp'],
    ['tile2', 'assets/tiles/tile2.webp'],
  ];
  for (const sym of ['H1', 'H2', 'H3', 'H4', 'H5', 'L1', 'L2', 'L3', 'L4', 'SC', 'PP']) {
    entries.push([`sym_${sym}`, `assets/symbols/${sym}.webp`]);
  }
  const texes = await Promise.all(
    entries.map(([alias, src]) => Assets.load({ alias, src })),
  );
  // Mipmaps: symbols/tiles are drawn far smaller than their source art (a ~512px
  // symbol shows at ~45px per tile on mobile). Without mipmaps that heavy
  // minification aliases/shimmers; trilinear-filtered mipmaps keep them crisp.
  for (const tex of texes) {
    const src = (tex as Texture | undefined)?.source;
    if (src) {
      src.autoGenerateMipmaps = true;
      src.scaleMode = 'linear';
      src.update();
    }
  }
}
