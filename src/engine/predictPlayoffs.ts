/**
 * 赛事预测 · 淘汰赛: the Champions Shanghai playoffs, picked before the first
 * quarterfinal.
 *
 * Eight teams, double elimination (vlr.gg/event/2766). The four upper
 * quarterfinals are drawn from the eight group qualifiers; who meets whom is
 * only known once the groups are over, so `quarters` stays null until then and
 * the bracket cannot be picked. Below the quarterfinals the bracket is fixed,
 * the same one Champions 2024 and 2025 were played on (both read off vlr on
 * 2026-10-03):
 *
 *   upper  q1 q2 q3 q4 → s1 (q1, q2) · s2 (q3, q4) → uf (s1, s2)
 *   lower  l1a (losers of q1, q2) · l1b (losers of q3, q4)
 *          l2a (loser of s2 v l1a) · l2b (loser of s1 v l1b) — crossed
 *          l3 (l2a v l2b) → lf (loser of uf v l3)
 *   final  gf (uf v lf)
 *
 * The lower final and the grand final are best of five, the rest best of three.
 * The whole bracket is one saved unit (group key 'P') and locks at one deadline.
 */

export type PSlot = 'q1' | 'q2' | 'q3' | 'q4' | 's1' | 's2' | 'l1a' | 'l1b' | 'l2a' | 'l2b' | 'uf' | 'l3' | 'lf' | 'gf'
/** in the order each depends only on the ones before it */
export const P_SLOTS: PSlot[] = ['q1', 'q2', 'q3', 'q4', 's1', 's2', 'l1a', 'l1b', 'l2a', 'l2b', 'uf', 'l3', 'lf', 'gf']
export type PPicks = Partial<Record<PSlot, string>>
type Pair = [string | null, string | null]
type Ref = { win: PSlot } | { lose: PSlot }

/** where both sides of every match after the quarterfinals come from */
export const FEEDS: Record<Exclude<PSlot, 'q1' | 'q2' | 'q3' | 'q4'>, [Ref, Ref]> = {
  s1: [{ win: 'q1' }, { win: 'q2' }],
  s2: [{ win: 'q3' }, { win: 'q4' }],
  l1a: [{ lose: 'q1' }, { lose: 'q2' }],
  l1b: [{ lose: 'q3' }, { lose: 'q4' }],
  l2a: [{ lose: 's2' }, { win: 'l1a' }],
  l2b: [{ lose: 's1' }, { win: 'l1b' }],
  uf: [{ win: 's1' }, { win: 's2' }],
  l3: [{ win: 'l2a' }, { win: 'l2b' }],
  lf: [{ lose: 'uf' }, { win: 'l3' }],
  gf: [{ win: 'uf' }, { win: 'lf' }],
}

export interface PlayoffEvent {
  id: string
  name: string
  /** the group-stage event whose eight qualifiers play here */
  from: string
  /** q1..q4 as [team, team], vlr's order; null until the draw is known */
  quarters: [string, string][] | null
  /** picks close here, UTC ms */
  deadline: number
  /** when each match starts, UTC ms */
  at: Record<PSlot, number>
  bo: Record<PSlot, 3 | 5>
}

export const PLAYOFF_KEY = 'P'

const t = (iso: string) => Date.parse(iso)

/** Beijing 16:00 on the first playoff day, an hour before the first quarterfinal */
export const CHAMPIONS_2026_PLAYOFF_DEADLINE = t('2026-10-07T08:00:00Z')

export const CHAMPIONS_2026_PLAYOFFS: PlayoffEvent = {
  id: 'champions-2026-playoffs',
  name: '上海冠军赛淘汰赛',
  from: 'champions-2026',
  // filled from vlr.gg/event/2766 once the groups are over and the bracket shows its teams
  quarters: null,
  deadline: CHAMPIONS_2026_PLAYOFF_DEADLINE,
  // vlr.gg match times (data-utc-ts), 2026-10-03
  at: {
    q1: t('2026-10-07T09:00Z'), q2: t('2026-10-07T12:00Z'), q3: t('2026-10-08T09:00Z'), q4: t('2026-10-08T12:00Z'),
    l1a: t('2026-10-09T09:00Z'), l1b: t('2026-10-09T12:00Z'),
    s1: t('2026-10-10T09:00Z'), s2: t('2026-10-10T12:00Z'),
    l2a: t('2026-10-11T09:00Z'), l2b: t('2026-10-11T12:00Z'),
    uf: t('2026-10-16T06:00Z'), l3: t('2026-10-16T09:00Z'), lf: t('2026-10-17T07:00Z'), gf: t('2026-10-18T06:00Z'),
  },
  bo: { q1: 3, q2: 3, q3: 3, q4: 3, s1: 3, s2: 3, l1a: 3, l1b: 3, l2a: 3, l2b: 3, uf: 3, l3: 3, lf: 5, gf: 5 },
}

export const PLAYOFF_EVENTS: PlayoffEvent[] = [CHAMPIONS_2026_PLAYOFFS]
export const playoffEvent = (id: string): PlayoffEvent | undefined => PLAYOFF_EVENTS.find(e => e.id === id)

const known = (p: Pair): p is [string, string] => !!p[0] && !!p[1]
const winnerIn = (p: Pair, pick?: string): string | null => known(p) && pick != null && p.includes(pick) ? pick : null
const loserIn = (p: Pair, pick?: string): string | null => {
  const w = winnerIn(p, pick)
  return w ? (w === p[0] ? p[1] : p[0]) : null
}

/** Who plays each match given the picks so far; null for a side not decided yet. */
export function playoffSides(ev: PlayoffEvent, picks: PPicks): Record<PSlot, Pair> {
  const out = {} as Record<PSlot, Pair>
  const q = ev.quarters
  ;(['q1', 'q2', 'q3', 'q4'] as const).forEach((k, i) => { out[k] = q ? [q[i][0], q[i][1]] : [null, null] })
  for (const k of P_SLOTS) {
    if (k in FEEDS) {
      const [a, b] = FEEDS[k as keyof typeof FEEDS]
      const side = (r: Ref) => 'win' in r ? winnerIn(out[r.win], picks[r.win]) : loserIn(out[r.lose], picks[r.lose])
      out[k] = [side(a), side(b)]
    }
  }
  return out
}

/** The picks that still stand: one for a match whose sides have changed is dropped. */
export function cleanPlayoffPicks(ev: PlayoffEvent, raw: unknown): PPicks {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const out: PPicks = {}
  if (!ev.quarters) return out
  for (const k of P_SLOTS) {
    const v = typeof src[k] === 'string' ? (src[k] as string) : undefined
    if (winnerIn(playoffSides(ev, out)[k], v)) out[k] = v
  }
  return out
}

/** Where the picks put the top four; null where they do not say yet. */
export function playoffPlacing(ev: PlayoffEvent, picks: PPicks) {
  const s = playoffSides(ev, picks)
  return {
    champion: winnerIn(s.gf, picks.gf),
    runnerUp: loserIn(s.gf, picks.gf),
    third: loserIn(s.lf, picks.lf),
    fourth: loserIn(s.l3, picks.l3),
  }
}

/**
 * The quarterfinal draw is only good when it is the eight teams that came
 * through the groups, each once — `qualifiers` is every confirmed group's
 * first and second, so a draw written before all four groups are settled, or
 * with a team in it that went out, keeps the playoffs closed.
 */
export function playoffOpen(ev: PlayoffEvent, qualifiers: string[]): boolean {
  const q = ev.quarters
  if (!q || q.length !== 4 || q.some(m => !Array.isArray(m) || m.length !== 2)) return false
  const teams = q.flat()
  return qualifiers.length === 8 && new Set(teams).size === 8 && teams.every(x => qualifiers.includes(x))
}

/**
 * The playoffs as played so far: the winner of every match that has finished.
 * A winner counts only when it is one of the two teams actually in that match
 * given the winners before it, and only for a match that had started before
 * the result was confirmed.
 */
export interface PlayoffResult { winners: PPicks; confirmedAt: number }

export function playedWinners(ev: PlayoffEvent, result: PlayoffResult | undefined, now: number): PPicks | null {
  if (!result || !ev.quarters || !Number.isSafeInteger(result.confirmedAt) || now < result.confirmedAt) return null
  const w = result.winners && typeof result.winners === 'object' ? result.winners : {}
  const clean = cleanPlayoffPicks(ev, w)
  // a winner written for a match the bracket does not reach, or one not yet played, voids the whole result
  for (const k of Object.keys(w)) {
    if (!(P_SLOTS as string[]).includes(k) || clean[k as PSlot] !== w[k as PSlot] || ev.at[k as PSlot] >= result.confirmedAt) return null
  }
  return clean
}

export type PlayoffReward = { elite: number; ten: number }

/**
 * Paid once, after the grand final, on the champion and the runner-up the
 * saved bracket arrives at — only the highest tier, as in the groups.
 * PENDING the owner's decision (2026-10-03): a proposal shaped like the group tiers.
 */
export function playoffReward(predicted: { champion: string | null; runnerUp: string | null }, real: { champion: string; runnerUp: string }): PlayoffReward {
  const exact = Number(predicted.champion === real.champion) + Number(predicted.runnerUp === real.runnerUp)
  const matched = [predicted.champion, predicted.runnerUp].filter(x => x && (x === real.champion || x === real.runnerUp)).length
  if (exact === 2) return { elite: 0, ten: 3 }
  if (predicted.champion === real.champion) return { elite: 0, ten: 2 }
  if (predicted.runnerUp === real.runnerUp) return { elite: 0, ten: 1 }
  if (matched === 2) return { elite: 5, ten: 0 }
  if (matched === 1) return { elite: 3, ten: 0 }
  return { elite: 0, ten: 0 }
}
