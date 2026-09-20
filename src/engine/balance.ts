/**
 * The card mode's score curve, and which version of it a match is played on.
 *
 * No imports on purpose: gacha.ts stamps the version on a bracket and must not
 * pull the match engine (and the world) into every screen that reads a save.
 */

/**
 * Which score-to-strength curve a card match is played on.
 *
 * A tournament that has started keeps the version it started on — the club
 * cup carries it in `cup.balance`, a 全服杯 in `open_cups.balance_version` —
 * and a record with no version is version 1, the curve before 2026-09-18.
 */
export const BALANCE_VERSION = 3

interface Knee { s0: number; s1: number; k: number; w: number }
const V2: Knee = { s0: 0.36, s1: 1.48, k: 2.9, w: 0.5 }
const V3: Knee = { s0: 0.82, s1: 2.08, k: 4.5, w: 1.0 }
const softplus = (x: number): number => (x > 30 ? x : Math.log1p(Math.exp(x)))
/** slope s0 near zero, s1 far out, the turn centred on k and about 4w points wide; E(0) = 0 */
const knee = ({ s0, s1, k, w }: Knee) => (d: number): number =>
  s0 * d + (s1 - s0) * w * (softplus((d - k) / w) - softplus(-k / w))

/**
 * E(d): the round-strength gap two fives `d` unrounded 阵容分 apart play at.
 * Continuous, non-decreasing, E(0) = 0, one curve for BO3 and BO5 alike.
 *
 * 1 — 0.35d + 0.65·max(d − 3, 0). The first three points were squeezed hard:
 *     +3 won 53% of BO5s, +10 still lost one in seven.
 * 2 — calibrated on the BO5 (the ladder and the 全服杯 playoff), the owner's
 *     targets of 2026-09-18: +2 ≈ 54.5%, +3 ≈ 58%, +5 ≈ 71%, +10 ≈ 93%.
 *     A softened knee: slope 0.36 near zero (v1 began at 0.35), 1.48 far out,
 *     the turn centred on 2.9 and about two points wide —
 *       E(d) = 0.36d + 1.12 · 0.5 · [softplus((d − 2.9)/0.5) − softplus(−5.8)]
 *     Its slope is always between 0.36 and 1.48, so it is strictly increasing,
 *     has no step anywhere and cannot overshoot. Measured on the real engine:
 *     the round strength is the only thing the curve moves, so P(win | E) was
 *     read once (152,000 series a format), E(d) fitted to it, and the fit
 *     confirmed on seeds and fives the fit never saw, 20,000 BO5 a target.
 *     analysis/balance_v2/ has the tables; scripts/balance/ reruns them.
 * 3 — 2026-09-20. Six live 全服杯 (3,120 series) played v2 exactly as measured,
 *     and that was the complaint: a BO3 side a point or two up won 51–52%, five
 *     up 67%, and a third of all series with a gap went to the lower score. The
 *     owner's targets, this time on the BO3 (the Swiss rounds, most of what is
 *     played): +1 ≈ 54.5%, +2 ≈ 57.5%, +3 ≈ 60%, and steeper the wider it gets —
 *     +5 ≈ 72%, +8 ≈ 87%, +10 ≈ 94%. Same family, fitted on the same probe
 *     table: slope 0.82 from the first point, 2.08 far out, the turn at 4.5 and
 *     four points wide. Confirmed on fives and seeds the fit never saw, 6,000
 *     series a cell — BO3 53.6 / 57.3 / 60.4 / 70.9 / 87.3 / 93.3, and a BO5 a
 *     little above it from two points on (59.6 / 63.7 / 75.2 / 92.9 / 97.3).
 *     analysis/balance_v3/ has the tables; ui/cards/GapOdds.tsx prints them.
 *
 * Scripts may register further keys to measure a candidate; the game reads
 * only the versions named here.
 */
export const GAP_CURVES: Record<number, (d: number) => number> = {
  1: (d) => 0.35 * d + 0.65 * Math.max(0, d - 3),
  2: knee(V2),
  3: knee(V3),
}

/** Both sides' round strength: the pair's mean is kept, the gap is E(d), split evenly. */
export function cardStrengths(scoreA: number, scoreB: number, version: number = BALANCE_VERSION): [number, number] {
  const gap = scoreA - scoreB
  if (version === 1) {
    // the arithmetic of the day, term for term, so an old cup replays bit for bit
    const extra = Math.sign(gap) * 0.65 * Math.max(0, Math.abs(gap) - 3)
    return [80 + (scoreA - 80) * 0.35 + extra / 2, 80 + (scoreB - 80) * 0.35 - extra / 2]
  }
  const curve = GAP_CURVES[version]
  if (!curve) throw new Error(`没有这个数值版本：${version}`)
  const center = 80 + ((scoreA + scoreB) / 2 - 80) * 0.35
  const half = Math.sign(gap) * curve(Math.abs(gap)) / 2
  return [center + half, center - half]
}
