/**
 * 归属感, over a career.
 *
 *   npx tsx scripts/check_loyalty.ts [seasons]
 *
 * Loyalty did not move. The group found the hole before I did: a renewal
 * refused with 「对这支球队没有太深的归属感」 and no way to do anything about
 * it — 「忠诚度怎么刷呀😭」. Moving it on how well the manager treats a player
 * would have made it a second copy of trust, so it moves on club-shaped things
 * instead: years served, trophies lifted here, and whether the club has ever
 * tried to sell him.
 *
 * The line that has to hold is the one that keeps the two from collapsing into
 * each other, and it is checkable: nothing the MANAGER chooses may move
 * loyalty, and nothing about the CLUB's history may move trust. Everything
 * else here is calibration — a one-club man has to end up meaningfully more
 * loyal than a journeyman, and the whole league must not drift to the ceiling.
 */
import { createNewGame, autoStarters } from '../src/engine/world'
import { WORLD_TEAMS } from '../src/engine/teams'
import { squadOf } from '../src/engine/roster'
import { advanceDay, setupSeason } from '../src/engine/season'
import { LISTED_COST, LOYALTY_NEW, loyaltyOf, yearlyGain } from '../src/engine/loyalty'
import { trustOf } from '../src/engine/trust'
import type { GameState } from '../src/engine/types'

const store = new Map<string, string>()
;(globalThis as never as { localStorage: unknown }) = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
  key: () => null, clear: () => store.clear(), get length() { return store.size },
}
;(globalThis as never as { fetch: unknown }).fetch = undefined

let bad = 0
const check = (ok: boolean, what: string, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}

const SEASONS = Number(process.argv[2] ?? 4)
const me = WORLD_TEAMS.find((t) => t.tag === 'EDG')!
const g = createNewGame(me.id, '审计', 20260901)
setupSeason(g)

const stayer = squadOf(g, g.myTeam)[0]
const before = { loyalty: loyaltyOf(stayer), trust: trustOf(stayer) }
const worldBefore = Object.values(g.players).map((p) => loyaltyOf(p))

for (let s = 0; s < SEASONS; s++) {
  for (let d = 0; d < 336; d++) {
    g.boardConfidence = 85; g.onNotice = false; g.missedStreak = 0
    if (g.finances.balance < 5_000_000) g.finances.balance = 20_000_000
    advanceDay(g, { autoScrims: true })
    if (g.midReview) { g.midReview = false; g.midReviewDone = true }
  }
}

// ---- a man who stayed --------------------------------------------------
const stillHere = stayer.teamId === g.myTeam
console.log(`\n${SEASONS} 个赛季后：`)
if (stillHere) {
  console.log(`  ${stayer.ign}：忠诚 ${before.loyalty} → ${loyaltyOf(stayer)}`
    + `，信任 ${Math.round(before.trust)} → ${Math.round(trustOf(stayer))}`)
  check(loyaltyOf(stayer) > before.loyalty, '待满几个赛季的人，归属感是涨的',
    `${before.loyalty} → ${loyaltyOf(stayer)}`)
} else {
  console.log(`  ${stayer.ign} 中途离队了，跳过这一项`)
}

// ---- the league as a whole ---------------------------------------------
const now = Object.values(g.players).filter((p) => p.teamId).map((p) => loyaltyOf(p))
const avgBefore = worldBefore.reduce((a, b) => a + b, 0) / worldBefore.length
const avgNow = now.reduce((a, b) => a + b, 0) / now.length
const maxed = now.filter((v) => v >= 95).length
const floored = now.filter((v) => v <= 5).length
console.log(`  全联盟平均忠诚 ${avgBefore.toFixed(1)} → ${avgNow.toFixed(1)}`
  + `（95 以上 ${maxed} 人，5 以下 ${floored} 人，共 ${now.length} 人）`)
// A transfer resets a man to LOYALTY_NEW, so a league with a busy market runs
// slightly BELOW where it started and settles there — the equilibrium between
// churn and years served. What must not happen is a spiral: every transfer
// making the next one easier until nobody is attached to anywhere.
check(avgNow > LOYALTY_NEW + 10 && avgNow < 85,
  '联盟均值稳在一个合理区间，没有被转会拖垮', avgNow.toFixed(1))
check(maxed < now.length * 0.25, '没有涨到全联盟都顶格', `${maxed}/${now.length}`)
check(avgNow < 85, '平均值没有失控', avgNow.toFixed(1))

// a newly signed player is not instantly a club man
const fresh = Object.values(g.players).filter((p) => p.joinedYear === g.year && p.teamId)
if (fresh.length) {
  const avgFresh = fresh.reduce((s, p) => s + loyaltyOf(p), 0) / fresh.length
  console.log(`  今年刚换队的 ${fresh.length} 人，平均忠诚 ${avgFresh.toFixed(1)}`)
  check(avgFresh < avgNow, '刚换队的人归属感明显低于老人',
    `${avgFresh.toFixed(1)} vs ${avgNow.toFixed(1)}`)
  check(fresh.every((p) => loyaltyOf(p) <= LOYALTY_NEW + 20),
    '换队之后是重新开始，不会把上家的归属感带过来')
}

// ---- the curve ---------------------------------------------------------
console.log('\n每年涨多少：')
for (const v of [20, 38, 50, 62, 74, 90]) {
  console.log(`  忠诚 ${String(v).padStart(2)} → +${yearlyGain(v).toFixed(2)}/赛季`)
}
check(yearlyGain(20) > yearlyGain(74), '越高涨得越慢')
check(yearlyGain(90) > 0, '再高也不会倒扣')
let v = LOYALTY_NEW
const years: number[] = []
for (let i = 0; i < 6; i++) { v += yearlyGain(v); years.push(Math.round(v)) }
console.log(`  一个新签的人：${LOYALTY_NEW} → ${years.join(' → ')}`)
check(years[3] >= 55 && years[3] <= 70, '四个赛季之后大约到中位数附近', String(years[3]))
check(LISTED_COST > yearlyGain(LOYALTY_NEW) * 2,
  '挂一次牌，赔掉的不止一个赛季', `挂牌 −${LISTED_COST}，一季 +${yearlyGain(LOYALTY_NEW).toFixed(1)}`)

// ---- the two axes must not become one ----------------------------------
//
// This is the whole design, and it is a source check rather than a simulation:
// a rule in the wrong file is not visible in the numbers until much later.
const { readFileSync } = await import('node:fs')
// Comments are stripped first: both files explain in prose what does NOT
// belong in them, and matching that prose flags the very sentence that keeps
// the design honest.
const code = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
const loyaltySrc = code('../src/engine/loyalty.ts')
const trustSrc = code('../src/engine/trust.ts')
const MANAGER_THINGS = ['fatigue', 'starters', 'promisedRole', 'commercialDays', 'training']
const CLUB_THINGS = ['joinedYear', 'clubHist', 'titleLoyalty']
const leaked = MANAGER_THINGS.filter((k) => loyaltySrc.includes(k))
check(leaked.length === 0,
  '忠诚不看经理怎么对他——那是信任的事', leaked.join(' '))
const backwards = CLUB_THINGS.filter((k) => trustSrc.includes(k))
check(backwards.length === 0,
  '信任不看他在这儿待了多久——那是忠诚的事', backwards.join(' '))

// and the player-facing text must not tell people to farm something static
const panel = readFileSync(new URL('../src/ui/Rules.tsx', import.meta.url), 'utf8')
check(!panel.includes('这一项在整局游戏里不会变'),
  '机制说明里不再写「忠诚不会变」')

console.log(bad ? `\n${bad} 项不通过` : '\n全部通过')
process.exit(bad ? 1 : 0)
