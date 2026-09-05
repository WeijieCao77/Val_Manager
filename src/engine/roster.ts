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

/**
 * Who calls for a club, among these players (the whole squad by default).
 *
 * A club can hold two or three callers by trade — TEC calls through
 * Haodong and lucas, T1 through Munchkin and stax — and until now the
 * loudest of them (highest igl attribute) called with no way to choose:
 * the squad screen offered 任命 only to a man who was not flagged, so with
 * two IGLs the button vanished. The club names one main caller (team.igl,
 * 主指挥); the others are deputies (副指挥) who keep their flag and step
 * in when the main is off the server — hurt, benched, sold. Nothing stacks.
 */
export function callerOf(state: GameState, teamId: string, among?: Player[]): Player | undefined {
  const team = state.teams[teamId]
  // asked about a five on the server, a hurt man does not call — an injured
  // filler plays at −22% and calls nothing, which is the rule the squad
  // screen's warning was written to; asked about the squad, he is still the
  // club's main caller, only unavailable
  const pool = among ? among.filter((p) => p.injuredUntil <= state.day) : squadOf(state, teamId)
  const main = team?.igl ? pool.find((p) => p.id === team.igl && p.isIgl) : undefined
  if (main) return main
  return pool.filter((p) => p.isIgl).sort((a, b) => b.attrs.igl - a.attrs.igl)[0]
}
