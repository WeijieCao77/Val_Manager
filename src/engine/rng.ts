/** Deterministic xorshift32 — every sim is reproducible from the save's seed. */
export class Rng {
  private s: number

  constructor(seed: number) {
    this.s = (seed >>> 0) || 0x9e3779b9
  }

  get state() {
    return this.s
  }

  next(): number {
    let x = this.s
    x ^= x << 13
    x >>>= 0
    x ^= x >>> 17
    x ^= x << 5
    x >>>= 0
    this.s = x
    return x / 0x100000000
  }

  range(a: number, b: number): number {
    return a + (b - a) * this.next()
  }

  int(a: number, b: number): number {
    return Math.floor(this.range(a, b + 1 - 1e-9))
  }

  chance(p: number): boolean {
    return this.next() < p
  }

  pick<T>(xs: readonly T[]): T {
    return xs[this.int(0, xs.length - 1)]
  }

  shuffle<T>(xs: T[]): T[] {
    const out = xs.slice()
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(0, i)
      ;[out[i], out[j]] = [out[j], out[i]]
    }
    return out
  }

  /** Box–Muller normal. */
  norm(mean: number, sd: number): number {
    const u1 = Math.max(this.next(), 1e-9)
    const u2 = this.next()
    return mean + sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  }

  /** Weighted pick. weights must be non-negative and not all zero. */
  weighted<T>(xs: readonly T[], weights: readonly number[]): T {
    let total = 0
    for (const w of weights) total += Math.max(0, w)
    if (total <= 0) return this.pick(xs)
    let r = this.next() * total
    for (let i = 0; i < xs.length; i++) {
      r -= Math.max(0, weights[i])
      if (r <= 0) return xs[i]
    }
    return xs[xs.length - 1]
  }
}

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

export function hashStr(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
