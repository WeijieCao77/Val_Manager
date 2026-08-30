/**
 * Which agent each player is on, and what it costs to be on the wrong one.
 *
 * Agents were decoration until now: `agentPool` recorded what a real player
 * actually plays and the 练新英雄 drill grew `rolePro`, but nothing in the
 * match ever read either. This is the layer that makes the pick matter.
 *
 * A player is judged on the JOB, not the character model. Put a duelist on a
 * controller and the site does not get smoked — that is the −12% he plays at.
 * Being on an agent he has actually played, rather than merely one from his
 * own role, is worth a little on top.
 */
import { AGENT_ROLE, AGENTS, MAP_META, agentCn } from './content'
import type { GameState, Player, Role } from './types'

/** How far off his job an agent puts a player: 1 = right at home, 0 = lost. */
export function agentFit(p: Player, agent: string | undefined): number {
  if (!agent) return 1
  const need = AGENT_ROLE[agent]
  if (!need) return 1
  const covers = p.roles ?? [p.role]
  // his own job, or a second one he is listed for
  if (covers.includes(need)) return 1
  // 自由人 in this data means "vlr never recorded a position", not "has none".
  // Everything else in the engine treats such a player as able to plug any
  // hole — autoStarters, the composition score — and the house rule is that
  // missing data is never a penalty. He plays anything without complaint.
  if (covers.includes('自由人')) return 1
  // a job he has been drilled into. 练新英雄 finally pays outside the training
  // screen: at 100% he plays the position as if it were his own.
  return Math.min(1, (p.rolePro?.[need] ?? 0) / 100)
}

/** What playing out of position costs a player, at worst. */
export const OFF_ROLE = 0.12

/**
 * The multiplier a player's rating takes for the agent he is on.
 *
 * The JOB is the whole of it. There was also a −3% for a character outside his
 * recorded pool, and it had to go: `agentPool` is scraped from what vlr
 * happened to record, the training screen drills POSITIONS rather than
 * individual agents, and so a manager had no way at all to remove that
 * penalty — monk on Omen was worse than monk on Brimstone with nothing he
 * could ever do about it. A cost the player cannot answer is not a decision.
 */
export function agentMod(p: Player, agent: string | undefined): number {
  return 1 - (1 - agentFit(p, agent)) * OFF_ROLE
}

/** Is this agent one the manager should be warned about for this player? */
export function agentWarn(p: Player, agent: string): string | null {
  const fit = agentFit(p, agent)
  if (fit >= 1) return null
  const loss = Math.round((1 - agentMod(p, agent)) * 100)
  const need = AGENT_ROLE[agent]
  const trained = Math.round(p.rolePro?.[need] ?? 0)
  return trained > 0
    ? `${p.ign} 的${need}只练到 ${trained}%，上${agentCn(agent)}大约 −${loss}%`
    : `${p.ign} 不是${need}，上${agentCn(agent)}大约 −${loss}%`
}

/**
 * Fill a five automatically: the map's usual agents, handed to whoever can
 * actually play them.
 *
 * Role first, meta order second. A lineup built this way never carries an
 * out-of-position pick unless the five itself has a hole in it.
 */
/**
 * Assign the four jobs to four different players, covering as many as the
 * squad actually can.
 *
 * Greedy in a fixed order is not good enough: if one man is the only
 * controller AND the only sentinel, taking him for the first leaves the second
 * to somebody who cannot play it, while a different assignment would have
 * covered both. This is the standard augmenting-path matching — four roles
 * against five players is tiny, and it is the difference between an automatic
 * sheet that is optimal and one that merely looks reasonable.
 */
function matchRoles(five: Player[], roles: Role[]): Map<Role, Player> {
  const covers = (p: Player) => p.roles ?? [p.role]
  const byRole = new Map<Role, Player>()
  const takenBy = new Map<string, Role>()

  const tryAssign = (role: Role, seen: Set<string>): boolean => {
    for (const p of five) {
      if (seen.has(p.id) || !covers(p).includes(role)) continue
      seen.add(p.id)
      const holder = takenBy.get(p.id)
      if (!holder || tryAssign(holder, seen)) {
        byRole.set(role, p)
        takenBy.set(p.id, role)
        return true
      }
    }
    return false
  }
  for (const r of roles) tryAssign(r, new Set())
  return byRole
}

export function autoAgents(
  state: GameState, teamId: string, five: Player[], map: string,
): Record<string, string> {
  const meta = MAP_META[map] ?? []
  const out: Record<string, string> = {}
  const used = new Set<string>()
  const taken = new Set<string>()
  const covers = (p: Player) => p.roles ?? [p.role]

  // Cover the four jobs first, then fill. A comp is a set of jobs, not a
  // ranking, so who plays what is decided by matching before any agent is
  // handed out.
  const CORE: Role[] = ['控场', '哨卫', '先锋', '决斗者']
  const matched = matchRoles(five, CORE)

  for (const role of CORE) {
    const man = matched.get(role)
      // nobody whose job it is: the one furthest into learning it, and failing
      // that whoever is left. A side always has someone on smokes, even when
      // the roster has no controller — that is what the −12% is for.
      ?? five.filter((p) => !taken.has(p.id))
        .sort((x, y) => (y.rolePro?.[role] ?? 0) - (x.rolePro?.[role] ?? 0))[0]
    if (!man || taken.has(man.id)) continue
    const agent = meta.find((a) => !used.has(a) && AGENT_ROLE[a] === role && man.agentPool.includes(a))
      ?? meta.find((a) => !used.has(a) && AGENT_ROLE[a] === role)
      ?? (AGENTS[role] ?? []).find((a) => !used.has(a))
    if (!agent) continue
    out[man.id] = agent
    used.add(agent)
    taken.add(man.id)
  }

  // and the fifth, on whatever suits him best out of what the map plays
  for (const p of five) {
    if (taken.has(p.id)) continue
    const mine = covers(p)
    const pick =
      meta.find((a) => !used.has(a) && mine.includes(AGENT_ROLE[a]) && p.agentPool.includes(a))
      ?? meta.find((a) => !used.has(a) && mine.includes(AGENT_ROLE[a]))
      ?? p.agentPool.find((a) => !used.has(a) && mine.includes(AGENT_ROLE[a]))
      ?? mine.flatMap((r) => AGENTS[r] ?? []).find((a) => !used.has(a))
      ?? meta.find((a) => !used.has(a))
    if (pick) { out[p.id] = pick; used.add(pick); taken.add(p.id) }
  }
  void state; void teamId
  return out
}

/**
 * A sheet with nobody missing and nobody doubled.
 *
 * The pre-match screen swaps rather than overwrites, so it cannot produce
 * either — but a hand-edited save, or a five that changed after the sheet was
 * made, can. Anyone left without an agent is given one his role can play.
 */
export function normalizeAgents(
  state: GameState, teamId: string, five: Player[], map: string,
  picks: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {}
  const used = new Set<string>()
  for (const p of five) {
    const want = picks[p.id]
    if (want && !used.has(want)) { out[p.id] = want; used.add(want) }
  }
  const missing = five.filter((p) => !out[p.id])
  if (!missing.length) return out
  const fallback = autoAgents(state, teamId, missing, map)
  for (const p of missing) {
    const covers = p.roles ?? [p.role]
    const pick = (!used.has(fallback[p.id]) ? fallback[p.id] : undefined)
      ?? covers.flatMap((r) => AGENTS[r] ?? []).find((a) => !used.has(a))
      ?? (MAP_META[map] ?? []).find((a) => !used.has(a))
    if (pick) { out[p.id] = pick; used.add(pick) }
  }
  return out
}

/** The roles a five is missing once every agent is assigned. */
export const agentRoleGaps = (five: Player[], picks: Record<string, string>): Role[] => {
  const have = new Set(five.map((p) => AGENT_ROLE[picks[p.id]]).filter(Boolean))
  return (['决斗者', '先锋', '控场', '哨卫'] as Role[]).filter((r) => !have.has(r))
}
