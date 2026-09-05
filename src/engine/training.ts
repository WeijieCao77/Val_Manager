import { Rng, clamp } from './rng'
import { INJURIES } from './content'
import { recomputeOverall, refreshValue, ageDrift, weightsFor } from './player'
import { coachOr, squadOf } from './roster'
import { duoBonded, weeklyBonds } from './bonds'
import { analystEdge, staffBonus } from './staff'
import { weeklyTrust } from './trust'
import { growLoyalty } from './loyalty'
import { skillMod } from './manager'
import { AGENTS, MAPS, mapCn } from './content'
import { FAM_DRILL, learnComp } from './comp'
import { poolFor, sheetFor } from './match'
import { facilityCost } from './staff'
import { ATTR_KEYS } from './types'
import type { Attrs, GameState, Player, Role, Team, TeamDrill } from './types'

/**
 * The neutral point of the form scale.
 *
 * match.ts has always read form as a swing around 70 — `(p.form - 70) * 0.0028`
 * — and build_world derives a new save's starting form the same way, from this
 * season against the player's own career. Everything that moves form reverts
 * to this.
 */
export const FORM_BASE = 70

/** The shared load-management line used by both automatic plans. */
export const REST_AT = 45

/**
 * The most useful individual focus for this player's actual role.
 *
 * Overall is role-weighted, so "train the lowest raw number" is not neutral:
 * it sent duelists to communication (5% of their rating) instead of aim (28%).
 * The training screen's 「按位置分配」 and every AI club use this same
 * judgement — the heaviest attribute that still has somewhere to go, and
 * among equals the one he is worse at. A manager can still override it by
 * hand. Only the caller is ever pointed at 指挥, and anyone tired, hurt or
 * already at his ceiling is rested instead.
 */
export function recommendedTrainingFocus(p: Player): keyof Attrs | 'rest' {
  if (p.potential <= p.overall || p.fatigue >= REST_AT) return 'rest'
  const weights = weightsFor(p)
  const room = ATTR_KEYS.filter((k) => (k !== 'igl' || p.isIgl) && p.attrs[k] < 97)
  if (!room.length) return 'rest'
  return room.reduce((a, b) => {
    const d = weights[b] - weights[a]
    if (Math.abs(d) > 0.001) return d > 0 ? b : a
    return p.attrs[b] < p.attrs[a] ? b : a
  })
}

/**
 * A title makes rival clubs accelerate high-upside youngsters, not every
 * veteran and unattached player in the database. The boost is deliberately
 * bounded: coaching, facilities, age, morale and headroom remain the engine.
 */
export function aiGrowthMultiplier(state: GameState, p: Player, team: Team): number {
  const eligible = team.id !== state.myTeam && p.teamId === team.id &&
    p.age <= 23 && p.potential - p.overall >= 3
  if (!eligible) return 1
  return 1 + 0.10 * Math.min(Math.max(state.rivalry ?? 0, 0), 2)
}

/** One week of practice for a single player. */
function trainPlayer(state: GameState, p: Player, team: Team, rng: Rng): string | null {
  const focus = state.training[p.id] ?? 'rest'

  if (focus === 'rest') {
    // 体能: rest gives back more
    const heal = team.id === state.myTeam ? skillMod(state.manager, 'medical', 0.008) : 1
    p.fatigue = clamp(p.fatigue - rng.range(18, 30) * heal, 0, 100)
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

  // the staff behind the head coach count too
  const help = team.id === state.myTeam ? staffBonus(state, 'development') : 0
  const coach = (coachOr(team, 'development') - 55 + help) / 100
  const facility = (team.facilities - 55) / 130
  const age = p.age <= 20 ? 1.35 : p.age <= 23 ? 1.1 : p.age <= 26 ? 0.8 : 0.45
  const tired = p.fatigue > 70 ? 0.5 : p.fatigue > 45 ? 0.8 : 1
  const motivated = 0.75 + p.morale / 200

  const mine = team.id === state.myTeam
  // 训练 lifts everything; 带新人 only pays on players young enough to grow
  const talent = mine
    ? skillMod(state.manager, 'training') *
      (p.age <= 22 ? skillMod(state.manager, 'youth', 0.006) : 1)
    : 1
  const chasing = aiGrowthMultiplier(state, p, team)
  const gain =
    rng.range(7, 16) * age * tired * motivated * (1 + coach + facility) *
    clamp(headroom / 12, 0.25, 1.6) * available * talent * chasing

  // kept to a hundredth: the bar is a hundred to the point, and a float's
  // sixteen characters on every attribute of every player is what tipped a
  // two-season save over its budget once the whole league trained this way
  p.xp[attr] = Math.round(((p.xp[attr] ?? 0) + gain) * 100) / 100
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
  // The ceiling is checked here, not only in trainPlayer. Team drills and the
  // pair drill go through this path, and they used to walk a maxed player
  // several points past his own potential — the number the whole scouting and
  // transfer economy is priced on.
  if (p.overall >= p.potential) {
    p.xp[k] = Math.min(p.xp[k] ?? 0, 99)
    return false
  }
  p.xp[k] = Math.round(((p.xp[k] ?? 0) + amount) * 100) / 100
  if ((p.xp[k] ?? 0) < 100) return false
  p.xp[k] = Math.round(((p.xp[k] ?? 0) - 100) * 100) / 100
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
// ---------------------------------------------------------------- map comfort

/**
 * Comfort fades on a map nobody has touched.
 *
 * It only ever went up: a map run to 90 in preseason stayed at 90 through
 * two pool rotations and a whole year of never being picked, so by year
 * three a club knew every map perfectly and the drill had nothing left to
 * do. A month without a session, a scrim or a match on it and the number
 * starts to slide — slowly, a point a fortnight or so, and never below the
 * neutral 50 a fresh map starts at. Every club, ours included; the AI's
 * map weeks are chosen on the pool's weakest maps, so it keeps its pool up
 * the way a real team does and lets the benched maps go, as we all do.
 */
export const MAP_DECAY_AFTER = 28
export const MAP_DECAY_PER_WEEK = 0.6
export const MAP_DECAY_FLOOR = 50

/** Note that a map was run, scrimmed or played today. */
export function markMapSeen(team: Team, map: string, day: number): void {
  team.mapSeen = { ...(team.mapSeen ?? {}), [map]: day }
}

/** How many days since the club last touched this map; 0 when unknown. */
export const mapIdleDays = (team: Team, map: string, day: number): number =>
  team.mapSeen?.[map] == null ? 0 : Math.max(0, day - team.mapSeen[map])

function mapDecay(state: GameState, team: Team, notes: string[] | null): void {
  team.mapSeen ??= {}
  const started: string[] = []
  for (const m of MAPS) {
    const seen = team.mapSeen[m]
    // the clock starts the first time the tick looks at a map, so an older
    // save is not docked a year of neglect on the day it loads
    if (seen == null) { team.mapSeen[m] = state.day; continue }
    const idle = state.day - seen
    if (idle < MAP_DECAY_AFTER) continue
    const before = team.mapPrefs[m] ?? MAP_DECAY_FLOOR
    if (before <= MAP_DECAY_FLOOR) continue
    team.mapPrefs[m] = Math.max(MAP_DECAY_FLOOR, Math.round((before - MAP_DECAY_PER_WEEK) * 10) / 10)
    if (notes && idle < MAP_DECAY_AFTER + 7) started.push(mapCn(m))
  }
  if (notes && started.length) {
    notes.push(`🗺 ${started.join('、')} 已经四周没练也没打，熟练度开始回落（每周 −${MAP_DECAY_PER_WEEK}，最低 ${MAP_DECAY_FLOOR}）。`)
  }
}

/**
 * Run the confirmed plan once its seven days are up.
 *
 * The drill used to settle on the calendar week (day % 7) while the lock
 * lasted one turn — a single day in season. So the panel reopened every
 * morning, six days of picks were placebo, and only whatever was confirmed
 * last before the boundary counted. Now confirming starts a seven-day clock:
 * the lock IS the settlement date, the panel stays locked until it runs, and
 * tearing the plan up forfeits the progress and starts the count over.
 */
export function drillTick(state: GameState, rng: Rng, notes: string[]): void {
  if (state.drillLock == null || state.day < state.drillLock) return
  runDrill(state, rng, notes)
  state.drillLock = undefined
}

/**
 * What the numbers printed on the training cards get multiplied by.
 *
 * Exported because the panel has to be able to say how long something will
 * actually take, and a second copy of these three lines in the UI is how a
 * screen and its engine quietly stop agreeing. `dev` applies to every drill,
 * `review` on top of it to tape work only.
 */
/**
 * What one settled 复盘 is worth to the IGL's 指挥, in experience.
 *
 * It was a flat 7, which at ordinary coaching is nine or ten experience — one
 * point of 指挥 every eleven weeks, for a drill whose entire reason to exist is
 * that it is the only way to train the caller. Setting the same player's
 * personal focus to 指挥 was strictly better, so the headline feature of the
 * card was the weakest thing on it. That is what got reported.
 *
 * Bigger, and shaped: a manager who has just handed the armband to somebody is
 * teaching a man his job and the obvious ground goes quickly, while a veteran
 * caller at 90 is refining and does not. So the gain rides how far the player
 * is from being a finished IGL rather than sitting flat — which is also the
 * case that was reported, a converted IGL whose 指挥 started low.
 *
 * Measured: a caller in the fifties takes about two rounds a point, the
 * seventies about four, the high eighties about five, and the ceiling on the
 * curve is deliberately low enough that the fastest anyone learns is a point a
 * fortnight. A season of nothing but tape work takes a poor caller to an
 * average one; it cannot take an average one to a great one, and 指挥 buys
 * 0.09 of team rating a point, so a whole season of the training slot spent
 * here is worth about half a league place.
 */
const REVIEW_IGL_BASE = 36

export function reviewIglXp(state: GameState, p: Player): number {
  const rates = drillRates(state)
  const learning = clamp((90 - p.attrs.igl) / 18, 0.15, 1.5)
  return REVIEW_IGL_BASE * rates.dev * rates.review * learning
}

export function drillRates(state: GameState): { dev: number; review: number } {
  const team = state.teams[state.myTeam]
  if (!team) return { dev: 1, review: 1 }
  const coachDev = (coachOr(team, 'development') - 55 + staffBonus(state, 'development')) / 100
  const coachTac = (coachOr(team, 'tactics') - 55 + staffBonus(state, 'tactics')) / 100
  const facility = (team.facilities - 55) / 130
  return {
    dev: 1 + coachDev + facility,
    // 复盘专家: tape work is what an analyst is for
    review: (1 + coachTac) * (1 + analystEdge(state, 'review')),
  }
}

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

  const rates = drillRates(state)
  const gain = (base: number) => base * rates.dev * rng.range(0.8, 1.2)

  switch (drill.kind) {
    case 'map': {
      // Running a map raises comfort on it and pulls the side together. A
      // week has room for two maps, each at the full rate: the 7-map pool
      // turns over twice a season, and one map a week could not keep up.
      // 图池分析: a map specialist makes running the map worth far more
      const mapEdge = 1 + analystEdge(state, 'maps') * 0.6
      const maps = Array.from(new Set([drill.map, drill.map2].filter((m): m is string => !!m)))
      for (const map of maps) {
        const before = team.mapPrefs[map] ?? 50
        // kept as a float: rounding every week swallowed the whole bonus, since
        // +2.0 and +2.4 both land on +2 and the remainder never carried forward
        team.mapPrefs[map] = Math.round(clamp(before + gain(2.35) * mapEdge, 0, 95) * 10) / 10
        markMapSeen(team, map, state.day)
        // and the sheet planned for this map is what the week rehearses —
        // the five agents, not just the map. See engine/comp.ts.
        const fam = learnComp(state, map, sheetFor(state, state.myTeam, map).agents, FAM_DRILL)
        if (Math.round(team.mapPrefs[map]) > Math.round(before)) {
          notes.push(`🗺 ${mapCn(map)} 熟练度提升到 ${Math.round(team.mapPrefs[map])}，这套阵容熟练度 ${Math.round(fam)}。`)
        } else if (before >= 94.5) {
          notes.push(`🗺 ${mapCn(map)} 熟练度已到上限 95，继续跑图只能保持手感——换张图练吧。`)
        }
      }
      for (const p of squad) {
        addXp(p, 'teamwork', gain(9))
        addXp(p, 'awareness', gain(5))
        p.fatigue = clamp(p.fatigue + rng.range(3, 7), 0, 100)
      }
      break
    }
    case 'review': {
      // tape work is worth what the coach is worth
      for (const p of squad) {
        addXp(p, 'awareness', gain(6) * rates.review)
        // the rng lives here, so reviewIglXp is the expectation the card prints
        if (p.isIgl) addXp(p, 'igl', reviewIglXp(state, p) * rng.range(0.8, 1.2))
        addXp(p, 'communication', gain(3))
        p.fatigue = clamp(p.fatigue - rng.range(1, 4), 0, 100)
      }
      notes.push(team.coach ? `🎬 ${team.coach.name} 带队复盘，全队意识提升。` : '🎬 全队复盘录像。')
      break
    }
    case 'agent': {
      const p = state.players[drill.playerId]
      // A learner who was sold, released or retired kept being coached from
      // afar; one who is injured was coached from the treatment table. The
      // other drills all filter their squad — this one never did.
      if (!p || p.teamId !== state.myTeam) {
        state.drill = { kind: 'none' }
        notes.push('⚠️ 原定的「练新英雄」对象已经不在队中，本轮团队训练没有产生效果。')
        break
      }
      if (p.injuredUntil > state.day) {
        notes.push(`⚠️ ${p.ign} 伤停中，本轮「练新英雄」没有进行。`)
        break
      }
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

// ---------------------------------------------------------------- AI clubs

/**
 * The rest of a club's week, for the seventy-seven clubs the manager does
 * not run.
 *
 * They trained — one focus per player, the same plan the training screen
 * recommends — and did nothing else: no map week, no tape, nobody learning
 * a position the five was missing, nobody on the physio table, the same
 * building for ten years. Everything on the manager's training screen was
 * a lever only he could pull, so by the third season a club run by hand
 * walked over a league that had stood still — 「玩到后面只是单方面的碾压」.
 *
 * So a club now runs the same three-way choice every week, picked the way
 * a sensible coach would: a hole in the five gets a learner on it, an
 * uncomfortable pool gets run, otherwise the coach takes them through the
 * tape — with a map week every third week regardless, because the pool
 * turns over and real teams run maps. The numbers are the manager's own
 * drills' numbers at the club's own coaching and facilities; nothing here
 * is a rate he cannot reach. Pair work is left out: an AI room's bonds do
 * not decay, so there is nothing for it to mend.
 */
const CORE: Role[] = ['决斗者', '先锋', '控场', '哨卫']

/** Weeks between a club's team sessions: 1 is every week. */
export const AI_TEAM_SESSION_EVERY = 2
/** A club books the table for anyone this tired, if it can pay. */
export const AI_PHYSIO_AT = 68
/** What a club keeps in the bank before it spends on treatment. */
export const AI_PHYSIO_RESERVE: Record<number, number> = { 1: 600_000, 2: 120_000 }
/** What a club keeps in the bank after a winter's building work. */
export const AI_FACILITY_RESERVE: Record<number, number> = { 1: 1_200_000, 2: 250_000 }

/** The multipliers an AI club's drills run at: its coach and its building. */
function aiRates(team: Team): { dev: number; review: number } {
  const coachDev = (coachOr(team, 'development') - 55) / 100
  const coachTac = (coachOr(team, 'tactics') - 55) / 100
  const facility = (team.facilities - 55) / 130
  return { dev: 1 + coachDev + facility, review: 1 + coachTac }
}

/**
 * What this club would run this week. Exported so a check can ask the
 * same question the tick does.
 */
export function aiDrillFor(state: GameState, team: Team): TeamDrill {
  const five = team.starters
    .map((id) => state.players[id])
    .filter((p): p is Player => !!p)
  if (!five.length) return { kind: 'none' }
  // a five missing one of the four jobs pays for it on every map
  // (compositionScore in match.ts); the fix is a learner, as it is for us
  const covered = new Set(five.flatMap((p) => (p.roles?.length ? p.roles : [p.role])))
  const missing = CORE.find((r) => !covered.has(r))
  if (missing) {
    const fit = (p: Player) => p.attrs.awareness + p.attrs.utility + (p.flex ? 20 : 0)
    const learner = five
      .filter((p) => p.injuredUntil <= state.day && !p.isIgl && (p.rolePro?.[missing] ?? 0) < 100)
      .sort((a, b) => fit(b) - fit(a))[0]
    if (learner) return { kind: 'agent', playerId: learner.id, role: missing }
  }
  const pool = poolFor(state)
  const weak = pool.slice().sort((a, b) => (team.mapPrefs[a] ?? 50) - (team.mapPrefs[b] ?? 50))
  const low = team.mapPrefs[weak[0]] ?? 50
  const mean = pool.reduce((s, m) => s + (team.mapPrefs[m] ?? 50), 0) / Math.max(1, pool.length)
  const week = Math.floor(state.day / 7)
  if (low < 62 || mean < 70 || week % 3 === 0) return { kind: 'map', map: weak[0], map2: weak[1] }
  return { kind: 'review' }
}

export function aiClubWeek(state: GameState, team: Team, rng: Rng): void {
  const squad = squadOf(state, team.id).filter((p) => p.injuredUntil <= state.day)
  if (!squad.length) return
  const rates = aiRates(team)
  const gain = (base: number) => base * rates.dev * rng.range(0.8, 1.2)
  // the same bounded push a title provokes on a club's individual sessions
  // applies to its team sessions: a club chasing a champion coaches its
  // youth harder in everything it does, and only its youth
  const drilled = (p: Player, k: keyof Attrs, amount: number) =>
    addXp(p, k, amount * aiGrowthMultiplier(state, p, team))
  // A club does not run a team session every week of the year. The
  // off-season is the squad being rebuilt, and a week the room is worn out
  // is a week the session is called off — the load management the manager
  // does by hand when he rests his five. Both are also what keeps a league
  // of clubs drilling from arriving at its ceilings all at once.
  const worn = squad.reduce((s, p) => s + p.fatigue, 0) / squad.length > 60
  const off = Math.floor(state.day / 7) % AI_TEAM_SESSION_EVERY !== 0
  const drill = state.stage === 'offseason' || worn || off ? { kind: 'none' } as TeamDrill : aiDrillFor(state, team)
  switch (drill.kind) {
    case 'map': {
      for (const map of new Set([drill.map, drill.map2].filter((m): m is string => !!m))) {
        team.mapPrefs[map] = Math.round(clamp((team.mapPrefs[map] ?? 50) + gain(2.35), 0, 95) * 10) / 10
        markMapSeen(team, map, state.day)
      }
      for (const p of squad) {
        drilled(p, 'teamwork', gain(9))
        drilled(p, 'awareness', gain(5))
        p.fatigue = clamp(p.fatigue + rng.range(3, 7), 0, 100)
      }
      break
    }
    case 'review': {
      for (const p of squad) {
        drilled(p, 'awareness', gain(6) * rates.review)
        if (p.isIgl) {
          const learning = clamp((90 - p.attrs.igl) / 18, 0.15, 1.5)
          drilled(p, 'igl', REVIEW_IGL_BASE * rates.dev * rates.review * learning * rng.range(0.8, 1.2))
        }
        drilled(p, 'communication', gain(3))
        p.fatigue = clamp(p.fatigue - rng.range(1, 4), 0, 100)
      }
      break
    }
    case 'agent': {
      const p = state.players[drill.playerId]
      if (!p || p.teamId !== team.id) break
      const aptitude = 0.7 + (p.attrs.awareness + p.attrs.utility) / 400 + (p.flex ? 0.2 : 0)
      const before = p.rolePro?.[drill.role] ?? 0
      const now = clamp(before + gain(2.6) * aptitude, 0, 100)
      p.rolePro = { ...(p.rolePro ?? {}), [drill.role]: now }
      drilled(p, 'utility', gain(4))
      p.fatigue = clamp(p.fatigue + rng.range(3, 7), 0, 100)
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
        state.news.push({
          day: state.day, kind: 'player',
          text: `${team.tag} 的 ${p.ign} 练成了${drill.role}，现在可以兼任这个位置。`,
        })
      }
      break
    }
    default:
      break
  }

  // The physio room, at the same price we pay and on the same once-a-week
  // rule, for whoever is tired enough to be a risk — two a week, and never
  // below the reserve a club of that size keeps. Fatigue is the whole
  // injury model's gate, and it was a lever only the manager could pull.
  const reserve = AI_PHYSIO_RESERVE[team.tier] ?? AI_PHYSIO_RESERVE[1]
  let sessions = 0
  const tired = squadOf(state, team.id)
    .filter((p) => p.fatigue >= AI_PHYSIO_AT || (p.injuredUntil > state.day && p.injuredUntil - state.day >= 7))
    .sort((a, b) => b.fatigue - a.fatigue)
  for (const p of tired) {
    if (sessions >= 2) break
    const last = state.physioOn?.[p.id]
    if (last !== undefined && last <= state.day && state.day - last < 7) continue
    if (team.budget - PHYSIO_COST < reserve) break
    team.budget -= PHYSIO_COST
    state.physioOn = { ...(state.physioOn ?? {}), [p.id]: state.day }
    p.fatigue = clamp(p.fatigue - 35, 0, 100)
    if (p.injuredUntil > state.day) {
      const left = p.injuredUntil - state.day
      const cut = Math.max(2, Math.round(left * 0.3))
      p.injuredUntil = Math.max(state.day + 1, p.injuredUntil - cut)
    }
    sessions++
  }
}

/**
 * A winter's building work, at the same price list we pay from. Up to two
 * levels a year for a club that can afford them and still keep its reserve;
 * returns how many it bought, for the news.
 */
export function aiFacilityUpgrade(state: GameState, team: Team): number {
  if (team.id === state.myTeam) return 0
  const reserve = AI_FACILITY_RESERVE[team.tier] ?? AI_FACILITY_RESERVE[1]
  let bought = 0
  while (bought < 2 && team.facilities < 90) {
    const cost = facilityCost(team.facilities)
    if (team.budget - cost < reserve) break
    team.budget -= cost
    team.facilities = clamp(team.facilities + 1, 0, 95)
    bought++
  }
  return bought
}

/** Weekly tick: training, condition, morale drift, injury rolls. */
export function weeklyTick(state: GameState, rng: Rng): string[] {
  const notes: string[] = []
  weeklyBonds(state, rng, notes)
  weeklyTrust(state, rng, notes)
  const missed = Object.entries(state.commercialDays ?? {})
    .filter(([, d]) => d >= 2)
    .map(([id]) => state.players[id]?.ign)
    .filter(Boolean)
  if (missed.length) {
    notes.push(`📉 本周 ${missed.join('、')} 商务占用较多，训练收益明显下降。`)
  }
  for (const team of Object.values(state.teams)) {
    const isMine = team.id === state.myTeam
    for (const pid of team.roster) {
      const p = state.players[pid]
      if (!p) continue

      if (p.injuredUntil > state.day) {
        // an injured player is resting properly — send him back recovered, or
        // he returns at the same fatigue that got him hurt and goes straight
        // back on the table
        p.fatigue = clamp(p.fatigue - 15, 0, 100)
        p.morale = clamp(p.morale - 1.5, 0, 100)
        continue
      }

      if (isMine) {
        const note = trainPlayer(state, p, team, rng)
        if (note) notes.push(note)
      } else {
        // AI clubs follow the same role-aware plan the training screen offers
        // the manager, and rest the tired and the finished instead of
        // grinding every healthy player forever. It used to train whichever
        // raw number was lowest — a duelist on communication, worth a fifth of
        // a point of aim — so the world's clubs threw away half their
        // development for years. The plan is written into the same map as
        // the manager's, so a player arrives at a new club with his programme
        // visible; it is a pure function of the player, so it stays put
        // until the attribute has nowhere left to go.
        state.training[p.id] = recommendedTrainingFocus(p)
        trainPlayer(state, p, team, rng)
      }

      // A promised standing is a commitment. Bench a player you called a core
      // and the grievance builds until they want out; honour it and it fades.
      const promised = p.contract?.promisedRole
      if (promised) {
        const starting = team.starters.includes(p.id)
        const expects = promised === 'star' || promised === 'starter'
        if (expects && !starting) {
          // 更衣室: grievance builds slower when the manager handles people well
          const soothe = isMine ? 2 - skillMod(state.manager, 'locker', 0.006) : 1
          p.grievance = clamp((p.grievance ?? 0) + (promised === 'star' ? 7 : 4.5) * soothe, 0, 100)
          p.morale = clamp(p.morale - (promised === 'star' ? 3 : 2), 10, 100)
          if (isMine && (p.grievance ?? 0) > 55 && rng.chance(0.25) && !p.listed) {
            notes.push(`😠 ${p.ign} 对出场时间不满，已经在考虑离队（承诺是${promised === 'star' ? '核心' : '首发'}）。`)
          }
        } else {
          p.grievance = clamp((p.grievance ?? 0) - 3, 0, 100)
        }
      }

      // Form reverts to neutral, not to ability.
      //
      // It used to be pulled toward `overall`, which quietly turned it into a
      // second copy of ability: an 86-rated player settled at form 86 and drew
      // a permanent +4.5% from effectiveRating, a 60-rated one settled at 60
      // and carried -2.8% forever. Ability was being counted twice and form
      // stopped meaning "how he is playing lately". effectiveRating has always
      // measured it against 70; so does this.
      const pull = (FORM_BASE - p.form) * 0.06
      p.form = clamp(p.form + pull + rng.range(-3.5, 3.5), 30, 99)
      p.morale = clamp(p.morale + rng.range(-2, 2), 10, 100)

      // fatigue and heavy schedules cause injuries
      // 体能: fewer injuries under a manager who manages load
      // The load term used to start at 55, which fatigue almost never reached,
      // so in practice only the flat 0.004 ever fired — 0.9 injuries a season
      // across a whole squad. It now starts inside the band a working squad
      // actually occupies (settled p50 34, p90 48).
      // Condition is the gate: under 45 fatigue a player is essentially safe,
      // and age only taxes the already-tired. Whoever just came off the
      // physio table is being watched — a quarter of the normal risk for two
      // weeks — because "he pulled the same wrist twice in a month" was the
      // single most reported way this system felt unfair.
      const load = Math.max(0, p.fatigue - 45) / 55
      const grace = p.injuredUntil > 0 && state.day - p.injuredUntil < 14 ? 0.25 : 1
      const risk = (0.001 + load * (0.018 + Math.max(0, p.age - 27) * 0.002)) * grace *
        (isMine ? 2 - skillMod(state.manager, 'medical', 0.008) : 1)
      if (rng.chance(risk)) {
        const inj = rng.pick(INJURIES)
        const days = rng.int(inj.days[0], inj.days[1])
        p.injuredUntil = state.day + days
        p.injuryNote = inj.note
        p.morale = clamp(p.morale - 10, 0, 100)
        // An injured man rests. The training screen greys his plan out, so the
        // manager cannot set this himself — and the weekly trust tick used to
        // dock him 0.8 for "being used while hurt" regardless.
        state.training[p.id] = 'rest'
        if (isMine) notes.push(`⚕️ ${p.ign} ${inj.note}，预计缺阵 ${days} 天。`)
      }

      // Everyone recovers every week, not only the ones told to rest.
      //
      // Without this there was no equilibrium and no dial: a squad set to
      // train every week sat pinned at 100 fatigue (-16% on every player) and
      // one left resting sat at 10. Recovery scales with how tired they are, so
      // a normal plan settles in the fifties — where the injury curve and the
      // condition penalty both start to bite, and resting a man is a decision
      // rather than the only survivable setting.
      const care = isMine ? skillMod(state.manager, 'medical', 0.008) : 1
      p.fatigue = clamp(p.fatigue - (p.fatigue * 0.30 + 5) * care, 0, 100)
    }
    // and the club's week: the drill, and the treatment room. Ours runs its
    // own through drillTick and the physio button.
    if (!isMine) aiClubWeek(state, team, rng)
    // then the maps nobody touched this month slip a little
    mapDecay(state, team, isMine ? notes : null)
  }
  // the week has been settled, so commercial time starts over
  state.commercialDays = {}
  return notes
}

/** Post-match wear on the players who actually played. */
/**
 * The cost of having played, charged to the people who played.
 *
 * It used to walk `starters` — the names on the teamsheet — but selectLineup
 * drops anyone injured and brings a substitute in, and nothing writes that
 * back. So a player sat out hurt was charged the fatigue of a bo5 he never
 * appeared in, while the man who actually played it was charged nothing and
 * was exempt from the injury roll besides. Being hurt made you more tired than
 * playing, and rotation was free. Measured over one season: 79 injured players
 * charged for matches they missed, 845 substitutes charged for matches they
 * played.
 */
export function applyMatchFatigue(
  state: GameState, teamId: string, mapsPlayed: number, rng: Rng,
  notes?: string[], played?: string[],
) {
  const isMine = teamId === state.myTeam
  for (const pid of played?.length ? played : state.teams[teamId]?.starters ?? []) {
    const p = state.players[pid]
    if (!p) continue
    p.fatigue = clamp(p.fatigue + mapsPlayed * rng.range(3.5, 6.5), 0, 100)

    // A squad used to see 0.9 injuries a season, because the only roll was the
    // weekly one and it did not care whether anyone had played. Playing a bo5
    // at 90 fatigue should be the risk it looks like — so the match itself now
    // rolls, and it is the tired who get hurt rather than everyone equally.
    if (p.injuredUntil > state.day) continue
    const load = Math.max(0, p.fatigue - 40) / 60           // 0 at 40, 1 at 100
    const grace = p.injuredUntil > 0 && state.day - p.injuredUntil < 14 ? 0.25 : 1
    const risk = (0.002 + load * 0.026) * (mapsPlayed / 3) * grace *
      (isMine ? 2 - skillMod(state.manager, 'medical', 0.008) : 1)
    if (!rng.chance(risk)) continue
    const inj = rng.pick(INJURIES)
    const days = rng.int(inj.days[0], inj.days[1])
    p.injuredUntil = state.day + days
    p.injuryNote = inj.note
    p.morale = clamp(p.morale - 10, 0, 100)
    state.training[p.id] = 'rest'
    if (isMine) notes?.push(`⚕️ ${p.ign} 赛后${inj.note}，预计缺阵 ${days} 天。`)
  }
}

/** End-of-season ageing: growth for prospects, decline for veterans. */
export function seasonRollover(state: GameState, rng: Rng): string[] {
  const notes: string[] = []
  const small: string[] = []
  // Another season served, at every club in the world. League-wide on purpose:
  // ours alone would slowly become unpoachable while everybody else's stayed
  // as easy to raid as on day one.
  growLoyalty(state)
  for (const p of Object.values(state.players)) {
    const seasonAge = p.age
    p.age += 1
    // Scouts re-rate the young every winter. A prospect who has nearly caught
    // his projection sometimes turns out to have been under-rated — that is
    // where next season's headroom comes from, for the AI's academy kids and
    // the player's alike. Rivalry makes the rest of the world's kids likelier
    // to be pushed: clubs chasing a champion coach their youth harder.
    const playedEnough = p.season.maps >= 10 || p.season.rounds >= 200
    const revisions = p.potentialRevisions ?? 0
    if (p.teamId && seasonAge <= 23 && playedEnough && revisions < 2 &&
        p.potential - p.overall < 4 && p.potential < 97) {
      const pressure = p.teamId !== state.myTeam
        ? Math.min(Math.max(state.rivalry ?? 0, 0), 2)
        : 0
      if (rng.chance(0.28 + pressure * 0.08)) {
        p.potential = clamp(p.potential + rng.int(1, 2), p.potential, 99)
        p.potentialRevisions = revisions + 1
      }
    }
    const drift = ageDrift(p)
    // Captured before a single attribute moves. It used to sit further down,
    // which was fine while recomputeOverall was called exactly once at the
    // bottom — the moment the growth loop started recomputing as it went, a
    // late reading made the winter's growth invisible in the digest, and
    // audit_feedback.ts caught it as 「2 silent days」.
    const before = p.overall

    for (const k of ATTR_KEYS) {
      if (drift > 0) {
        // Live headroom, re-read after every bump rather than measured once
        // before the loop. Nine attributes each rolling up to +2 against a
        // single stale reading walked a player straight past his own ceiling.
        if (p.overall < p.potential && rng.chance(0.55 * drift)) {
          p.attrs[k] = clamp(p.attrs[k] + rng.int(0, 2), 20, 99)
          recomputeOverall(p)
        }
      } else if (rng.chance(Math.abs(drift) * 0.5)) {
        // aim and reaction go first
        const hit = k === 'aim' || k === 'reaction' ? 2 : 1
        p.attrs[k] = clamp(p.attrs[k] - rng.int(0, hit), 20, 99)
      }
    }
    // Experience keeps rising even as the mechanics fade — but not past the
    // ceiling either. This pair asked nothing about potential at all, so a
    // veteran gained 意识 (and 指挥, if he called) every winter forever: one
    // player a season finished above his own projection, which reads as
    // 「成长空间 +-1」 on the training screen and quietly bricks him, because
    // addXp refuses to work on anybody at his ceiling. Read after the decline
    // above, so a fading veteran still trades aim for reading the game.
    recomputeOverall(p)
    if (p.age >= 25 && p.overall < p.potential) {
      p.attrs.awareness = clamp(p.attrs.awareness + (rng.chance(0.4) ? 1 : 0), 20, 99)
      if (p.isIgl) p.attrs.igl = clamp(p.attrs.igl + (rng.chance(0.5) ? 1 : 0), 20, 99)
    }

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
      else if (before - p.overall >= 3) notes.push(`📉 ${p.ign} 状态下滑：${before} → ${p.overall}`)
      else if (p.overall !== before) small.push(`${p.ign} ${before}→${p.overall}`)
    }
  }
  // A one-point move is not worth a line of its own, but a winter in which
  // seven players quietly shifted is worth knowing about — it was invisible
  // before, and the squad screen shows no history to compare against.
  if (small.length) notes.push(`📊 其余小幅变化：${small.join('、')}`)
  return notes
}

/** What one physio session costs. Money, not action points — it is upkeep. */
export const PHYSIO_COST = 8000

/**
 * A paid physio session for one player.
 *
 * Fatigue is the whole injury model's gate, so this is the lever the players
 * asked for by name: pay a little, get condition back. It also shaves an
 * active injury — treatment shortens recovery, it does not skip it. Once a
 * week per player, because a credit card is not a medical staff.
 */
export function physioBlock(state: GameState, pid: string): string | null {
  const p = state.players[pid]
  if (!p || p.teamId !== state.myTeam) return '他不是我们的人。'
  const last = state.physioOn?.[pid]
  // a booking recorded after today is a leftover from before the calendar
  // reset — stale, not binding
  if (last !== undefined && last <= state.day && state.day - last < 7) {
    return `本周已做过理疗（${7 - (state.day - last)} 天后可再约）。`
  }
  if (state.finances.balance < PHYSIO_COST) return '资金不足。'
  return null
}

export function doPhysio(state: GameState, pid: string): string | null {
  if (physioBlock(state, pid)) return null
  const p = state.players[pid]
  state.finances.balance -= PHYSIO_COST
  state.finances.log.push({ day: state.day, label: `理疗 · ${p.ign}`, amount: -PHYSIO_COST })
  state.physioOn = { ...(state.physioOn ?? {}), [pid]: state.day }
  p.fatigue = clamp(p.fatigue - 35, 0, 100)
  if (p.injuredUntil > state.day) {
    const left = p.injuredUntil - state.day
    const cut = Math.max(2, Math.round(left * 0.3))
    p.injuredUntil = Math.max(state.day + 1, p.injuredUntil - cut)
    return `${p.ign} 完成理疗：体能恢复，伤情好转，预计提前 ${cut} 天复出。`
  }
  return `${p.ign} 完成理疗：体能大幅恢复。`
}
