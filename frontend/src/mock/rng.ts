/** Deterministic seeded RNG (mulberry32) for mock book generation. */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  next(): number {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(maxExcl: number): number {
    return Math.floor(this.next() * maxExcl);
  }
  range(min: number, maxIncl: number): number {
    return min + this.int(maxIncl - min + 1);
  }
  pick<T>(arr: T[]): T {
    return arr[this.int(arr.length)];
  }
  /** Weighted pick from [value, weight] pairs. */
  weighted<T>(pairs: Array<[T, number]>): T {
    let total = 0;
    for (const [, w] of pairs) total += w;
    let r = this.next() * total;
    for (const [v, w] of pairs) {
      r -= w;
      if (r <= 0) return v;
    }
    return pairs[pairs.length - 1][0];
  }
  shuffle<T>(arr: T[]): T[] {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
}
