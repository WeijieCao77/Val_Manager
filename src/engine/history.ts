/**
 * What happened to a player IN THIS SAVE: the clubs he served and the
 * titles he lifted, kept on the player and written where it happens.
 *
 * Titles used to be `{year, title}` and nothing else — the winning club was
 * whoever he played for when you looked, which after a transfer is the
 * wrong club. A title now carries the competition's key and stage, the
 * club and its name as they were that day, the day itself, and whether he
 * was in the starting five or on the bench of the squad that won it. The
 * rule is unchanged on purpose: every man on the champion's roster gets
 * the line, starters and bench alike, and nobody who arrives afterwards
 * does. The cap of forty is gone — a title is not paperwork, and the most
 * a career can collect is a few hundred bytes.
 *
 * The CV (`clubHist`) is year-granular; the season sweep in endSeason
 * extends the open line. What was missing was the closing: a release, an
 * expiry or a retirement left the line open, so a man released in
 * February kept reading as at the club all year. Every roster join and
 * leave goes through the two helpers here.
 */
import type { Competition, GameState, Player } from './types'

export interface Title {
  year: number
  title: string
  /** the competition's key, so two events with one name in one year stay apart */
  key?: string
  stage?: string
  /** the club that lifted it, id and the name it had that day */
  team?: string
  teamName?: string
  day?: number
  /** in the five that started that day, or in the squad behind them */
  part?: 'starter' | 'squad'
  intl?: boolean
}

export const TITLE_CAP = 200

export function recordJoin(state: GameState, p: Player, teamId: string): void {
  p.clubHist ??= []
  const last = p.clubHist[p.clubHist.length - 1]
  if (last && last.team === teamId && last.to >= state.year) return
  p.clubHist.push({ team: teamId, from: state.year, to: state.year })
}

/** close the open line; a man who left in February does not read as here all year */
export function recordLeave(state: GameState, p: Player): void {
  const last = p.clubHist?.[p.clubHist.length - 1]
  if (last && p.teamId && last.team === p.teamId) last.to = Math.max(last.from, Math.min(last.to, state.year))
}

/** the same line twice — the competition settled twice, a save replayed — is one line */
const has = (p: Player, key: string, year: number) =>
  (p.titles ?? []).some((t) => t.key === key && t.year === year)

export function recordTitle(state: GameState, comp: Competition, champId: string): void {
  const champ = state.teams[champId]
  if (!champ) return
  const intl = comp.stage === 'masters1' || comp.stage === 'masters2' || comp.stage === 'champions'
  for (const pid of champ.roster) {
    const p = state.players[pid]
    if (!p || has(p, comp.key, state.year)) continue
    p.titles ??= []
    p.titles.push({
      year: state.year, title: comp.name, key: comp.key, stage: comp.stage,
      team: champ.id, teamName: champ.name, day: state.day,
      part: champ.starters.includes(pid) ? 'starter' : 'squad', intl,
    })
    if (p.titles.length > TITLE_CAP) p.titles.splice(0, p.titles.length - TITLE_CAP)
  }
}

/** the club a title was won at, as it should be printed; nothing is guessed for an old line */
export const titleClub = (state: GameState, t: Title): string =>
  t.teamName ?? (t.team ? state.teams[t.team]?.name ?? t.team : '俱乐部未知')
