import { Rng, clamp } from './rng'
import { expectedSalary } from './player'
import { squadOf } from './roster'
import type { GameState, Player } from './types'

/**
 * The things that happen to a squad between matches.
 *
 * A season used to be transfers, results and very little else: measured over
 * thirty season-runs, the manager's own squad saw 0.9 injuries a year, no
 * retirements at all and no dressing-room flare-ups. Nothing arrived that you
 * had not gone looking for.
 *
 * Every event here is built from something the game already knows — a real
 * birthdate from Liquipedia, maps actually played in this save, a wage against
 * a rating, a rival club's real need. Nothing invents a person, an illness or a
 * private circumstance for a real player: these are the ordinary events of a
 * competitive season, which is the same license the injury and morale systems
 * already work under.
 *
 * They are deliberately small. The point is that a week has weather, not that
 * the manager is buried in prompts.
 */

/** A day's worth of things that simply happened. */
export function dailyLife(state: GameState, notes: string[]): void {
  birthdays(state, notes)
}

/** A week's worth of things that build up. */
export function weeklyLife(state: GameState, rng: Rng, notes: string[]): void {
  milestones(state, notes)
  payDemands(state, rng, notes)
  transferRumours(state, rng, notes)
  formSwings(state, notes)
}

// ---------------------------------------------------------------- birthdays

/** Day-of-year for an ISO date, ignoring the year. */
function dayOfYear(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return null
  const month = Number(m[2])
  const day = Number(m[3])
  if (!month || !day) return null
  return Math.round(
    (Date.UTC(2001, month - 1, day) - Date.UTC(2001, 0, 1)) / 86_400_000,
  )
}

/**
 * 366 players carry a real birthdate. Using it costs nothing and is the
 * cheapest thing in the game that makes a squad feel like people.
 */
function birthdays(state: GameState, notes: string[]): void {
  for (const p of squadOf(state, state.myTeam)) {
    if (!p.birth) continue
    if (dayOfYear(p.birth) !== state.day % 365) continue
    p.morale = clamp(p.morale + 3, 0, 100)
    notes.push(`🎂 ${p.ign} 今天 ${p.age} 岁生日。`)
  }
}

// ---------------------------------------------------------------- milestones

const MAP_MARKS = [100, 250, 500, 750, 1000, 1500, 2000]

/**
 * Rounds a player has played, career and in this save together.
 *
 * `rounds` is what vlr recorded before the game started; `career` accumulates
 * from here. A milestone that ignored the first would tell a ten-year veteran
 * he has just played his hundredth map.
 */
function mapsOf(p: Player): number {
  const before = Math.round((p.rounds ?? 0) / 24)   // ~24 rounds to a map
  return before + (p.career?.maps ?? 0)
}

function milestones(state: GameState, notes: string[]): void {
  for (const p of squadOf(state, state.myTeam)) {
    const now = mapsOf(p)
    // First sight of a player: record where his career already stands, and
    // say nothing. Without this, week one "congratulated" four veterans on
    // their hundredth map in a week nobody played — the mark was undefined,
    // so a total they brought with them read as something that just happened.
    if (p.marks?.maps === undefined) {
      p.marks = { ...(p.marks ?? {}), maps: MAP_MARKS.filter((m) => m <= now).pop() ?? 0 }
      continue
    }
    const seen = p.marks.maps
    const hit = MAP_MARKS.filter((m) => m > seen && m <= now).pop()
    if (!hit) continue
    p.marks = { ...(p.marks ?? {}), maps: hit }
    p.morale = clamp(p.morale + 2, 0, 100)
    notes.push(`🎖 ${p.ign} 生涯地图数来到 ${hit} 张（含加入前的职业记录）。`)
  }
}

// ---------------------------------------------------------------- pay demands

/**
 * A player who has outgrown his deal comes and says so.
 *
 * The game already models a wage a player of his level would command; what it
 * never did was let him notice the gap. Ignoring him is a real choice — it
 * costs trust and feeds the grievance that eventually puts him on the market —
 * and answering him means opening the renewal panel and paying.
 */
function payDemands(state: GameState, rng: Rng, notes: string[]): void {
  const me = state.teams[state.myTeam]
  if (!me) return
  for (const p of squadOf(state, state.myTeam)) {
    if (p.contractYears <= 0) continue                 // that is an expiry, not a raise
    if (p.payAskedOn && state.day - p.payAskedOn < 120) continue
    const worth = expectedSalary(p, me.tier)
    if (worth < p.salary * 1.3) continue               // not a real gap
    if (!rng.chance(0.28)) continue
    p.payAskedOn = state.day
    p.grievance = clamp((p.grievance ?? 0) + 8, 0, 100)
    p.trust = clamp((p.trust ?? 62) - 3, 0, 100)
    notes.push(
      `💰 ${p.ign} 认为自己的合同已经配不上现在的表现，`
      + `希望谈到 ${Math.round(worth / 1000)}K（现 ${Math.round(p.salary / 1000)}K）。`,
    )
  }
}

// ---------------------------------------------------------------- rumours

/**
 * A rival is watching one of ours.
 *
 * Bids already arrive out of nowhere. A rumour is the week of warning before
 * one does — long enough to renew him, or to decide you would rather take the
 * money. It only names clubs that would plausibly want him: a better side, in a
 * position they are actually thin at.
 */
function transferRumours(state: GameState, rng: Rng, notes: string[]): void {
  const me = state.teams[state.myTeam]
  if (!me) return
  const mine = squadOf(state, state.myTeam)
  for (const p of mine) {
    if (p.rumourOn && state.day - p.rumourOn < 60) continue
    if (p.overall < me.rating - 2) continue            // nobody is circling the bench
    if (!rng.chance(0.1)) continue

    const suitors = Object.values(state.teams).filter((t) => {
      if (t.id === state.myTeam || t.rating < me.rating) return false
      const squad = squadOf(state, t.id)
      const covers = squad.filter((x) => (x.roles ?? [x.role]).includes(p.role))
      return covers.length < 2 || squad.length < 6
    })
    if (!suitors.length) continue

    const club = suitors[rng.int(0, suitors.length - 1)]
    p.rumourOn = state.day
    // being wanted is flattering, and unsettling
    p.morale = clamp(p.morale + 2, 0, 100)
    if ((p.ambition ?? 60) > 70) p.grievance = clamp((p.grievance ?? 0) + 4, 0, 100)
    notes.push(`📰 有消息称 ${club.tag} 正在关注 ${p.ign}。`)
  }
}

// ---------------------------------------------------------------- form

/**
 * Form already swings every week; nobody was ever told.
 *
 * Only the crossings are reported, and only once each way, so a player
 * hovering at the boundary does not file a report every Monday.
 */
function formSwings(state: GameState, notes: string[]): void {
  for (const p of squadOf(state, state.myTeam)) {
    // set from the settled distribution, not by eye: form sits at p50 69 with
    // p95 at 83 and p5 at 59, so these are roughly the top and bottom twentieth
    const hot = p.form >= 83
    const cold = p.form <= 59
    const flag = hot ? 'hot' : cold ? 'cold' : ''
    if (flag === (p.formFlag ?? '')) continue
    p.formFlag = flag || undefined
    if (hot) notes.push(`🔥 ${p.ign} 状态正热（${Math.round(p.form)}）。`)
    if (cold) notes.push(`🥶 ${p.ign} 状态低迷（${Math.round(p.form)}），可以考虑轮休。`)
  }
}
