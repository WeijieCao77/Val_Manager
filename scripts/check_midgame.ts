/**
 * The 2030 settlement, the rotating pool, the account unlock and the map MVP —
 * everything this batch changed, asked of the engine directly.
 */
import { createNewGame, WORLD_TEAMS } from '../src/engine/world'
import { createManager } from '../src/engine/manager'
import {
  advanceDay, continuePastFive, SEASON_DAYS, settleAtFive, setupSeason,
} from '../src/engine/season'
import { activePool, mapMvp, poolFor, poolPhaseOf } from '../src/engine/match'
import { earnedNow } from '../src/engine/achievements'
import { FINAL_YEAR, MID_YEAR } from '../src/engine/endings'
import { emptyProfile, freeTeamChoice } from '../src/engine/profile'
import type { GameState, MapLine } from '../src/engine/types'

const fail = (msg: string): never => { throw new Error(msg) }

// ------------------------------------------------------- five-year settlement
const me = WORLD_TEAMS.find((t) => t.tag === 'EDG')!
const m = createManager('测试', 40, 'expro')
const g = createNewGame(me.id, m.name, 7, m)
setupSeason(g)

// jump the clock to the last day of 2030 and let the season settle
g.year = MID_YEAR
g.day = SEASON_DAYS - 1
advanceDay(g)
if (!g.midReview) fail('2030 赛季结束应弹出五年之约')
if (g.gameOver) fail('五年之约不该直接结束生涯')

// the clock must hold while the question is up
const held = { day: g.day, year: g.year }
advanceDay(g)
if (g.day !== held.day || g.year !== held.year) fail('五年之约期间时间不应流动')
console.log('✅ 五年之约弹出，时间挂起')

// branch A: settle — graded, finished, but NOT the ten-year badge
const settled = structuredClone(g) as GameState
settleAtFive(settled)
if (!settled.finished || !settled.gameOver) fail('收官应记为 finished + gameOver')
if (settled.gameOver && !settled.gameOver.includes('功成身退')) fail('收官文案不对')
if (earnedNow(settled).includes('tenYears')) fail('五年收官不该拿「走完十年」')
console.log('✅ 收官：有结局、无「走完十年」——', settled.gameOver)

// branch B: continue — the off-season runs and 2031 begins
continuePastFive(g)
advanceDay(g)
if (g.midReview) fail('继续之后不该再问一次')
if (g.year !== MID_YEAR + 1) fail(`继续之后应进入 ${MID_YEAR + 1}，实际 ${g.year}`)
console.log(`✅ 继续：滚入 ${g.year} 赛季`)

// and the very end is still the very end, with its own badge
g.year = FINAL_YEAR
g.day = SEASON_DAYS - 1
advanceDay(g)
if (!g.finished || !g.gameOver) fail('2036 打完应结束生涯')
if (!earnedNow(g).includes('tenYears')) fail('走满十年应有「走完十年」')
console.log('✅ 2036 大结局照旧，且解锁「走完十年」')

// ------------------------------------------------------------- pool rotation
for (const seed of [1, 42, 777]) {
  const pools = [0, 1, 2].map((ph) => activePool(seed, ph as 0 | 1 | 2))
  for (const p of pools) {
    if (p.length !== 7) fail(`图池应为 7 张，实际 ${p.length}`)
    if (new Set(p).size !== 7) fail('图池出现重复地图')
  }
  for (let ph = 1; ph <= 2; ph++) {
    const gone = pools[ph - 1].filter((x) => !pools[ph].includes(x))
    if (gone.length < 1 || gone.length > 2) {
      fail(`每次轮换应换 1–2 张，seed ${seed} 第 ${ph} 段换了 ${gone.length}`)
    }
  }
  const again = activePool(seed, 2)
  if (again.join() !== pools[2].join()) fail('同一 (seed, phase) 两次结果不同')
}
if (poolPhaseOf('kickoff') !== 0 || poolPhaseOf('stage1') !== 1 || poolPhaseOf('champions') !== 2) {
  fail('poolPhaseOf 的赛段映射不对')
}
const p0 = poolFor({ seed: g.seed, year: g.year, stage: 'kickoff' })
const p2 = poolFor({ seed: g.seed, year: g.year, stage: 'stage2' })
console.log(`✅ 图池轮换：Kickoff [${p0.join(' ')}]`)
console.log(`            Stage 2 [${p2.join(' ')}]`)

// --------------------------------------------------------- account unlock
const fresh = createNewGame(me.id, m.name, 7, createManager('测试', 40, 'expro'))
fresh.honours = [2027, 2028, 2029].map((year) => ({ year, title: 'VALORANT Champions' }))
if (!earnedNow(fresh).includes('threepeat')) fail('连续三年冠军赛应解锁「三连霸」')
fresh.honours = [2026, 2028, 2029].map((year) => ({ year, title: 'VALORANT Champions' }))
if (earnedNow(fresh).includes('threepeat')) fail('不连续的三冠不该算三连霸')
fresh.manager!.reputation = 90
if (!earnedNow(fresh).includes('rep90')) fail('声望 90 应解锁「名满天下」')

const none = emptyProfile('t')
if (freeTeamChoice(none)) fail('白板账号不该解锁任选球队')
if (!freeTeamChoice({ ...none, achievements: ['threepeat'] })) fail('三连霸应解锁任选')
if (!freeTeamChoice({ ...none, achievements: ['rep90'] })) fail('声望 90 应解锁任选')
if (!freeTeamChoice({ ...none, record: { ...none.record, finished: 1 } })) fail('走完十年应解锁任选')
console.log('✅ 三连霸／声望90／十年完赛 → 任选球队')

// ------------------------------------------------------------- map MVP
const line = (acs: number): MapLine => ({
  kills: 0, deaths: 0, assists: 0, damage: 0,
  firstKills: 0, firstDeaths: 0, clutches: 0, rounds: 20, acs,
})
// the screenshot: the loser's star (291 ACS) out-scored the winner's series
// MVP (206 ACS) on this one map — the map sheet must crown the 291
const score = {
  map: 'Fracture', scoreA: 13, scoreB: 8,
  lines: { lysoar: line(291), noman: line(206), tec1: line(251) },
}
const best = mapMvp(score, { a: ['tec1'], b: ['lysoar', 'noman'] })
if (best !== 'lysoar') fail(`本图最佳应是 lysoar（291），实际 ${best}`)
// the winner's +18 breaks near-ties toward the side that took the map, and a
// gap wider than the bonus still goes to the raw numbers
const close = { ...score, lines: { a1: line(200), b1: line(230) } }
if (mapMvp(close, { a: ['a1'], b: ['b1'] }) !== 'b1') fail('大幅领先的 ACS 应压过胜方加成')
if (mapMvp({ ...close, lines: { a1: line(200), b1: line(210) } }, { a: ['a1'], b: ['b1'] }) !== 'a1') {
  fail('小分差下胜方加成应生效')
}
console.log('✅ 本图最佳与整场 MVP 分开评')

console.log('\n全部通过')
