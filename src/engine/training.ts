import { Rng, clamp } from './rng'
import { INJURIES } from './content'
import { recomputeOverall, refreshValue, ageDrift } from './player'
import { coachOr, squadOf } from './world'
import { duoBonded, weeklyBonds } from './bonds'
import { AGENTS } from './content'
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
  // days spent on commercial work are days not spent practising
  const booked = state.commercialDays?.[p.id] ?? 0
  const available = clamp(1 - booked * 0.25, 0, 1)
  if (available <= 0) {
    p.form = clamp(p.form - rng.range(0, 2), 30, 99)
    return null
  }
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
    clamp(headroom / 12, 0.25, 1.6) * available

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

/** Add progress toward an attribute, converting a full bar into a point. */
function addXp(p: Player, k: keyof Attrs, amount: number): boolean {
  p.xp[k] = (p.xp[k] ?? 0) + amount
  if ((p.xp[k] ?? 0) < 100) return false
  p.xp[k] = (p.xp[k] ?? 0) - 100
  p.attrs[k] = clamp(p.attrs[k] + 1, 20, 99)
  recomputeOverall(p)
  refreshValue(p)
  return true
}

/**
 * Two players staying behind to drill together.
 *
 * Runs alongside the main session rather than instead of it: a pair working on
 * trades does not stop the other three doing anything. It costs those two extra
 * condition, which is the trade-off.
 */
function runDuo(state: GameState, team: Team, rng: Rng): void {
  const duo = state.duo
  if (!duo) return
  const coachDev = (coachOr(team, 'development') - 55) / 100
  const facility = (team.facilities - 55) / 130
  const gain = (base: number) => base * (1 + coachDev + facility) * rng.range(0.8, 1.2)

  for (const id of [duo.a, duo.b]) {
    const p = state.players[id]
    if (!p || p.teamId !== team.id || p.injuredUntil > state.day) continue
    addXp(p, 'teamwork', gain(10))
    addXp(p, 'communication', gain(8))
    addXp(p, 'reaction', gain(5))
    p.fatigue = clamp(p.fatigue + rng.range(5, 10), 0, 100)
    p.morale = clamp(p.morale + rng.range(0, 2), 0, 100)
  }
  // the direct lever on a feud: make the two of them work together
  duoBonded(state, duo.a, duo.b, rng.range(3, 6))
}

/**
 * The squad-wide drill for this week.
 *
 * Each of these moves several things at once, which is the point: a team does
 * not improve by everyone grinding one stat in isolation.
 */
function runDrill(state: GameState, rng: Rng, notes: string[]): void {
  const team = state.teams[state.myTeam]
  if (!team) return
  runDuo(state, team, rng)
  const drill = state.drill
  if (!drill || drill.kind === 'none') return
  const squad = squadOf(state, state.myTeam).filter(
    (p) => p.injuredUntil <= state.day && (state.commercialDays?.[p.id] ?? 0) < 4,
  )
  if (!squad.length) return

  const coachDev = (coachOr(team, 'development') - 55) / 100
  const coachTac = (coachOr(team, 'tactics') - 55) / 100
  const facility = (team.facilities - 55) / 130
  const gain = (base: number) => base * (1 + coachDev + facility) * rng.range(0.8, 1.2)

  switch (drill.kind) {
    case 'map': {
      // running one map raises comfort on it and pulls the side together
      const before = team.mapPrefs[drill.map] ?? 50
      // comfort climbs, but not to mastery in a single split
      team.mapPrefs[drill.map] = Math.round(clamp(before + gain(1.8), 0, 95))
      for (const p of squad) {
        addXp(p, 'teamwork', gain(9))
        addXp(p, 'awareness', gain(5))
        p.fatigue = clamp(p.fatigue + rng.range(3, 7), 0, 100)
      }
      if (team.mapPrefs[drill.map] > before) {
        notes.push(`🗺 ${drill.map} 熟练度提升到 ${team.mapPrefs[drill.map]}。`)
      }
      break
    }
    case 'review': {
      // tape work is worth what the coach is worth
      for (const p of squad) {
        addXp(p, 'awareness', gain(6) * (1 + coachTac))
        if (p.isIgl) addXp(p, 'igl', gain(7) * (1 + coachTac))
        addXp(p, 'communication', gain(3))
        p.fatigue = clamp(p.fatigue - rng.range(1, 4), 0, 100)
      }
      notes.push(team.coach ? `🎬 ${team.coach.name} 带队复盘，全队意识提升。` : '🎬 全队复盘录像。')
      break
    }
    case 'agent': {
      const p = state.players[drill.playerId]
      if (!p) break
      // Learning a position is a grind, not a switch. A quick learner still
      // needs the better part of a season, which is what makes buying a real
      // specialist worth the money.
      const aptitude = 0.7 + (p.attrs.awareness + p.attrs.utility) / 400 + (p.flex ? 0.2 : 0)
      const before = p.rolePro?.[drill.role] ?? 0
      const now = clamp(before + gain(2.6) * aptitude, 0, 100)
      p.rolePro = { ...(p.rolePro ?? {}), [drill.role]: now }
      addXp(p, 'utility', gain(4))
      p.fatigue = clamp(p.fatigue + rng.range(3, 7), 0, 100)

      // agents come in along the way, so progress is visible before it pays off
      const earned = Math.floor(now / 34) - Math.floor(before / 34)
      for (let i = 0; i < earned; i++) {
        const pool = AGENTS[drill.role].filter((a) => !p.agentPool.includes(a))
        if (pool.length) p.agentPool = [...p.agentPool, rng.pick(pool)]
      }
      if (now >= 100 && before < 100) {
        const roles = p.roles?.length ? p.roles : [p.role]
        if (!roles.includes(drill.role)) {
          p.roles = [...roles, drill.role]
          p.flex = true
        }
        notes.push(`🎓 ${p.ign} 练成了${drill.role}，现在可以兼任这个位置。`)
        state.drill = { kind: 'none' }
      }
      break
    }
    default:
      break
  }
}

/** Weekly tick: training, condition, morale drift, injury rolls. */
export function weeklyTick(state: GameState, rng: Rng): string[] {
  const notes: string[] = []
  runDrill(state, rng, notes)
  weeklyBonds(state, rng, notes)
  const missed = Object.entries(state.commercialDays ?? {})
    .filter(([, d]) => d >= 2)
    .map(([id]) => state.players[id]?.ign)
    .filter(Boolean)
  if (missed.length) {
    notes.push(`📉 本周 ${missed.join('、')} 商务占用较多，训练收益明显下降。`)
  }
  // the plan has now been run, so next week's is open to change again
  state.drillLock = undefined
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

      // A promised standing is a commitment. Bench a player you called a core
      // and the grievance builds until they want out; honour it and it fades.
      const promised = p.contract?.promisedRole
      if (promised) {
        const starting = team.starters.includes(p.id)
        const expects = promised === 'star' || promised === 'starter'
        if (expects && !starting) {
          p.grievance = clamp((p.grievance ?? 0) + (promised === 'star' ? 7 : 4.5), 0, 100)
          p.morale = clamp(p.morale - (promised === 'star' ? 3 : 2), 10, 100)
          if (isMine && (p.grievance ?? 0) > 55 && rng.chance(0.25) && !p.listed) {
            notes.push(`😠 ${p.ign} 对出场时间不满，已经在考虑离队（承诺是${promised === 'star' ? '核心' : '首发'}）。`)
          }
        } else {
          p.grievance = clamp((p.grievance ?? 0) - 3, 0, 100)
        }
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
  // the week has been settled, so commercial time starts over
  state.commercialDays = {}
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
