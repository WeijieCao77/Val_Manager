/**
 * 赛事预测: the groups of Champions Shanghai 2026, picked before they are played.
 *
 * Sixteen teams in four groups of four (vlr.gg/event/2766). Each group is a
 * double-elimination bracket of best-of-threes: two opening matches; their
 * winners meet in the winners' match and their losers in the elimination
 * match; the decider is the winners'-match loser against the elimination
 * winner. The winners' match winner goes through first and the decider
 * winner second, and those eight start the playoffs together in the upper
 * bracket. Third place is 9th–12th and fourth 13th–16th — nobody leaves the
 * groups for a lower bracket.
 *
 * The picks live on the server (the `predict` action), because they will pay
 * something once the rewards are settled, and a group closes the moment its
 * first match starts.
 */
import type { GachaState } from './gacha'

export type SlotKey = 'o1' | 'o2' | 'w' | 'e' | 'd'
/** in the order each depends only on the ones before it */
export const SLOTS: SlotKey[] = ['o1', 'o2', 'w', 'e', 'd']
export type Picks = Partial<Record<SlotKey, string>>
export type Pair = [string | null, string | null]

export interface PredictTeam { tag: string; clubId: string; name: string }

export interface PredictGroup {
  key: string
  /** o1 is teams[0] v teams[1], o2 is teams[2] v teams[3] */
  teams: [string, string, string, string]
  /** when each match starts, UTC ms */
  at: Record<SlotKey, number>
}

export interface PredictEvent {
  id: string
  name: string
  teams: Record<string, PredictTeam>
  groups: PredictGroup[]
}

const at = (o1: string, o2: string, w: string, e: string, d: string): Record<SlotKey, number> =>
  ({ o1: Date.parse(o1), o2: Date.parse(o2), w: Date.parse(w), e: Date.parse(e), d: Date.parse(d) })

export const CHAMPIONS_2026: PredictEvent = {
  id: 'champions-2026',
  name: '上海冠军赛',
  teams: {
    '100T': { tag: '100T', clubId: 'T6', name: '100 Thieves' },
    T1: { tag: 'T1', clubId: 'T25', name: 'T1' },
    JDG: { tag: 'JDG', clubId: 'T45', name: 'JD Gaming' },
    FUT: { tag: 'FUT', clubId: 'T15', name: 'FUT Esports' },
    GE: { tag: 'GE', clubId: 'T34', name: 'Global Esports' },
    VIT: { tag: 'VIT', clubId: 'T12', name: 'Team Vitality' },
    LOUD: { tag: 'LOUD', clubId: 'T8', name: 'LOUD' },
    EDG: { tag: 'EDG', clubId: 'T36', name: 'EDward Gaming' },
    TL: { tag: 'TL', clubId: 'T18', name: 'Team Liquid' },
    PRX: { tag: 'PRX', clubId: 'T24', name: 'Paper Rex' },
    TYL: { tag: 'TYL', clubId: 'T38', name: 'TYLOO' },
    G2: { tag: 'G2', clubId: 'T2', name: 'G2 Esports' },
    NS: { tag: 'NS', clubId: 'T26', name: 'Nongshim RedForce' },
    NRG: { tag: 'NRG', clubId: 'T1', name: 'NRG' },
    KC: { tag: 'KC', clubId: 'T23', name: 'Karmine Corp' },
    XLG: { tag: 'XLG', clubId: 'T37', name: 'Xi Lai Gaming' },
  },
  // Beijing 17:00 and 20:00 are 09:00 and 12:00 UTC
  groups: [
    { key: 'A', teams: ['100T', 'T1', 'JDG', 'FUT'],
      at: at('2026-09-27T09:00Z', '2026-09-27T12:00Z', '2026-09-30T09:00Z', '2026-10-02T09:00Z', '2026-10-04T09:00Z') },
    { key: 'B', teams: ['GE', 'VIT', 'LOUD', 'EDG'],
      at: at('2026-09-26T09:00Z', '2026-09-26T12:00Z', '2026-09-30T12:00Z', '2026-10-02T12:00Z', '2026-10-04T12:00Z') },
    { key: 'C', teams: ['TL', 'PRX', 'TYL', 'G2'],
      at: at('2026-09-24T09:00Z', '2026-09-24T12:00Z', '2026-09-29T09:00Z', '2026-10-01T09:00Z', '2026-10-03T09:00Z') },
    { key: 'D', teams: ['NS', 'NRG', 'KC', 'XLG'],
      at: at('2026-09-25T09:00Z', '2026-09-25T12:00Z', '2026-09-29T12:00Z', '2026-10-01T12:00Z', '2026-10-03T12:00Z') },
  ],
}

export const PREDICT_EVENTS: PredictEvent[] = [CHAMPIONS_2026]

const known = (p: Pair): p is [string, string] => !!p[0] && !!p[1]

/** The winner picked for a match, when it is one of the two sides actually in it. */
export const winnerIn = (p: Pair, pick?: string): string | null =>
  known(p) && pick != null && p.includes(pick) ? pick : null

export const loserIn = (p: Pair, pick?: string): string | null => {
  const w = winnerIn(p, pick)
  return w ? (w === p[0] ? p[1] : p[0]) : null
}

/** Who plays each match given the picks so far; null for a side not decided yet. */
export function sides(group: PredictGroup, picks: Picks): Record<SlotKey, Pair> {
  const o1: Pair = [group.teams[0], group.teams[1]]
  const o2: Pair = [group.teams[2], group.teams[3]]
  const w: Pair = [winnerIn(o1, picks.o1), winnerIn(o2, picks.o2)]
  const e: Pair = [loserIn(o1, picks.o1), loserIn(o2, picks.o2)]
  const d: Pair = [loserIn(w, picks.w), winnerIn(e, picks.e)]
  return { o1, o2, w, e, d }
}

/** The picks that still stand: one for a match whose sides have changed is dropped. */
export function cleanPicks(group: PredictGroup, raw: unknown): Picks {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const out: Picks = {}
  for (const k of SLOTS) {
    const v = typeof src[k] === 'string' ? (src[k] as string) : undefined
    if (winnerIn(sides(group, out)[k], v)) out[k] = v
  }
  return out
}

/** Where each team finishes on these picks; null where they do not say yet. */
export function standing(group: PredictGroup, picks: Picks) {
  const s = sides(group, picks)
  return {
    first: winnerIn(s.w, picks.w),
    second: winnerIn(s.d, picks.d),
    third: loserIn(s.d, picks.d),
    fourth: loserIn(s.e, picks.e),
  }
}

/** A group closes when its first match starts. */
export const lockAt = (group: PredictGroup): number => Math.min(...SLOTS.map((k) => group.at[k]))
export const isLocked = (group: PredictGroup, now: number): boolean => now >= lockAt(group)

export const picksOf = (g: GachaState, eventId: string, groupKey: string): Picks =>
  g.predict?.[eventId]?.[groupKey]?.picks ?? {}

export function setPicks(
  g: GachaState, eventId: string, groupKey: string, raw: unknown, now: number,
): { ok: true; picks: Picks } | { ok: false; why: string } {
  const ev = PREDICT_EVENTS.find((e) => e.id === eventId)
  const group = ev?.groups.find((x) => x.key === groupKey)
  if (!ev || !group) return { ok: false, why: '没有这个赛事' }
  if (isLocked(group, now)) return { ok: false, why: `${group.key} 组已经开赛，预测锁定了` }
  const picks = cleanPicks(group, raw)
  g.predict ??= {}
  g.predict[ev.id] ??= {}
  g.predict[ev.id][group.key] = { picks, at: now }
  return { ok: true, picks }
}

/** A save's predictions brought back to what the rules allow; undefined when there are none. */
export function cleanPredictions(raw: unknown): GachaState['predict'] {
  if (!raw || typeof raw !== 'object') return undefined
  const out: NonNullable<GachaState['predict']> = {}
  for (const ev of PREDICT_EVENTS) {
    const byGroup = (raw as Record<string, unknown>)[ev.id]
    if (!byGroup || typeof byGroup !== 'object') continue
    for (const group of ev.groups) {
      const row = (byGroup as Record<string, { picks?: unknown; at?: unknown } | undefined>)[group.key]
      if (!row || typeof row !== 'object') continue
      const picks = cleanPicks(group, row.picks)
      if (!Object.keys(picks).length) continue
      out[ev.id] ??= {}
      out[ev.id][group.key] = { picks, at: Math.max(0, Math.trunc(Number(row.at) || 0)) }
    }
  }
  return Object.keys(out).length ? out : undefined
}
