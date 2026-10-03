/**
 * 暂停时的局中战绩: MapSim.liveLines is the map so far, and it adds up to what
 * the map's final lines say. Reported 2026-10-03: 「暂停时看不到选手的战绩，
 * 不知道以谁为核心比较好」.
 *
 *   npx tsx scripts/check_live_lines.ts
 */
import { createNewGame } from '../src/engine/world'
import { WORLD_TEAMS } from '../src/engine/teams'
import { MatchSim } from '../src/engine/match'
import { Rng } from '../src/engine/rng'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const id = (tag: string) => WORLD_TEAMS.find((t) => t.tag === tag)!.id
const g = createNewGame(id('EDG'), '审计', 5)
let maps = 0, sumBad = 0, endBad = 0, acsBad = 0, mutateBad = 0
for (let seed = 1; seed <= 6; seed++) {
  const sim = new MatchSim(g, id('EDG'), id('PRX'), 3, new Rng(seed))
  while (!sim.decided && sim.nextMap()) {
    const m = sim.current!
    for (let r = 0; r < 8; r++) m.playRound()
    const mid = m.liveLines()
    const k = Object.values(mid).reduce((a, l) => a + l.kills, 0)
    const d = Object.values(mid).reduce((a, l) => a + l.deaths, 0)
    if (k !== d || k === 0) sumBad++
    if (Object.values(mid).some((l) => l.rounds !== 8 || l.acs < 0 || l.acs > 600)) acsBad++
    // a look must not move the match: the copy is the caller's
    for (const l of Object.values(mid)) l.kills += 100
    const again = m.liveLines()
    if (Object.values(again).some((l) => l.kills >= 100)) mutateBad++
    m.runOut()
    const end = m.liveLines()
    const fin = m.result().score.lines
    for (const [pid, l] of Object.entries(fin)) {
      if (end[pid].kills !== l.kills || end[pid].deaths !== l.deaths || end[pid].acs !== l.acs) endBad++
    }
    sim.closeMap()
    maps++
  }
}
check(`${maps} 张图：八回合时双方击杀总数 = 死亡总数`, sumBad === 0, `${sumBad} 张不对`)
check('局中回合数、ACS 合理', acsBad === 0, `${acsBad}`)
check('看一眼不改比赛', mutateBad === 0)
check('打完时和整图战绩一致（击杀、死亡、ACS）', endBad === 0, `${endBad} 处不一致`)
console.log(bad ? `\n${bad} 项不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
