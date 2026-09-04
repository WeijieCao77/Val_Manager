/**
 * The things that must be true of a save every single day.
 *
 *   npx tsx scripts/check_invariants.ts [seasons]
 *
 * 「为什么四个人也能开比赛啊」 was one instance of a whole class: a repair job
 * running on a slower clock than the thing it repairs. ensureMinimumRosters
 * ran weekly, below the fixtures, so a club stripped on a Monday played until
 * Sunday three-handed. Reading the code for more of those is guesswork; this
 * asserts the invariants themselves, after EVERY advance, for a whole career.
 *
 * The rule for what belongs here: something that must hold at every moment the
 * game can be looked at or played from, not something that is only settled
 * periodically by design. Wages are paid weekly and that is correct. A club
 * having five players is not a weekly matter — a match can happen any day.
 *
 * When one of these fails it prints the day it first broke, which is the whole
 * value: a slow repair job shows up as a run of broken days ending at a
 * multiple of seven.
 */
import { createNewGame } from '../src/engine/world'
import { WORLD_TEAMS } from '../src/engine/teams'
import { advanceDay, setupSeason, SEASON_DAYS } from '../src/engine/season'
import { selectLineup } from '../src/engine/match'
import type { GameState } from '../src/engine/types'

const store = new Map<string, string>()
;(globalThis as never as { localStorage: unknown }) = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
  key: () => null, clear: () => store.clear(), get length() { return store.size },
}
;(globalThis as never as { fetch: unknown }).fetch = undefined

interface Broken { day: string; detail: string }
const breaks = new Map<string, Broken[]>()
const fail = (rule: string, day: string, detail: string) => {
  const list = breaks.get(rule) ?? breaks.set(rule, []).get(rule)!
  if (list.length < 5) list.push({ day, detail })
}

/**
 * Every invariant, checked against one state.
 *
 * The managed club is exempt from the roster rules on purpose — the manager
 * fills his own squad, and the engine doing it for him would be the engine
 * playing the game. Everything else applies to everybody.
 */
function audit(g: GameState, when: string): void {
  const day = `${g.year} 年第 ${g.day} 天`
  void when

  // ---- club and player point at each other, both ways
  const rostered = new Map<string, string>()
  for (const t of Object.values(g.teams)) {
    for (const pid of t.roster) {
      const p = g.players[pid]
      if (!p) { fail('名单里的人必须存在', day, `${t.tag} 的 ${pid} 查无此人`); continue }
      const already = rostered.get(pid)
      if (already) fail('一个人不能同时在两支队', day, `${p.ign} 同时在 ${already} 和 ${t.tag}`)
      rostered.set(pid, t.tag)
      if (p.teamId !== t.id) {
        fail('名单和选手的归属要对得上', day, `${p.ign} 在 ${t.tag} 的名单里，teamId 却是 ${p.teamId ?? '自由人'}`)
      }
    }
  }
  for (const p of Object.values(g.players)) {
    if (!p.teamId) continue
    const t = g.teams[p.teamId]
    if (!t) { fail('选手的队伍必须存在', day, `${p.ign} 属于不存在的 ${p.teamId}`); continue }
    if (!t.roster.includes(p.id)) {
      fail('选手说自己在队里，队里就得有他', day, `${p.ign} 的 teamId 是 ${t.tag}，但不在名单里`)
    }
  }

  // ---- a club that can be asked to play must be able to field five
  for (const t of Object.values(g.teams)) {
    if (t.id === g.myTeam) continue
    if (t.roster.length < 5) fail('AI 球队随时都能凑出五个人', day, `${t.tag} 只有 ${t.roster.length} 人`)
    else if (selectLineup(g, t.id).length < 5) {
      fail('AI 球队随时都能派出五个人', day, `${t.tag} 只排得出 ${selectLineup(g, t.id).length} 人`)
    }
    // one voice calls the game; without one the side eats a flat penalty
    if (t.roster.length >= 5 && !t.roster.some((id) => g.players[id]?.isIgl)) {
      fail('每支 AI 球队都有指挥', day, `${t.tag} 没有指挥`)
    }
    // starters are an intention, and must at least name people who are here
    for (const id of t.starters) {
      if (!t.roster.includes(id)) fail('首发必须是本队的人', day, `${t.tag} 的首发里有外人 ${id}`)
    }
    if (new Set(t.starters).size !== t.starters.length) {
      fail('首发里不能有重复的人', day, `${t.tag}`)
    }
  }

  // ---- the schedule points at clubs that exist
  for (const f of g.fixtures) {
    if (!g.teams[f.teamA] || !g.teams[f.teamB]) {
      fail('赛程里的球队必须存在', day, `${f.id} ${f.teamA} vs ${f.teamB}`)
    }
    if (f.teamA === f.teamB) fail('球队不会和自己打', day, f.id)
  }

  // ---- numbers stay numbers
  if (!Number.isFinite(g.finances.balance)) fail('资金是个数', day, String(g.finances.balance))
  for (const t of Object.values(g.teams)) {
    if (!Number.isFinite(t.budget)) fail('俱乐部预算是个数', day, `${t.tag} ${t.budget}`)
    if (!Number.isFinite(t.rating)) fail('球队评分是个数', day, `${t.tag} ${t.rating}`)
  }
  for (const p of Object.values(g.players)) {
    if (!Number.isFinite(p.overall) || p.overall < 1 || p.overall > 99) {
      fail('能力值在 1~99 之间', day, `${p.ign} ${p.overall}`)
    }
    if (p.overall > p.potential) {
      fail('能力值不会超过潜力', day, `${p.ign} 能力 ${p.overall} > 潜力 ${p.potential}`)
    }
    if (!Number.isFinite(p.salary) || p.salary < 0) fail('薪资是个非负数', day, `${p.ign} ${p.salary}`)
  }

  // ---- my own club: the engine leaves the roster alone, but never corrupts it
  const mine = g.teams[g.myTeam]
  if (mine) {
    for (const id of mine.starters) {
      if (!mine.roster.includes(id)) fail('我的首发也得是我的人', day, id)
    }
  }
}

const seasons = Number(process.argv[2] ?? 1)
const me = WORLD_TEAMS.find((t) => t.tag === 'EDG')!
const g = createNewGame(me.id, '审计', 20260831)
setupSeason(g)
audit(g, '开局')

/**
 * A career that also does the things a manager does.
 *
 * The lineup bug could not be reproduced by simulation alone: the AI's own
 * transfers run in the same weekly block as the repair, above it, so nothing
 * was ever left broken across a day boundary. It takes somebody signing and
 * releasing players at arbitrary moments — which is what a person does — so
 * this does that on a fixed schedule, mid-week on purpose.
 */
let signings = 0
for (let s = 0; s < seasons; s++) {
  for (let d = 0; d < SEASON_DAYS; d++) {
    g.boardConfidence = 85; g.onNotice = false; g.missedStreak = 0
    if (g.finances.balance < 5_000_000) g.finances.balance = 20_000_000

    // every eleventh day, take two players off some other club — the exact
    // thing a manager does and the exact thing that broke the lineups
    if (d % 11 === 5) {
      const victim = Object.values(g.teams)
        .filter((t) => t.id !== g.myTeam && t.roster.length >= 5)
        .sort((a, b) => b.rating - a.rating)[(d / 11) | 0 % 6]
      if (victim) {
        for (const pid of victim.roster.slice(0, 2)) {
          const p = g.players[pid]
          p.teamId = null
          victim.roster = victim.roster.filter((x) => x !== pid)
          victim.starters = victim.starters.filter((x) => x !== pid)
          signings++
        }
      }
    }

    advanceDay(g, { autoScrims: true })
    if (g.midReview) { g.midReview = false; g.midReviewDone = true }
    audit(g, 'daily')
  }
}

console.log(`跑完 ${seasons} 个赛季，期间从别的俱乐部挖走 ${signings} 人（每 11 天一次，故意挑在周中）\n`)
const rules = [...breaks.entries()]
if (!rules.length) {
  console.log('全部通过 — 每一天的不变量都成立')
  process.exit(0)
}
for (const [rule, list] of rules) {
  console.log(`FAIL ${rule}`)
  for (const b of list) console.log(`       ${b.day}  ${b.detail}`)
}
console.log(`\n${rules.length} 条不变量被破坏`)
process.exit(1)
