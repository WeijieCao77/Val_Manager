import { Rng, clamp } from './rng'
import { INJURIES } from './content'
import { recomputeOverall, refreshValue, ageDrift } from './player'
import { coachOr, squadOf } from './roster'
import { duoBonded, weeklyBonds } from './bonds'
import { analystEdge, staffBonus } from './staff'
import { weeklyTrust } from './trust'
import { skillMod } from './manager'
import { AGENTS } from './content'
import { ATTR_KEYS } from './types'
import type { Attrs, GameState, Player, Team } from './types'

/**
 * The neutral point of the form scale.
 *
 * match.ts has always read form as a swing around 70 — `(p.form - 70) * 0.0028`
 * — and build_world derives a new save's starting form the same way, from this
 * season against the player's own career. Everything that moves form reverts
 * to this.
 */
export const FORM_BASE = 70

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
  // once the player's club has taken a world title, everyone else trains like
  // they mean it — the gap the trophy proved is the gap they are closing
  const chasing = mine ? 1 : 1 + 0.22 * Math.min(state.rivalry ?? 0, 2)
  const gain =
    rng.range(7, 16) * age * tired * motivated * (1 + coach + facility) *
    clamp(headroom / 12, 0.25, 1.6) * available * talent * chasing

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
  // The ceiling is checked here, not only in trainPlayer. Team drills and the
  // pair drill go through this path, and they used to walk a maxed player
  // several points past his own potential — the number the whole scouting and
  // transfer economy is priced on.
  if (p.overall >= p.potential) {
    p.xp[k] = Math.min(p.xp[k] ?? 0, 99)
    return false
  }
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
      // running one map raises comfort on it and pulls the side together
      const before = team.mapPrefs[drill.map] ?? 50
      // comfort climbs, but not to mastery in a single split
      // 图池分析: a map specialist makes running the map worth far more
      const mapEdge = 1 + analystEdge(state, 'maps') * 0.6
      // kept as a float: rounding every week swallowed the whole bonus, since
      // +2.0 and +2.4 both land on +2 and the remainder never carried forward
      team.mapPrefs[drill.map] = clamp(before + gain(2.35) * mapEdge, 0, 95)
      for (const p of squad) {
        addXp(p, 'teamwork', gain(9))
        addXp(p, 'awareness', gain(5))
        p.fatigue = clamp(p.fatigue + rng.range(3, 7), 0, 100)
      }
      if (Math.round(team.mapPrefs[drill.map]) > Math.round(before)) {
        notes.push(`🗺 ${drill.map} 熟练度提升到 ${Math.round(team.mapPrefs[drill.map])}。`)
      } else if (before >= 94.5) {
        notes.push(`🗺 ${drill.map} 熟练度已到上限 95，继续跑图只能保持手感——换张图练吧。`)
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
  for (const p of Object.values(state.players)) {
    p.age += 1
    // Scouts re-rate the young every winter. A prospect who has nearly caught
    // his projection sometimes turns out to have been under-rated — that is
    // where next season's headroom comes from, for the AI's academy kids and
    // the player's alike. Rivalry makes the rest of the world's kids likelier
    // to be pushed: clubs chasing a champion coach their youth harder.
    if (p.age <= 23 && p.potential - p.overall < 4 && p.potential < 97) {
      const pushed = p.teamId !== state.myTeam && (state.rivalry ?? 0) > 0
      if (rng.chance(pushed ? 0.45 : 0.28)) {
        p.potential = clamp(p.potential + rng.int(1, 3), p.potential, 99)
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
