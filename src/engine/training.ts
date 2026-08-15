import { Rng, clamp } from './rng'
import { INJURIES } from './content'
import { recomputeOverall, refreshValue, ageDrift } from './player'
import { coachOr } from './world'
import { ATTR_KEYS } from './types'
import type { Attrs, GameState, Player, Team } from './types'

/** One week of practice for a single player. */
function trainPlayer(state: GameState, p: Player, team: Team, rng: Rng): string | null {
  const focus = state.training[p.id] ?? 'rest'

  if (focus === 'rest') {
    p.fatigue = clamp(p.fatigue - rng.range(18, 30), 0, 100)
    p.morale = clamp(p.morale + rng.range(0.5, 2.5), 0, 100)
    p.form = clamp(p.form + rng.range(-1, 2), 30, 99)
    return null
  }

  const attr = focus as keyof Attrs
  const headroom = p.potential - p.overall
  if (headroom <= 0) {
    // at the ceiling: practice only holds form together
    p.fatigue = clamp(p.fatigue + rng.range(4, 9), 0, 100)
    p.form = clamp(p.form + rng.range(0, 2), 30, 99)
    return null
  }

  const coach = (coachOr(team, 'development') - 55) / 100
  const facility = (team.facilities - 55) / 130
  const age = p.age <= 20 ? 1.35 : p.age <= 23 ? 1.1 : p.age <= 26 ? 0.8 : 0.45
  const tired = p.fatigue > 70 ? 0.5 : p.fatigue > 45 ? 0.8 : 1
  const motivated = 0.75 + p.morale / 200

  const gain =
    rng.range(7, 16) * age * tired * motivated * (1 + coach + facility) *
    clamp(headroom / 12, 0.25, 1.6)

  p.xp[attr] = (p.xp[attr] ?? 0) + gain
  p.fatigue = clamp(p.fatigue + rng.range(5, 11), 0, 100)

  if ((p.xp[attr] ?? 0) >= 100) {
    p.xp[attr] = (p.xp[attr] ?? 0) - 100
    p.attrs[attr] = clamp(p.attrs[attr] + 1, 20, 99)
    const before = p.overall
    recomputeOverall(p)
    refreshValue(p)
    if (p.overall > before) return `${p.ign} 的能力值提升到 ${p.overall}。`
  }
  return null
}

/** Weekly tick: training, condition, morale drift, injury rolls. */
export function weeklyTick(state: GameState, rng: Rng): string[] {
  const notes: string[] = []
  for (const team of Object.values(state.teams)) {
    const isMine = team.id === state.myTeam
    for (const pid of team.roster) {
      const p = state.players[pid]
      if (!p) continue

      if (p.injuredUntil > state.day) {
        p.fatigue = clamp(p.fatigue - 8, 0, 100)
        p.morale = clamp(p.morale - 1.5, 0, 100)
        continue
      }

      if (isMine) {
        const note = trainPlayer(state, p, team, rng)
        if (note) notes.push(note)
      } else {
        // AI clubs train their weakest useful attribute
        const weakest = ATTR_KEYS
          .filter((k) => k !== 'igl' || p.isIgl)
          .reduce((a, b) => (p.attrs[a] < p.attrs[b] ? a : b))
        const saved = state.training[p.id]
        state.training[p.id] = weakest
        trainPlayer(state, p, team, rng)
        if (saved === undefined) delete state.training[p.id]
        else state.training[p.id] = saved
      }

      // form drifts back toward the player's true level
      const pull = (p.overall - p.form) * 0.06
      p.form = clamp(p.form + pull + rng.range(-3.5, 3.5), 30, 99)
      p.morale = clamp(p.morale + rng.range(-2, 2), 10, 100)

      // fatigue and heavy schedules cause injuries
      const risk = 0.004 + Math.max(0, p.fatigue - 55) * 0.0009 + Math.max(0, p.age - 27) * 0.002
      if (rng.chance(risk)) {
        const inj = rng.pick(INJURIES)
        const days = rng.int(inj.days[0], inj.days[1])
        p.injuredUntil = state.day + days
        p.injuryNote = inj.note
        p.morale = clamp(p.morale - 10, 0, 100)
        if (isMine) notes.push(`⚕️ ${p.ign} ${inj.note}，预计缺阵 ${days} 天。`)
      }
    }
  }
  return notes
}

/** Post-match wear on the players who actually played. */
export function applyMatchFatigue(state: GameState, teamId: string, mapsPlayed: number, rng: Rng) {
  for (const pid of state.teams[teamId]?.starters ?? []) {
    const p = state.players[pid]
    if (!p) continue
    p.fatigue = clamp(p.fatigue + mapsPlayed * rng.range(3.5, 6.5), 0, 100)
  }
}

/** End-of-season ageing: growth for prospects, decline for veterans. */
export function seasonRollover(state: GameState, rng: Rng): string[] {
  const notes: string[] = []
  for (const p of Object.values(state.players)) {
    p.age += 1
    const drift = ageDrift(p)
    const headroom = p.potential - p.overall

    for (const k of ATTR_KEYS) {
      if (drift > 0) {
        if (headroom > 0 && rng.chance(0.55 * drift)) {
          p.attrs[k] = clamp(p.attrs[k] + rng.int(0, 2), 20, 99)
        }
      } else if (rng.chance(Math.abs(drift) * 0.5)) {
        // aim and reaction go first
        const hit = k === 'aim' || k === 'reaction' ? 2 : 1
        p.attrs[k] = clamp(p.attrs[k] - rng.int(0, hit), 20, 99)
      }
    }
    // experience keeps rising even as the mechanics fade
    if (p.age >= 25) {
      p.attrs.awareness = clamp(p.attrs.awareness + (rng.chance(0.4) ? 1 : 0), 20, 99)
      if (p.isIgl) p.attrs.igl = clamp(p.attrs.igl + (rng.chance(0.5) ? 1 : 0), 20, 99)
    }

    const before = p.overall
    recomputeOverall(p)
    refreshValue(p)
    p.season = {
      maps: 0, rounds: 0, kills: 0, deaths: 0, assists: 0,
      firstKills: 0, firstDeaths: 0, damage: 0, clutches: 0, mvps: 0,
    }
    p.fatigue = clamp(p.fatigue - 40, 0, 100)
    p.injuredUntil = 0
    p.injuryNote = undefined

    if (p.teamId === state.myTeam) {
      if (p.overall - before >= 3) notes.push(`📈 ${p.ign} 赛季间进步明显：${before} → ${p.overall}`)
      if (before - p.overall >= 3) notes.push(`📉 ${p.ign} 状态下滑：${before} → ${p.overall}`)
    }
  }
  return notes
}
