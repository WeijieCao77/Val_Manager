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
import { newGacha, enterCup, STAMINA_MAX } from '../src/engine/gacha'
import { WORLD_TEAMS } from '../src/engine/teams'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const ratingOf = new Map(WORLD_TEAMS.map((t) => [t.id, t.rating]))
const lowest = Math.min(...WORLD_TEAMS.map((t) => t.rating))
const highest = Math.max(...WORLD_TEAMS.map((t) => t.rating))
// A squad below every club plays the weakest clubs, and the draw takes the
// six nearest AFTER the ones already in the bracket are set aside, so a
// five-round bracket can reach the tenth-weakest club. How far that is
// depends on how bunched the bottom of the table is — 66 today, 65 before
// the 2026-09-03 rebuild — so the window is read off the table, not fixed.
const ladder = WORLD_TEAMS.map((t) => t.rating).sort((a, b) => a - b)
const floorBand = ladder[Math.min(9, ladder.length - 1)]
const ceilingBand = ladder[Math.max(0, ladder.length - 10)]

const g = newGacha('VM-CUPP-CUPP-CUPP-CUPP-CUPP', '杯赛签表', '2026-09-02')
const now = Date.parse('2026-09-02T12:00:00Z')
let drawn = 0
let notClimbing = 0, finalNotTop = 0, repeats = 0, farOff = 0
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
    // the climb is squad−8 … squad+8, clamped to the world's own range — a
    // squad below the weakest club plays the weakest clubs — and the six
    // nearest can sit a few points off the exact target
    const lo = Math.min(Math.min(Math.max(lowest, squad - 8), highest) - 6, ceilingBand)
    const hi = Math.max(Math.max(Math.min(highest, squad + 8), lowest) + 6, floorBand)
    if (rs.some((r) => r < lo || r > hi)) farOff++
    if (example.length < 4 && i === 0) example.push(`${squad}: ${rs.join(' → ')}`)
  }
}
check(`每一张签表对手一轮比一轮强（${drawn} 张）`, notClimbing === 0, `${notClimbing} 张不是`)
check('决赛永远是签表里最强的', finalNotTop === 0, `${finalNotTop} 张不是`)
check('一支队不会在同一张签表出现两次', repeats === 0, `${repeats} 张有`)
check('整张签表都在阵容分附近，不会抽到全世界最强', farOff === 0, `${farOff} 张跑远了`)
check('3～5 轮都抽得到', !!depths[3] && !!depths[4] && !!depths[5], JSON.stringify(depths))
console.log('  例：' + example.join(' | '))
console.log(bad ? `\n${bad} 处不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
