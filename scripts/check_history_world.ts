/**
 * A career that starts in a past season starts from real history and then
 * runs on its own.
 *
 *   npx tsx scripts/check_history_world.ts
 *
 * 2026-09-14. world_2024.json and world_2025.json are built by
 * scripts/build_world_year.py from the event-stats cache: every player on a
 * roster is a line in that year's opening event, ids follow the 2026 world
 * where the person is known, the rest are H<n>. A save opened on one runs
 * the classic rulebook from that January: the real host cities, only the
 * agents that existed, 五年之约 five seasons in, and a full season through
 * advanceDay must reach the next year without a fault.
 */
const mem: Record<string, string> = {}
;(globalThis as never as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => mem[k] ?? null,
  setItem: (k: string, v: string) => { mem[k] = v },
  removeItem: (k: string) => { delete mem[k] },
  key: (i: number) => Object.keys(mem)[i] ?? null,
  get length() { return Object.keys(mem).length },
}
import { readFileSync } from 'node:fs'
import { createNewGame } from '../src/engine/world'
import { WORLD_TEAMS } from '../src/engine/teams'
import { advanceDay, finishDraw, setupSeason, continuePastFive, dateLabel } from '../src/engine/season'
import { exportSave, importSave } from '../src/engine/save'
import { createManager } from '../src/engine/manager'
import { hostCities } from '../src/engine/hosts'
import { AGENT_SINCE, agentAvailable, finalYearOf, midYearOf, seasonsOf } from '../src/engine/eras'
import type { RawWorld } from '../src/engine/eras'
import { sheetFor, poolFor, selectLineup } from '../src/engine/match'
import { REGIONS } from '../src/engine/types'
import type { GameState } from '../src/engine/types'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const world26 = JSON.parse(readFileSync('src/data/world.json', 'utf8')) as { players: { id: string; ign: string }[]; teams: { id: string; tag: string }[] }
const ignOf = new Map(world26.players.map((p) => [p.id, p.ign.toLowerCase()]))
const cache = JSON.parse(readFileSync('scripts/cache/vlr_event_stats.json', 'utf8')) as { events: Record<string, { year: number; dates?: string }>; stats: Record<string, { agents?: [string, number][] }[]> }

// ---- the agent release table never says an agent came later than the pros first played it
{
  const first: Record<string, number> = {}
  for (const [id, e] of Object.entries(cache.events)) {
    for (const r of cache.stats[id] ?? []) for (const [a, share] of r.agents ?? []) if (share >= 5) first[a] = Math.min(first[a] ?? 9999, e.year)
  }
  const late = Object.entries(AGENT_SINCE).filter(([a, [y]]) => (first[a.toLowerCase()] ?? 9999) < y)
  check('英雄上线年份不晚于职业赛场首次出现', late.length === 0, late.map(([a, [y]]) => `${a} ${y}>${first[a.toLowerCase()]}`).join(','))
}

for (const year of [2024, 2025]) {
  console.log(`=== ${year}`)
  const w = JSON.parse(readFileSync(`src/data/world_${year}.json`, 'utf8')) as RawWorld
  const t1 = w.teams.filter((t) => t.tier === 1)
  const perRegion = Object.fromEntries(REGIONS.map((r) => [r, t1.filter((t) => t.region === r).length]))
  check(`${year}: 四个赛区各 ${year === 2024 ? 11 : 12} 支一级队`, Object.values(perRegion).every((n) => n === (year === 2024 ? 11 : 12)), JSON.stringify(perRegion))
  const rosters = t1.map((t) => w.players.filter((p) => p.teamId === t.id))
  check(`${year}: 每支一级队 5～7 名真人`, rosters.every((r) => r.length >= 5 && r.length <= 7))
  check(`${year}: 每个人都有 vlr 数据（不是生成的）`, w.players.every((p) => p.vlr && typeof p.vlr.rounds === 'number' && p.vlr.rounds > 0 || p.id.startsWith('P')))
  const ids = w.players.map((p) => p.id)
  check(`${year}: id 不重复`, new Set(ids).size === ids.length)
  const mismatch = w.players.filter((p) => p.id.startsWith('P') && ignOf.has(p.id) && ignOf.get(p.id) !== p.ign.toLowerCase())
  check(`${year}: 沿用的 P-id 指向同一个人`, mismatch.length === 0, mismatch.slice(0, 3).map((p) => `${p.id}:${p.ign}`).join(','))
  check(`${year}: 新人用 H-id`, w.players.filter((p) => p.id.startsWith('H')).every((p) => ![...ignOf.values()].includes(p.ign.toLowerCase())))
  check(`${year}: 年龄合理`, w.players.every((p) => p.age >= 15 && p.age <= 40))
  const real = w.players.filter((p) => !p.ageEstimated).length
  check(`${year}: 大部分人有真实生日`, real / w.players.length > 0.7, `${real}/${w.players.length}`)
  const tids = w.teams.map((t) => t.id)
  check(`${year}: 俱乐部 id 不重复`, new Set(tids).size === tids.length)

  const m = createManager('审计', 30, 'expro')
  const club = t1.find((t) => t.tag === 'EDG') ?? t1[0]
  const g = createNewGame(club.id, '审计', 20260914, m, { world: w, year })
  setupSeason(g)
  g.boardConfidence = 100; g.onNotice = false; g.missedStreak = 0
  check(`${year}: 开档在 ${year} 年 1 月，记了起始年`, g.year === year && g.startYear === year && dateLabel(g).startsWith(`${year}年1月`))
  check(`${year}: 经典赛制`, g.rulesetId === 'vct-2025')
  check(`${year}: 五年之约在 ${year + 4}，十年到 ${year + 10}，第一季算第一季`, midYearOf(g) === year + 4 && finalYearOf(g) === year + 10 && seasonsOf(g) === 1)
  const hosts = hostCities(g.seed, g.year)
  check(`${year}: 主办城市是真实的`, JSON.stringify(hosts) === JSON.stringify(year === 2024 ? { masters1: '马德里', masters2: '上海', champions: '首尔' } : { masters1: '曼谷', masters2: '多伦多', champions: '巴黎' }), JSON.stringify(hosts))
  const missing = ['Tejo', 'Vyse', 'Waylay', 'Veto', 'Miks'].filter((a) => agentAvailable(g, a))
  check(`${year}: 还没上线的英雄不可用`, missing.length === (year === 2024 ? 0 : 2) , missing.join(','))
  // no team's opening plan fields an agent that does not exist yet
  let future = 0
  for (const t of Object.values(g.teams)) {
    const five = selectLineup(g, t.id)
    for (const map of poolFor(g).slice(0, 3)) {
      const sheet = sheetFor(g, t.id, map, five)
      for (const a of Object.values(sheet.agents)) if (!agentAvailable(g, a)) future++
    }
  }
  check(`${year}: 开档预案里没有未来的英雄`, future === 0, `${future} 处`)

  // a whole season
  const releases: string[] = []
  let guard = 0
  while (g.year === year && guard++ < 420) {
    const rep = advanceDay(g, { autoResolveDrawDecisions: true })
    for (const n of rep.notes ?? []) if (n.startsWith('🆕')) releases.push(n)
    if (g.midReview) continuePastFive(g)
    if (g.pendingDrawId) finishDraw(g, g.pendingDrawId)
  }
  check(`${year}: 一整季推进到 ${year + 1}`, g.year === year + 1, `${g.year} day ${g.day}`)
  if (year === 2024) check('2024: 三月有 Clove（暮蝶）上线的消息，八月有 Vyse（维斯）', releases.length === 2 && releases[0].includes('暮蝶') && releases[1].includes('维斯'), releases.join(' | '))
  // Tejo's January patch is the day the save opens, so it is simply there; Waylay (幻棱) lands in March and Veto (禁灭) in November
  if (year === 2025) check('2025: 三月 Waylay、十一月 Veto 上线，Tejo 开档就在', releases.length === 2 && releases[0].includes('幻棱') && releases[1].includes('禁灭'), releases.join(' | '))
  // setupSeason has already cleared the comps for the new year; the three
  // internationals leave their mark as three version rolls
  const names = (g.patchLog ?? []).map((p) => p.name)
  check(`${year}: 三站国际赛都办了（三次版本更替）`, names.length === 3 && names[2] === `${year} 休赛期大改`, names.join(' | '))
  const back = importSave(exportSave(g))
  check(`${year}: 存档来回后起始年还在`, back.startYear === year && back.year === year + 1)
  // the 2026 canonical-name pass leaves a historical club alone
  const ht = Object.values(back.teams).find((t) => t.id.startsWith('HT'))
  if (ht) check(`${year}: 2026 世界里没有的俱乐部读档后名字不变`, !!ht.name && ht.name === Object.values(g.teams).find((t) => t.id === ht.id)!.name)
  const known = Object.values(back.teams).find((t) => WORLD_TEAMS.some((x) => x.id === t.id))
  if (known) check(`${year}: 沿用 T-id 的俱乐部读档后按 2026 名字显示（同一家）`, !!known.name)
}

// the default start is untouched
{
  const g = createNewGame(WORLD_TEAMS[0].id, '审计', 1, createManager('审计', 30, 'expro'))
  check('默认开档还是 2026，不记起始年，抽签赛制', g.year === 2026 && g.startYear === undefined && midYearOf(g) === 2030 && finalYearOf(g) === 2036)
}

console.log(bad ? `\n${bad} 处不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
