/**
 * 全服组队杯 — strangers dealt into fives, five duels a tie, one purse a team.
 *
 * A player's suggestion (2026-09-19): 「每 3 名或 5 名玩家随机组队，队与队随机
 * 匹配，赢一场加 1 分，按组内总分判胜负，奖励全组一样」, with the owner's brief
 * to measure which rules are fairest before building any. They were measured
 * (scripts/measure_cup_formats.ts — the live field's real scores and the real
 * odds of 1,300 ties), and the suggestion as written is a lottery on the draw:
 *
 *   teams thrown together at random   the 90th-percentile team is 6–8 points a
 *     head better than the 10th; the champion comes from the strongest quarter
 *     of teams 83–87% of the time and from the weakest quarter never; half the
 *     duels are foregone (a gap of five or more).
 *   teams DEALT by score, duels RANKED   every team gets one entrant from each
 *     fifth of the field, each tier's strongest going to the team that is
 *     weakest so far; first seat meets first seat, fifth meets fifth. Teams
 *     are 1.7 points apart, 93% of duels are within four points, no quarter of
 *     teams wins more than its share — and a bottom-quarter five is paid as
 *     often as a top-decile one (12% each), because its duel against the other
 *     team's weakest counts for exactly as much as the stars'.
 *
 * Fives rather than threes: the five-tier deal is the flatter of the two, and
 * a three-seat tier is wide enough (98–106 at the top) that the best entrants
 * came out UNDER their share. So: dealt, ranked, five a side.
 *
 * Everything here is a pure function of the cup's seed and the scores frozen
 * at the start. teamcup-api.js is the storage and the clock.
 */
import { Rng, hashStr } from './rng'
import type { PackKind } from './gacha'

export const TEAM_SIZE = 5
/** fewer teams than this is not a cup */
export const TEAM_CUP_MIN_TEAMS = 4
export const TEAM_CUP_MAX = 4000
/** Shanghai hours a cup starts at: four a day, none between 02:00 and 08:00, none on the solo cup's even hours */
export const TEAM_CUP_HOURS = [9, 13, 17, 21] as const
export const TEAM_CUP_STEP_SEC = 8 * 60
/** what every duel YOU win pays, whatever your team does */
export const TEAM_DUEL_COINS = 30

const SHANGHAI_MS = 8 * 3600_000
/** The start of the cup open for sign-up at `now` (ms): the next listed Shanghai hour strictly after it. */
export function teamCupSlot(now: number): number {
  const local = now + SHANGHAI_MS
  const day = Math.floor(local / 86_400_000) * 86_400_000
  for (let d = 0; d < 2; d++) {
    for (const h of TEAM_CUP_HOURS) {
      const at = day + d * 86_400_000 + h * 3600_000 - SHANGHAI_MS
      if (at > now) return at
    }
  }
  return day + 86_400_000 + TEAM_CUP_HOURS[0] * 3600_000 - SHANGHAI_MS
}
/** A local server's fast clock: a cup every `everyMs`. */
export const teamCupSlotFast = (now: number, everyMs: number): number => (Math.floor(now / everyMs) + 1) * everyMs
export const teamCupRoundAt = (starts: number, stepSec: number, round: number): number => starts + round * stepSec * 1000

export interface TeamEntrant { id: string; score: number }

/**
 * Deal the field into teams of TEAM_SIZE.
 *
 * Sorted by score, the field is cut into tiers of T (the number of teams): the
 * top T are everybody's first seat, the next T the second, and so on. Within a
 * tier the strongest goes to the team whose total is lowest so far, so the
 * totals level out tier by tier. The n mod 5 left over are a sixth member for
 * the weakest teams — a sixth member sits one tie in six out (teamLineup).
 * Ties in score and in totals are broken by the seed, never by sign-up order.
 */
export function dealTeams(field: TeamEntrant[], seed: number): string[][] {
  const T = Math.floor(field.length / TEAM_SIZE)
  if (T < 1) return []
  const rng = new Rng(hashStr(`team-cup-deal:${seed}`) >>> 0)
  // an entrant's tie-break is a hash of who they are, not of where they stand in the list
  const key = new Map(field.map((e) => [e.id, hashStr(`team-cup-key:${seed}:${e.id}`)]))
  const order = field.slice().sort((a, b) => b.score - a.score || key.get(a.id)! - key.get(b.id)!)
  const teams: string[][] = Array.from({ length: T }, () => [])
  const sum = teams.map(() => 0)
  const tieBreak = teams.map(() => rng.next())
  for (let lap = 0; lap * T < order.length; lap++) {
    const tier = order.slice(lap * T, (lap + 1) * T)
    const weakestFirst = teams.map((_, t) => t).sort((x, y) => sum[x] - sum[y] || tieBreak[x] - tieBreak[y])
    tier.forEach((e, k) => { teams[weakestFirst[k]].push(e.id); sum[weakestFirst[k]] += e.score })
  }
  return teams
}

/** The five a team fields in round `round`, strongest first. A sixth member takes turns on the bench. */
export function teamLineup(team: string[], scoreOf: (id: string) => number, seed: number, teamIndex: number, round: number): string[] {
  let members = team.slice()
  while (members.length > TEAM_SIZE) {
    const bench = (hashStr(`team-cup-bench:${seed}:${teamIndex}`) + round) % members.length
    members = members.filter((_, i) => i !== bench)
  }
  const key = (id: string) => hashStr(`team-cup-seat:${seed}:${id}`)
  return members.sort((a, b) => scoreOf(b) - scoreOf(a) || key(a) - key(b))
}

export interface TeamPairing { pairs: [number, number][]; byes: number[] }
/** Single elimination between teams; every bye is in the first round, as in the solo cup. */
export function pairTeamRound(alive: number[], seed: number, round: number): TeamPairing {
  const rng = new Rng(hashStr(`team-cup-draw:${seed}:${round}`) >>> 0)
  const order = alive.slice().sort((a, b) => a - b)
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rng.next() * (i + 1)); [order[i], order[j]] = [order[j], order[i]] }
  let p2 = 1
  while (p2 * 2 <= order.length) p2 *= 2
  const ties = order.length === p2 ? order.length / 2 : order.length - p2
  const pairs: [number, number][] = []
  for (let i = 0; i < ties; i++) pairs.push([order[2 * i], order[2 * i + 1]])
  return { pairs, byes: order.slice(ties * 2) }
}
/** How many rounds a field of `teams` takes: the first clears it down to a power of two. */
export const teamCupRounds = (teams: number): number => (teams < 2 ? 0 : Math.ceil(Math.log2(teams)))
export const teamDuelSeed = (seed: number, round: number, slot: number, duel: number): number =>
  hashStr(`team-cup-duel:${seed}:${round}:${slot}:${duel}`) >>> 0

export interface TeamPrize { coins: number; pack?: PackKind; count?: number }
/**
 * What a place pays EVERY member of the team, by how many teams entered. 1 champion, 2 finalist, 4 lost a
 * semi-final, 8 lost a quarter-final. The player's table (冠军不动、亚军两个选拔包、四强一个选拔包、八强一个
 * 试训包) at full size; a small field pays less, for the reason the solo cup's does. One kind of pack a
 * place, because a piece of mail carries one.
 */
export function teamCupPrize(teams: number, place: 1 | 2 | 4 | 8): TeamPrize {
  if (teams >= 32) {
    return place === 1 ? { coins: 500, pack: 'ten', count: 1 } : place === 2 ? { coins: 0, pack: 'elite', count: 2 }
      : place === 4 ? { coins: 0, pack: 'elite', count: 1 } : { coins: 0, pack: 'scout', count: 1 }
  }
  if (teams >= 16) {
    return place === 1 ? { coins: 300, pack: 'elite', count: 2 } : place === 2 ? { coins: 0, pack: 'elite', count: 1 }
      : place === 4 ? { coins: 0, pack: 'scout', count: 1 } : { coins: 0 }
  }
  if (teams >= 8) return place === 1 ? { coins: 200, pack: 'elite', count: 1 } : place === 2 ? { coins: 0, pack: 'scout', count: 1 } : { coins: 0 }
  return place === 1 ? { coins: 200, pack: 'scout', count: 1 } : { coins: 0 }
}
