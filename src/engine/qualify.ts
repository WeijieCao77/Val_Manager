/**
 * Where the club stands on the road to the next international event.
 *
 * The standings said who was above whom and nothing else; a manager on the
 * Stage 1 table had to know, from outside the game, that the top three go to
 * Masters and that the winner skips the Swiss round. This answers, in one
 * panel and one agenda line, the three questions the table cannot: what does
 * this stage lead to, what do we still need, and what seed would we be.
 *
 * Pure: reads the state, writes nothing.
 */
import { INTERNATIONAL_OPEN, PLAYOFF_CUT, championsField, compKey, mastersField } from './season'
import { sortStandings } from './league'
import { CHAMPIONS, MASTERS_1, MASTERS_2 } from './endings'
import { swissRecord } from './bracket'
import { hostCity } from './hosts'
import type { Competition, Fixture, GameState, StageKey } from './types'

export interface QualStatus {
  /** the event this stage leads to */
  event: string
  /** one line for the agenda */
  headline: string
  /** the panel: the rule, then where we stand */
  lines: string[]
  tone: 'good' | 'info' | 'warn'
}

const ordinal = (n: number) => `第 ${n} 名`

const feederOf = (stage: StageKey): { event: string; next: 'masters1' | 'masters2' | 'champions' } | null =>
  stage === 'kickoff' ? { event: MASTERS_1, next: 'masters1' }
    : stage === 'stage1' ? { event: MASTERS_2, next: 'masters2' }
      : stage === 'stage2' ? { event: CHAMPIONS, next: 'champions' }
        : null

/** How a regional stage feeds its international, in the player's words. */
export function qualifyRule(stage: StageKey): string {
  switch (stage) {
    case 'kickoff':
      return `小组赛前 4 进季后赛（双败淘汰）。季后赛前 3 名去 ${MASTERS_1}：第 1 名直接进季后赛，第 2、3 名先打瑞士轮。`
    case 'stage1':
      return `常规赛前 8 进季后赛（双败淘汰）。季后赛前 3 名去 ${MASTERS_2}：第 1 名直接进季后赛，第 2、3 名先打瑞士轮。`
    case 'stage2':
      return `常规赛前 8 进季后赛（双败淘汰）。季后赛前 2 名直接去 ${CHAMPIONS}，赛区另外 2 个名额按全年冠军积分排。`
    default:
      return ''
  }
}

/** Points on offer, for the panel's footnote. */
export const POINTS_NOTE =
  '冠军积分：Kickoff 前 4 名 6/4/3/2；Stage 1、Stage 2 前 8 名 9/7/5/4/3/3/2/2；Masters 前 6 名 12/9/7/5/4/4。'

/** The day each international opens on, at the earliest. */
export const INTERNATIONAL_START = INTERNATIONAL_OPEN

export type EventKey = 'masters1' | 'masters2' | 'champions'

/**
 * Why a side opens in the Swiss round, in the player's words. It used to say
 * 「从瑞士轮打起（1 号种子）」 — the seed among the eight Swiss teams — and a
 * manager who had just finished second read it as the event's top seed
 * being made to play a qualifier: 「为什么一号种子要从瑞士轮打起？」. The
 * regional place is the fact that explains it.
 */
const swissHow = (place: number): string =>
  place > 0 ? `赛区第 ${place} 名，先打瑞士轮——只有赛区冠军直接进季后赛` : '先打瑞士轮——只有赛区冠军直接进季后赛'
const EVENT_KEYS: EventKey[] = ['masters1', 'masters2', 'champions']

export interface Qualified {
  key: EventKey
  name: string
  city: string
  year: number
  teamId: string
  /** how we got in, in the player's words */
  how: string
}

/**
 * The international the club has a place at this season, from the moment
 * the place is certain until the event is over — the poster's subject.
 */
export function qualifiedEvent(state: GameState): Qualified | null {
  const me = state.teams[state.myTeam]
  if (!me || me.tier !== 1) return null
  const up = upcomingInternational(state)
  if (up) return { key: up.key, name: up.name, city: hostCity(state, up.key), year: state.year, teamId: me.id, how: up.how }
  for (const key of EVENT_KEYS) {
    const comp = state.comps[key]
    if (!comp || comp.champion || !comp.teams.includes(me.id)) continue
    const feeder = key === 'champions' ? null : state.comps[compKey(key === 'masters1' ? 'kickoff' : 'stage1', me.region)]
    const how = comp.byes?.includes(me.id) ? '赛区冠军，直接进季后赛'
      : comp.swissSeeds?.includes(me.id) ? swissHow((feeder?.finished.indexOf(me.id) ?? -1) + 1)
        : key === 'champions' ? (championsField(state)[me.region].indexOf(me.id) < 2 ? 'Stage 2 前 2，直接晋级' : '全年积分名额') : '拿到了参赛名额'
    return { key, name: comp.name, city: comp.city ?? hostCity(state, key), year: state.year, teamId: me.id, how }
  }
  return null
}

export interface Upcoming {
  key: 'masters1' | 'masters2' | 'champions'
  name: string
  /** the day its first match can be on — a Swiss round for a 2nd/3rd seed,
   *  the playoffs about a week later for a regional winner */
  day: number
  /** how we got in, in the player's words */
  how: string
  /** true when we open in the Swiss round rather than the playoffs */
  swiss: boolean
}

/**
 * The international event the club has already qualified for but which does
 * not exist yet.
 *
 * A Masters is created only once every region's feeder stage has concluded,
 * which can be days after ours did. In that gap the club knew it was going —
 * the qualification panel said so — while the top bar counted down to a
 * league game forty days away and the schedule listed nothing in between.
 * This names the event and the day it opens, so nothing arrives unannounced.
 */
export function upcomingInternational(state: GameState): Upcoming | null {
  const me = state.teams[state.myTeam]
  if (!me || me.tier !== 1) return null
  const order: { key: 'masters1' | 'masters2' | 'champions'; feeder: StageKey; name: string }[] = [
    { key: 'masters1', feeder: 'kickoff', name: MASTERS_1 },
    { key: 'masters2', feeder: 'stage1', name: MASTERS_2 },
    { key: 'champions', feeder: 'stage2', name: CHAMPIONS },
  ]
  for (const ev of order) {
    if (state.comps[ev.key]) continue
    const feeder = state.comps[compKey(ev.feeder, me.region)]
    if (!feeder) continue
    const start = Math.max(state.day + 3, INTERNATIONAL_START[ev.key])
    if (!feeder.champion) {
      // The stage is still running, but a place can already be sealed: a
      // side beaten in the lower final is third whatever the final says.
      // That is exactly the gap the group hit — out on the 20th, final on
      // the 22nd, and the page pointing at a league game in April.
      if (ev.key === 'champions' || !feeder.bracketStarted) continue
      const idx = feeder.finished.indexOf(state.myTeam)
      if (idx < 0) continue
      const place = feeder.teams.length - feeder.finished.length + idx + 1
      if (place > 3) return null
      return { key: ev.key, name: ev.name, day: start, swiss: true, how: swissHow(place) }
    }
    if (ev.key === 'champions') {
      const field = championsField(state)[me.region]
      const idx = field.indexOf(state.myTeam)
      if (idx < 0) return null
      return { key: ev.key, name: ev.name, day: start, swiss: false, how: idx < 2 ? 'Stage 2 前 2，直接晋级' : '全年积分名额' }
    }
    const { byes, swiss } = mastersField(state, ev.feeder)
    if (byes.includes(state.myTeam)) {
      return { key: ev.key, name: ev.name, day: start + 8, swiss: false, how: '赛区冠军，直接进季后赛' }
    }
    if (swiss.includes(state.myTeam)) {
      return { key: ev.key, name: ev.name, day: start, swiss: true, how: swissHow(feeder.finished.indexOf(state.myTeam) + 1) }
    }
    return null
  }
  return null
}

export function qualification(state: GameState): QualStatus | null {
  const me = state.teams[state.myTeam]
  if (!me || me.tier !== 1) return null

  // ---- inside an international: where we are in it
  if (state.stage === 'masters1' || state.stage === 'masters2' || state.stage === 'champions') {
    const comp = state.comps[state.stage]
    if (!comp) return null
    if (!comp.teams.includes(state.myTeam)) {
      return { event: comp.name, headline: `${comp.name} 正在进行，我们没有拿到参赛资格。`, lines: [], tone: 'info' }
    }
    if (comp.champion) {
      const place = comp.finished.indexOf(state.myTeam) + 1
      return {
        event: comp.name, tone: place <= 3 ? 'good' : 'info',
        headline: place === 1 ? `我们是 ${comp.name} 冠军！` : `${comp.name} 结束：我们 ${ordinal(place)}。`,
        lines: [],
      }
    }
    if (comp.format === 'masters' && !comp.bracketStarted) {
      if (comp.byes?.includes(state.myTeam)) {
        return { event: comp.name, headline: `${comp.name}：作为赛区冠军直接进季后赛，等瑞士轮打完。`, lines: [], tone: 'good' }
      }
      const r = swissRecord(comp, state.myTeam)
      const seed = (comp.swissSeeds ?? []).indexOf(state.myTeam) + 1
      return {
        event: comp.name, tone: r.l >= 2 ? 'warn' : 'info',
        headline: r.w >= 2 ? `${comp.name} 瑞士轮 ${r.w}-${r.l}，已经晋级季后赛。`
          : r.l >= 2 ? `${comp.name} 瑞士轮 ${r.w}-${r.l}，止步瑞士轮。`
            : `${comp.name} 瑞士轮 ${r.w}-${r.l}（瑞士轮 ${seed} 号种子）：再赢 ${2 - r.w} 场进季后赛，再输 ${2 - r.l} 场出局。`,
        lines: [],
      }
    }
    if (comp.format === 'champions' && !comp.bracketStarted) {
      const gi = (comp.groups ?? []).findIndex((grp) => grp.includes(state.myTeam))
      return {
        event: comp.name, tone: 'info',
        headline: `${comp.name} 小组赛进行中（${'ABCD'[gi] ?? '?'} 组）：小组前 2 进八强。`, lines: [],
      }
    }
    const out = comp.finished.includes(state.myTeam)
    if (out) {
      const place = comp.teams.length - comp.finished.length + comp.finished.indexOf(state.myTeam) + 1
      return { event: comp.name, headline: `${comp.name}：我们止步 ${ordinal(place)}。`, lines: [], tone: 'info' }
    }
    const lost = state.fixtures.some((f) => f.comp === comp.key && f.label.startsWith('KO:') && f.result
      && (f.teamA === state.myTeam || f.teamB === state.myTeam)
      && ((f.result.mapsWonA > f.result.mapsWonB) !== (f.teamA === state.myTeam)))
    return {
      event: comp.name, tone: 'info',
      headline: `${comp.name} 季后赛：${lost ? '在败者组，再输一场就出局' : '在胜者组，输一场还有败者组'}。`,
      lines: [],
    }
  }

  const feed = feederOf(state.stage)
  if (!feed) return null
  const comp = state.comps[compKey(state.stage, me.region)]
  if (!comp) return null
  const rule = qualifyRule(state.stage)
  const size = comp.teams.length

  // ---- the stage is decided
  if (comp.champion) {
    const place = comp.finished.indexOf(state.myTeam) + 1
    if (state.stage === 'stage2') {
      const field = championsField(state)[me.region]
      const idx = field.indexOf(state.myTeam)
      if (idx >= 0) {
        const how = idx < 2 ? `Stage 2 ${ordinal(place)}，直接晋级` : `全年积分 ${me.champPoints} 分，赛区积分名额`
        return { event: feed.event, tone: 'good', headline: `已锁定 ${feed.event}（${how}）。`, lines: [rule] }
      }
      const last = field[3] ? state.teams[field[3]] : null
      return {
        event: feed.event, tone: 'warn',
        headline: `无缘 ${feed.event}：Stage 2 ${ordinal(place)}，积分 ${me.champPoints}${last ? `，最后一个名额是 ${last.name}（${last.champPoints} 分）` : ''}。`,
        lines: [rule],
      }
    }
    const { byes, swiss } = mastersField(state, state.stage)
    if (byes.includes(state.myTeam)) {
      return { event: feed.event, tone: 'good', headline: `已锁定 ${feed.event}：赛区冠军，直接进季后赛（${byes.indexOf(state.myTeam) + 1} 号种子）。`, lines: [rule] }
    }
    if (swiss.includes(state.myTeam)) {
      return { event: feed.event, tone: 'good', headline: `已锁定 ${feed.event}：${ordinal(place)}，从瑞士轮打起（瑞士轮 ${swiss.indexOf(state.myTeam) + 1} 号种子）。`, lines: [rule] }
    }
    return { event: feed.event, tone: 'warn', headline: `无缘 ${feed.event}：本赛段 ${ordinal(place)}，需要前 3。`, lines: [rule] }
  }

  // ---- in the playoffs
  if (comp.bracketStarted) {
    if (comp.finished.includes(state.myTeam) && !(comp.seeds ?? []).includes(state.myTeam)) {
      const place = size - comp.finished.length + comp.finished.indexOf(state.myTeam) + 1
      return { event: feed.event, tone: 'warn', headline: `未进季后赛（${ordinal(place)}），本赛段与 ${feed.event} 无缘。`, lines: [rule] }
    }
    const need = state.stage === 'stage2' ? '前 2 名直接晋级' : '至少第 3 名'
    const lost = state.fixtures.some((f) => f.comp === comp.key && f.label.startsWith('KO:') && f.result
      && (f.teamA === state.myTeam || f.teamB === state.myTeam)
      && ((f.result.mapsWonA > f.result.mapsWonB) !== (f.teamA === state.myTeam)))
    const stillIn = !comp.finished.includes(state.myTeam)
    if (!stillIn) {
      const place = size - comp.finished.length + comp.finished.indexOf(state.myTeam) + 1
      const ok = state.stage === 'stage2' ? false : place <= 3
      return {
        event: feed.event, tone: ok ? 'good' : 'warn',
        headline: ok ? `季后赛止步 ${ordinal(place)}，仍拿到 ${feed.event} 资格。`
          : `季后赛止步 ${ordinal(place)}${state.stage === 'stage2' ? `，只能看积分（现在 ${me.champPoints} 分）` : `，无缘 ${feed.event}`}。`,
        lines: [rule],
      }
    }
    return {
      event: feed.event, tone: 'info',
      headline: `季后赛进行中（${lost ? '败者组' : '胜者组'}）：${need}就能去 ${feed.event}。`,
      lines: [rule],
    }
  }

  // ---- the table
  const table = sortStandings(comp)
  const place = table.indexOf(state.myTeam) + 1
  const cut = Math.min(PLAYOFF_CUT[state.stage] ?? 8, size)
  const row = comp.standings[state.myTeam]
  const rec = row ? `${row.w}-${row.l}` : '0-0'
  const played = Object.values(comp.standings).some((r) => r.w + r.l > 0)
  const lines = [rule]
  if (state.stage === 'stage2') {
    const rank = Object.values(state.teams)
      .filter((t) => t.region === me.region && t.tier === 1)
      .sort((a, b) => b.champPoints - a.champPoints || b.rating - a.rating)
    const pr = rank.findIndex((t) => t.id === state.myTeam) + 1
    lines.push(`全年冠军积分：${me.champPoints} 分，赛区第 ${pr}。积分名额给季后赛前 2 之外积分最高的 2 队，所以积分排在前 4 附近就有机会。`)
  }
  if (!played) {
    return { event: feed.event, tone: 'info', headline: `本赛段尚未开打。前 ${cut} 进季后赛。`, lines }
  }
  const gapTeam = place > cut ? state.teams[table[cut - 1]] : null
  const gapRow = gapTeam ? comp.standings[gapTeam.id] : null
  const gap = gapRow && row ? gapRow.w - row.w : 0
  const headline = place <= cut
    ? `常规赛第 ${place}（${rec}），在季后赛区内（前 ${cut}）。`
    : `常规赛第 ${place}（${rec}），距季后赛区（第 ${cut} 名 ${gapTeam?.name}）${gap > 0 ? `差 ${gap} 场胜利` : '只差净胜'}。`
  return { event: feed.event, tone: place <= cut ? 'info' : 'warn', headline, lines }
}

// ---------------------------------------------------------------- inside an event

/** One round of an event that exists on the calendar whether or not its
 *  fixtures have been drawn yet. */
export interface EventRound {
  /** the fixture label's round name, e.g. 瑞士轮 第2轮 or 胜者组决赛 */
  name: string
  day: number
  /** true when its fixtures already exist */
  drawn: boolean
}

/** Days between waves — the same number season.ts schedules with. */
const GAP = 2

/**
 * Every round of an international, dated.
 *
 * The draw only exists round by round, but the calendar does not: the Swiss
 * plays on three days two apart, the playoffs on six. A club that has just
 * gone 2–0 knows exactly which day its playoff opens even though nobody knows
 * against whom. Dated from the event's first fixture.
 */
export function eventRounds(state: GameState, comp: Competition): EventRound[] {
  const own = state.fixtures.filter((f) => f.comp === comp.key)
  if (!own.length) return []
  const first = Math.min(...own.map((f) => f.day))
  const rounds: { key: string; name: string; offset: number }[] = []
  if (comp.format === 'masters') {
    for (let r = 1; r <= 3; r++) rounds.push({ key: `${r}:瑞士轮 第${r}轮`, name: `瑞士轮 第${r}轮`, offset: (r - 1) * GAP })
  } else if (comp.format === 'champions') {
    const names = ['开局赛', '胜者赛 / 败者赛', '决胜赛']
    names.forEach((n, i) => rounds.push({ key: `${i + 1}:小组赛`, name: `小组赛 ${n}`, offset: i * GAP }))
  }
  const base = rounds.length * GAP
  const po = comp.format === 'champions' || comp.format === 'masters' || (comp.seeds ?? []).length >= 8
    ? ['胜者组第一轮', '胜者组第二轮 / 败者组第一轮', '胜者组决赛 / 败者组第二轮', '败者组半决赛', '败者组决赛', '总决赛']
    : ['胜者组第一轮', '胜者组决赛 / 败者组第一轮', '败者组决赛', '总决赛']
  const waveOffset = comp.format === 'champions' ? 3 : 0
  po.forEach((n, i) => rounds.push({ key: `${waveOffset + i + 1}:${n.split(' / ')[0]}`, name: n, offset: base + i * GAP }))
  return rounds.map((r) => ({
    name: r.name, day: first + r.offset,
    drawn: comp.format === 'masters' && r.key.includes('瑞士轮')
      ? own.some((f) => f.label.startsWith(`SW:${r.key.split(':')[0]}:`))
      : own.some((f) => f.label.startsWith(`KO:${r.key.split(':')[0]}:`)),
  }))
}

/** The club's next appearance in an event whose draw has not reached it yet. */
export interface NextIn { comp: Competition; day: number; round: string }

/**
 * Where the club plays next inside an event, when no fixture says so.
 *
 * The draw arrives one wave at a time, so a side that has just qualified
 * from the Swiss round, or won an upper-bracket match while the other tie is
 * still being played, has no fixture and — until now — no next match at all:
 * the top bar counted down to a league game weeks away. The round is known
 * from the format; only the opponent is not.
 */
export function nextInEvent(state: GameState): NextIn | null {
  const me = state.myTeam
  for (const key of ['masters1', 'masters2', 'champions'] as const) {
    const comp = state.comps[key]
    if (!comp || comp.champion || !comp.teams.includes(me)) continue
    if (state.fixtures.some((f) => f.comp === key && !f.played && (f.teamA === me || f.teamB === me))) return null
    if (comp.finished.includes(me)) continue
    const rounds = eventRounds(state, comp)
    const at = (name: string) => rounds.find((r) => r.name.split(' / ').includes(name) || r.name === name)
    const mine = state.fixtures.filter((f) => f.comp === key && f.played && (f.teamA === me || f.teamB === me))
    const last = mine[mine.length - 1]
    const won = (f: Fixture) => (f.result!.mapsWonA > f.result!.mapsWonB) === (f.teamA === me)
    if (!comp.bracketStarted) {
      if (comp.format === 'masters') {
        if (comp.byes?.includes(me)) { const r = at('胜者组第一轮'); return r ? { comp, day: r.day, round: '季后赛 胜者组第一轮' } : null }
        const rec = swissRecord(comp, me)
        if (rec.l >= 2) continue
        if (rec.w >= 2) { const r = at('胜者组第一轮'); return r ? { comp, day: r.day, round: '季后赛 胜者组第一轮' } : null }
        const n = rec.w + rec.l + 1
        const r = at(`瑞士轮 第${n}轮`)
        return r ? { comp, day: r.day, round: `瑞士轮 第${n}轮` } : null
      }
      // Champions groups: the next group wave, or the playoffs once through
      const g = mine.filter((f) => /^KO:\d+:[A-D]组/.test(f.label))
      const lastG = g[g.length - 1]
      if (!lastG) { const r = rounds[0]; return r ? { comp, day: r.day, round: '小组赛 开局赛' } : null }
      const name = lastG.label.split(':')[2].replace(/^[A-D]组 /, '')
      if (name === '胜者赛' && won(lastG)) { const r = at('胜者组第一轮'); return r ? { comp, day: r.day, round: '季后赛 胜者组第一轮' } : null }
      if (name === '决胜赛') { if (!won(lastG)) continue; const r = at('胜者组第一轮'); return r ? { comp, day: r.day, round: '季后赛 胜者组第一轮' } : null }
      if (name === '败者赛' && !won(lastG)) continue
      const next = name === '开局赛' ? (won(lastG) ? '胜者赛' : '败者赛') : '决胜赛'
      const r = rounds.find((x) => x.name.includes(next))
      return r ? { comp, day: r.day, round: `小组赛 ${next}` } : null
    }
    // the playoffs: the next round follows from the last result
    const NEXT: Record<string, [string, string]> = {
      胜者组第一轮: ['胜者组第二轮', '败者组第一轮'], 胜者组第二轮: ['胜者组决赛', '败者组第二轮'],
      胜者组决赛: ['总决赛', '败者组决赛'], 败者组第一轮: ['败者组第二轮', ''], 败者组第二轮: ['败者组半决赛', ''],
      败者组半决赛: ['败者组决赛', ''], 败者组决赛: ['总决赛', ''],
    }
    const ko = mine.filter((f) => f.label.startsWith('KO:') && !/[A-D]组/.test(f.label))
    const lastK = ko[ko.length - 1]
    if (!lastK) { const r = at('胜者组第一轮'); return r ? { comp, day: r.day, round: '季后赛 胜者组第一轮' } : null }
    const name = lastK.label.split(':')[2]
    const nxt = NEXT[name]?.[won(lastK) ? 0 : 1]
    if (!nxt) continue
    const r = at(nxt)
    return r ? { comp, day: r.day, round: `季后赛 ${nxt}` } : null
    void last
  }
  return null
}
