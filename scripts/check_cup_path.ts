/**
 * The cup bracket climbs.
 *
 *   npx tsx scripts/check_cup_path.ts
 *
 * A squad in the sixties once drew LOUD in the quarters, Heretics in the
 * semi and a 66 in the final: the draw took clubs "within five points" of a
 * target, and when nobody was, any club at all. Whatever the squad, the
 * opponents must now get stronger round by round, the final must be the
 * strongest of them, nobody appears twice, and the whole bracket sits near
 * the squad rather than at the top of the world.
 */
import { newGacha, enterCup, STAMINA_MAX, CUP_CLIMB_FROM, CUP_CLIMB_TO, CUP_EASE_MAX, CUP_SHARPEN_MAX, cupFloor } from '../src/engine/gacha'
import { CUP_TEAMS } from '../src/engine/cupTeams'
import { Rng, hashStr } from '../src/engine/rng'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const ratingOf = new Map(CUP_TEAMS.map((t) => [t.id, t.rating]))
const lowest = Math.min(...CUP_TEAMS.map((t) => t.rating))
const highest = Math.max(...CUP_TEAMS.map((t) => t.rating))
// A squad below every club plays the weakest clubs, and the draw takes the
// six nearest AFTER the ones already in the bracket are set aside, so a
// five-round bracket can reach the tenth-weakest club. How far that is
// depends on how bunched the bottom of the table is — 66 today, 65 before
// the 2026-09-03 rebuild — so the window is read off the table, not fixed.
const ladder = CUP_TEAMS.map((t) => t.rating).sort((a, b) => a - b)
const floorBand = ladder[Math.min(9, ladder.length - 1)]
const ceilingBand = ladder[Math.max(0, ladder.length - 10)]

const g = newGacha('VM-CUPP-CUPP-CUPP-CUPP-CUPP', '杯赛签表', '2026-09-02')
const now = Date.parse('2026-09-02T12:00:00Z')
let drawn = 0
let notClimbing = 0, finalNotTop = 0, repeats = 0, farOff = 0, badEase = 0
const depths: Record<number, number> = {}
const example: string[] = []
for (let squad = 40; squad <= 96; squad += 4) {
  for (let i = 0; i < 40; i++) {
    g.cup = null
    g.daily.stamina = STAMINA_MAX
    g.daily.staminaAt = now
    const cup = enterCup(g, squad, now)
    drawn++
    const rs = cup.path.map((id) => ratingOf.get(id) ?? 0)
    depths[rs.length] = (depths[rs.length] ?? 0) + 1
    if (rs.some((r, k) => k > 0 && r < rs[k - 1])) notClimbing++
    if (rs[rs.length - 1] !== Math.max(...rs)) finalNotTop++
    if (new Set(cup.path).size !== cup.path.length) repeats++
    // the climb is squad−9 … squad+3 in points as the bracket PRINTS them
    // (the club's paper less the bracket's ease), clamped to the cup pool's
    // range, and the six nearest can sit a few points off the exact target
    const ease = cup.ease ?? 0
    if (ease > CUP_EASE_MAX || ease < -CUP_SHARPEN_MAX) badEase++
    if (squad >= cupFloor() + CUP_CLIMB_FROM && squad + CUP_CLIMB_TO <= highest && ease !== 0) badEase++
    const lo = Math.min(Math.min(Math.max(lowest, squad - CUP_CLIMB_FROM + ease), highest) - 6, ceilingBand)
    const hi = Math.max(Math.max(Math.min(highest, squad + CUP_CLIMB_TO + ease), lowest) + 6, floorBand)
    if (rs.some((r) => r < lo || r > hi)) farOff++
    if (example.length < 4 && i === 0) example.push(`${squad}: ${rs.join(' → ')}`)
  }
}
check(`每一张签表对手一轮比一轮强（${drawn} 张）`, notClimbing === 0, `${notClimbing} 张不是`)
check('决赛永远是签表里最强的', finalNotTop === 0, `${finalNotTop} 张不是`)
check('一支队不会在同一张签表出现两次', repeats === 0, `${repeats} 张有`)
check('整张签表都在阵容分附近，不会抽到全世界最强', farOff === 0, `${farOff} 张跑远了`)
check('让分只给抽不到更弱对手的阵容，加强只给超过最强俱乐部的阵容，都有上限', badEase === 0, `${badEase} 张不对`)
check('3～5 轮都抽得到', !!depths[3] && !!depths[4] && !!depths[5], JSON.stringify(depths))
console.log('  例：' + example.join(' | '))

// Historical draw oracle: compare the same RNG stream against the old curve,
// including depth odds and the six-nearest, without-replacement selection.
function previousDraw(seed: number, score: number) {
  const rng = new Rng(seed)
  rng.next()
  const dice = rng.next()
  const rounds = dice < .35 ? 3 : dice < .75 ? 4 : 5
  const sorted = CUP_TEAMS.slice().sort((a, b) => a.rating - b.rating)
  const path: string[] = []
  for (let i = 0; i < rounds; i++) {
    const target = score - 8 + 16 * i / (rounds - 1)
    const near = sorted.filter(t => !path.includes(t.id))
      .sort((a, b) => Math.abs(a.rating - target) - Math.abs(b.rating - target)).slice(0, 6)
    path.push(rng.pick(near).id)
  }
  return path.sort((a, b) => ratingOf.get(a)! - ratingOf.get(b)!)
}
let sameDepth = true, delta = 0, compared = 0
for (const score of [65, 73, 80]) {
  for (let i = 0; i < 200; i++) {
    const seed = hashStr(`cup-easing-draw:${score}:${i}`)
    const old = previousDraw(seed, score)
    g.cup = null; g.seed = seed; g.daily.stamina = STAMINA_MAX
    const current = enterCup(g, score, now)
    sameDepth &&= current.path.length === old.length
    // compared in the points the bracket prints: a low five's clubs come with an ease
    delta += old.reduce((s, id) => s + ratingOf.get(id)!, 0) / old.length
      - current.path.reduce((s, id) => s + ratingOf.get(id)! - (current.ease ?? 0), 0) / current.path.length
    compared++
  }
}
check('同一种子保留原来的杯赛轮数', sameDepth)
check('统一综合分后降低抽签目标，避免沿用旧区间把难度推高', delta / compared > 1.5 && delta / compared < 8, `相对旧区间平均降低 ${(delta / compared).toFixed(2)} 分`)
// An already paid-for old bracket must not be re-drawn or charged again.
g.cup = { path: previousDraw(12345, 73), round: 0, legs: [], done: false, won: false, entry: 0 }
const oldState = JSON.stringify(g)
enterCup(g, 107, now)
check('旧杯赛重复报名保留签表、种子和体力', JSON.stringify(g) === oldState)
console.log(bad ? `\n${bad} 处不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
