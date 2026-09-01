/**
 * Reading a roster out of a state you already have.
 *
 * These were in world.ts, which meant that importing either of them imported
 * the whole world — 518 players — to run four lines that touch none of it.
 * endings.ts wanted `squadOf` and nothing else, and paid 370 KB for it, and so
 * did the front page that imports endings.ts for a single integer.
 */
import type { GameState, Player, Team } from './types'

export const squadOf = (state: GameState, teamId: string): Player[] =>
  (state.teams[teamId]?.roster ?? [])
    .map((id) => state.players[id])
    .filter((p): p is Player => !!p)

export const freeAgents = (state: GameState): Player[] =>
  Object.values(state.players).filter((p) => p.teamId === null)

/** A club's coaching quality, standing in for the ones with no real coach on record. */
export const coachOr = (t: Team, k: 'tactics' | 'development' | 'motivation'): number =>
  t.coach ? t.coach[k] : Math.max(30, t.rating - 12)

export const wageBill = (state: GameState, teamId: string): number =>
  squadOf(state, teamId).reduce((s, p) => s + p.salary, 0) +
  // a coach the manager hired is paid like everyone else
  (state.teams[teamId]?.coach?.salary ?? 0) +
  // assistants and analysts are on the payroll too, for our club only
  (teamId === state.myTeam
    ? (state.staff ?? []).reduce((s, m) => s + m.salary, 0)
    : 0)
