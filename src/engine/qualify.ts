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
import { PLAYOFF_CUT, championsField, compKey, mastersField } from './season'
import { sortStandings } from './league'
import { CHAMPIONS, MASTERS_1, MASTERS_2 } from './endings'
import { swissRecord } from './bracket'
import type { GameState, StageKey } from './types'

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
            : `${comp.name} 瑞士轮 ${r.w}-${r.l}（${seed} 号种子）：再赢 ${2 - r.w} 场进季后赛，再输 ${2 - r.l} 场出局。`,
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
