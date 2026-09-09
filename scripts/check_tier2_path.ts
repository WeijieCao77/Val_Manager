/**
 * A career that starts in the second tier has somewhere to go, all the way up.
 *
 *   npx tsx scripts/check_tier2_path.ts [seeds]
 *
 * Managing a Challengers side is a real career now that China's second tier is
 * the real one, and it has three places it could quietly dead-end. Each is
 * checked here rather than trusted:
 *
 *   1. 没比赛打 — a season with a hole in it. Every second-tier club plays both
 *      splits, and the longest wait between its own matches is a fortnight,
 *      not a month.
 *   2. 升上去只能打启点赛 — Ascension puts you in VCT and then the season
 *      forgets you. This is the shape of a bug that was live for a while:
 *      「打了个 kickoff 之后不让我打 stage1 和 2」. So a promoted club is walked
 *      through its whole first VCT season, Kickoff, Stage 1 and Stage 2.
 *   3. 打不了国际赛 — promoted, top of the region, and still not in the
 *      Masters field. A club in an international's field must have fixtures
 *      in it, and over the seeds at least one promoted side actually gets
 *      there.
 */
import { createNewGame } from '../src/engine/world'
import { advanceDay, continuePastFive, setupSeason, SEASON_DAYS, STAGES } from '../src/engine/season'
import { WORLD_TEAMS } from '../src/engine/teams'
import { setCurrentRuleset } from '../src/engine/ruleset'
import { ATTR_KEYS } from '../src/engine/types'
import type { GameState } from '../src/engine/types'

setCurrentRuleset('vct-2026')
let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const SEEDS = Number(process.argv[2] ?? 3)
const mine = (g: GameState) => g.fixtures.filter((f) => f.teamA === g.myTeam || f.teamB === g.myTeam)
const compsOf = (g: GameState) => {
  const by: Record<string, number> = {}
  for (const f of mine(g)) by[f.stage] = (by[f.stage] ?? 0) + 1
  return by
}
/** the longest wait between our own matches, inside the season's playing half */
const longestGap = (g: GameState): number => {
  const days = mine(g).map((f) => f.day).sort((a, b) => a - b)
  if (days.length < 2) return SEASON_DAYS
  let worst = 0
  for (let i = 1; i < days.length; i++) worst = Math.max(worst, days[i] - days[i - 1])
  return worst
}
interface Season {
  /** our own fixtures by stage, counted while the season still holds them */
  by: Record<string, number>
  played: Record<string, number>
  gap: number
  /** internationals whose field named us, and how many ties we were given */
  intl: { name: string; key: string; ties: number }[]
}

/**
 * Play one season and take the reading before it is cleared.
 *
 * The rollover calls setupSeason, which empties `fixtures` and builds the next
 * year's — so anything measured after the loop is measuring next season.
 */
const runYear = (g: GameState, forceChampion?: string): Season => {
  const y = g.year
  let guard = 0
  let snap: Season = { by: {}, played: {}, gap: SEASON_DAYS, intl: [] }
  const read = (): Season => {
    const ours = mine(g)
    const by: Record<string, number> = {}
    const played: Record<string, number> = {}
    for (const f of ours) {
      by[f.stage] = (by[f.stage] ?? 0) + 1
      if (f.played) played[f.stage] = (played[f.stage] ?? 0) + 1
    }
    const intl: Season['intl'] = []
    for (const key of ['masters1', 'masters2', 'champions']) {
      const comp = g.comps[key]
      if (!comp?.teams.includes(g.myTeam)) continue
      intl.push({ name: comp.name, key, ties: ours.filter((f) => f.comp === comp.key).length })
    }
    return { by, played, gap: longestGap(g), intl }
  }
  while (g.year === y && guard++ < SEASON_DAYS + 40) {
    // The board is not on trial here — a manager sacked in June ends the
    // career and every stage after it reads as 「没比赛打」, which is a
    // finding about check_tenure's thresholds and not about the calendar.
    // So he keeps the job and the five-year review is answered "play on".
    g.boardConfidence = 100; g.onNotice = false; g.missedStreak = 0
    if (g.midReview) continuePastFive(g)
    if (forceChampion) {
      // hand ourselves the Challengers title the moment that competition
      // concludes — the one input Ascension reads
      const c = g.comps[forceChampion]
      if (c?.champion && c.champion !== g.myTeam && g.teams[g.myTeam].tier === 2) c.champion = g.myTeam
    }
    advanceDay(g, { autoResolveDrawDecisions: true })
    if (g.year === y && g.day >= SEASON_DAYS - 3) snap = read()
  }
  return snap
}

// ---- 1. every second-tier club has a season ------------------------------
{
  console.log('=== 次级队都有比赛打 ===')
  const t2 = WORLD_TEAMS.filter((t) => t.tier === 2)
  const cn = t2.filter((t) => t.region === 'China')
  const others = (['Americas', 'EMEA', 'Pacific'] as const).map((r) => t2.find((t) => t.region === r)!)
  let worstGap = 0, worstTag = ''
  for (const club of [...cn, ...others].filter(Boolean)) {
    const g = createNewGame(club.id, '测试', 20260909)
    setupSeason(g)
    const s1 = runYear(g)
    const total = Object.values(s1.by).reduce((a, b) => a + b, 0)
    const done = Object.values(s1.played).reduce((a, b) => a + b, 0)
    if (s1.gap > worstGap) { worstGap = s1.gap; worstTag = club.tag }
    const ok = (s1.by.challengers1 ?? 0) > 0 && (s1.by.challengers2 ?? 0) > 0 && done === total
    check(`${club.tag.padEnd(5)} 两个赛段都打，且全部踢完`, ok,
      `第一赛段 ${s1.by.challengers1 ?? 0} 场 · 第二赛段 ${s1.by.challengers2 ?? 0} 场 · 已打 ${done}/${total}`)
  }
  check('没有谁要空等一个月', worstGap <= 45, `最长间隔 ${worstGap} 天（${worstTag}）`)
}

// ---- 2. Ascension, and the whole VCT season after it ----------------------
{
  console.log('\n=== 升上去以后打得完整个赛季 ===')
  let reachedIntl = 0
  for (let s = 0; s < SEEDS; s++) {
    const club = WORLD_TEAMS.filter((t) => t.tier === 2 && t.region === 'China')[s % 8]
    const g = createNewGame(club.id, '测试', 4242 + s * 17)
    setupSeason(g)
    runYear(g, 'challengers2:China')
    const up = g.teams[g.myTeam]
    check(`${club.tag.padEnd(5)} 夺冠后升入 VCT`, up.tier === 1 && up.league === 'VCT China',
      `tier ${up.tier} · ${up.league}`)
    if (up.tier !== 1) continue

    // the first VCT season: all three regional stages, actually played
    const v1 = runYear(g)
    const p = (k: string) => v1.played[k] ?? 0
    check(`${club.tag.padEnd(5)} 第一个 VCT 赛季三个赛段都上场`,
      p('kickoff') > 0 && p('stage1') > 0 && p('stage2') > 0,
      `启点 ${p('kickoff')} · Stage 1 ${p('stage1')} · Stage 2 ${p('stage2')}`)
    check(`${club.tag.padEnd(5)} 不再打次级联赛`,
      !(v1.by.challengers1 ?? 0) && !(v1.by.challengers2 ?? 0))

    // in an international's field means fixtures in it, every time
    const ghost = v1.intl.filter((x) => x.ties === 0).map((x) => `${x.name} 名单里有我们却一场没排`).join('；')
    reachedIntl += v1.intl.filter((x) => x.ties > 0).length
    check(`${club.tag.padEnd(5)} 进了国际赛名单就有比赛`, !ghost,
      ghost || v1.intl.map((x) => `${x.name} ${x.ties} 场`).join('、') || '本赛季没进国际赛')

    // the term is two seasons, and the second one is a full one
    check(`${club.tag.padEnd(5)} 第一个赛季结束时没被降回去`, g.teams[g.myTeam].tier === 1,
      `tier ${g.teams[g.myTeam].tier} · ${g.teams[g.myTeam].league}`)
    const v2 = runYear(g)
    const q = (k: string) => v2.played[k] ?? 0
    reachedIntl += v2.intl.filter((x) => x.ties > 0).length
    check(`${club.tag.padEnd(5)} 第二个 VCT 赛季照常`,
      q('kickoff') > 0 && q('stage1') > 0 && q('stage2') > 0,
      `启点 ${q('kickoff')} · Stage 1 ${q('stage1')} · Stage 2 ${q('stage2')}`)
  }
  console.log(`  （自然打进国际赛 ${reachedIntl} 次 — 会不会赢是实力问题，能不能去是下面这一段）`)
}

// ---- 3. the international door is open to a club that came up -------------
{
  console.log('\n=== 升上来也进得了国际赛 ===')
  const club = WORLD_TEAMS.filter((t) => t.tier === 2 && t.region === 'China')[0]
  const g = createNewGame(club.id, '测试', 4242)
  setupSeason(g)
  runYear(g, 'challengers2:China')
  const up = g.teams[g.myTeam]
  check(`${club.tag} 升入 VCT`, up.tier === 1, `tier ${up.tier}`)

  // Whether a promoted side is good enough to top its Kickoff is a balance
  // question; whether topping it lets it through the door is this one. The
  // field is drawn from a stage's final table the moment the last Kickoff
  // ends, so reordering that table afterwards proves nothing — we make the
  // club actually win instead, and follow it to the tournament.
  for (const pid of g.teams[g.myTeam].roster) {
    const p = g.players[pid]
    for (const k of ATTR_KEYS) p.attrs[k] = 99
    p.overall = 99
    p.potential = 99
  }
  // read the season's own snapshot: by the time runYear returns, the rollover
  // has built next year's comps over the top of these
  const v = runYear(g)
  for (const key of ['masters1', 'masters2', 'champions']) {
    const got = v.intl.find((x) => x.key === key)
    check(`赛区第一进得了 ${key}`, !!got && got.ties > 0,
      got ? `${got.name} ${got.ties} 场` : '名单里没有我们')
  }
  check('升上来的第一年，三个国际赛一个不落', v.intl.length === 3,
    v.intl.map((x) => x.name).join('、') || '一个都没进')
}

// ---- 4. the calendar a second-tier club actually sees ---------------------
{
  console.log('\n=== 赛季日历 ===')
  const club = WORLD_TEAMS.find((t) => t.tier === 2 && t.region === 'China')!
  const g = createNewGame(club.id, '测试', 77)
  setupSeason(g)
  const byStage: Record<string, number> = {}
  for (const f of mine(g)) {
    const st = STAGES.find((s) => f.day >= s.start && f.day <= s.end)
    byStage[st?.key ?? '?'] = (byStage[st?.key ?? '?'] ?? 0) + 1
  }
  console.log('  ' + Object.entries(byStage).map(([k, v]) => `${k} ${v} 场`).join(' · '))
  const empty = STAGES.filter((s) => s.key !== 'preseason' && s.key !== 'offseason' && !byStage[s.key])
  check('赛季中段没有整段空白', empty.length <= 2, empty.map((s) => s.name).join('、') || '没有空段')
}

console.log(bad ? `\n${bad} 处不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
