import raw from '../data/world.json'
import { Rng, clamp, hashStr } from './rng'
import { AGENTS, MAPS, SPONSOR_NAMES } from './content'
import { defaultTactics, emptyStats, ROLES } from './types'
import type { Attrs, GameState, Player, Role, Sponsor, Team } from './types'
import { ORIGINS } from './manager'
import type { Manager } from './manager'

interface RawTeam {
  id: string; name: string; tag: string; region: string; tier: number; league: string
  rating: number; budget: number; reputation: number; roster: string[]
  coach: { name: string; tactics: number; development: number; motivation: number; assistants?: string[] } | null
  facilities: number
}
interface RawPlayer {
  id: string; ign: string; teamId: string | null; region: string; role: string
  roles?: string[]; flex?: boolean; agentPool?: string[]; roleSource?: string
  traits?: { key: string; label: string; good: boolean }[]
  nat?: string; realName?: string | null; birth?: string | null; ageEstimated?: boolean
  /** YYYY-MM they joined their club, where vlr.gg records it */
  joined?: string | null
  vlr?: { rating: number | null; acs: number | null; rounds: number }
  age: number; isIgl: boolean; attrs: Attrs; overall: number; potential: number
  form: number; morale: number; fatigue: number; salary: number; value: number
  contractYears: number; loyalty: number; ambition: number
}

const RAW = raw as unknown as {
  teams: RawTeam[]
  players: RawPlayer[]
  meta?: { analysts?: { name: string; from: string; spec: string; tactics: number; development: number; motivation: number }[] }
}

/**
 * Every real analyst in the world, and there are very few.
 *
 * Liquipedia records an analyst for only a handful of clubs, and this project
 * does not invent people — so an analyst is a genuinely scarce hire rather than
 * another row in the same list as the assistant coaches.
 */
export const WORLD_ANALYSTS = RAW.meta?.analysts ?? []

export const WORLD_TEAMS = RAW.teams
export const WORLD_PLAYERS = RAW.players

/** Coaching quality when a club has no real head coach on record. */
export const coachOr = (t: Team, k: 'tactics' | 'development' | 'motivation'): number =>
  t.coach ? t.coach[k] : Math.max(30, t.rating - 12)

function makeSponsors(team: RawTeam, rng: Rng): Sponsor[] {
  const count = team.tier === 1 ? rng.int(2, 4) : rng.int(1, 2)
  const names = rng.shuffle(SPONSOR_NAMES.slice()).slice(0, count)
  const scale = team.tier === 1 ? 1 : 0.22
  return names.map((name, i) => ({
    name,
    perSeason: Math.round((rng.range(280000, 1250000) * scale * (1 + team.reputation / 160)) / 1000) * 1000,
    bonusPlacement: i === 0 ? 4 : 8,
    bonus: Math.round((rng.range(80000, 400000) * scale) / 1000) * 1000,
  }))
}

function pickAgents(role: Role, rng: Rng): string[] {
  const pool = AGENTS[role]
  const n = Math.min(pool.length, rng.int(2, 4))
  return rng.shuffle(pool.slice()).slice(0, n)
}

/** Choose a sensible starting five: one per role where possible, then best available. */
export function autoStarters(state: GameState, teamId: string): string[] {
  const team = state.teams[teamId]
  const squad = team.roster
    .map((id) => state.players[id])
    .filter((p): p is Player => !!p)
    .sort((a, b) => b.overall - a.overall)

  const chosen: Player[] = []
  for (const role of ROLES) {
    const p = squad.find((x) => x.role === role && !chosen.includes(x))
    if (p) chosen.push(p)
  }
  for (const p of squad) {
    if (chosen.length >= 5) break
    if (!chosen.includes(p)) chosen.push(p)
  }
  return chosen.slice(0, 5).map((p) => p.id)
}

/** Extra cash some backgrounds bring with them. */
function startingFunds(m?: Manager): number {
  if (!m) return 0
  const o = ORIGINS.find((x) => x.key === m.originKey)
  return o?.startingFunds ?? 0
}

export function createNewGame(
  myTeamId: string, managerName: string, seed?: number, manager?: Manager,
): GameState {
  const s = seed ?? (hashStr(myTeamId + managerName + String(Date.now())) >>> 0)
  const rng = new Rng(s)

  const players: Record<string, Player> = {}
  for (const rp of RAW.players) {
    const prng = new Rng(hashStr(rp.id + 'init') ^ s)
    players[rp.id] = {
      ...rp,
      // the scrape leaves this null when vlr does not record a join date
      joined: rp.joined ?? undefined,
      region: rp.region as Player['region'],
      role: rp.role as Role,
      roles: (rp.roles as Role[] | undefined) ?? [rp.role as Role],
      // the agents this player really used, where we have them; otherwise a
      // plausible pool for the roles they cover
      agentPool: rp.agentPool?.length
        ? rp.agentPool
        : ((rp.roles as Role[] | undefined) ?? [rp.role as Role])
            .flatMap((r) => pickAgents(r, prng)),
      season: emptyStats(),
      career: emptyStats(),
      injuredUntil: 0,
      xp: {},
    }
  }

  const teams: Record<string, Team> = {}
  for (const rt of RAW.teams) {
    const trng = new Rng(hashStr(rt.id + 'team') ^ s)
    const mapPrefs: Record<string, number> = {}
    for (const m of MAPS) {
      mapPrefs[m] = Math.round(clamp(trng.norm(50, 14), 15, 92))
    }
    teams[rt.id] = {
      ...rt,
      region: rt.region as Team['region'],
      tier: rt.tier as Team['tier'],
      starters: [],
      tactics: defaultTactics(),
      sponsors: makeSponsors(rt, trng),
      mapPrefs,
      seasonPrize: 0,
      champPoints: 0,
    }
  }

  const state: GameState = {
    version: 1,
    seed: s,
    day: 0,
    year: 2026,
    stage: 'preseason',
    myTeam: myTeamId,
    managerName: manager?.name ?? managerName,
    manager,
    players,
    teams,
    comps: {},
    fixtures: [],
    news: [],
    offers: [],
    training: {},
    finances: { balance: teams[myTeamId].budget + startingFunds(manager), log: [] },
    honours: [],
    lastResults: [],
    boardConfidence: 62,
  }

  for (const id of Object.keys(teams)) {
    teams[id].starters = autoStarters(state, id)
  }
  for (const pid of teams[myTeamId].roster) {
    state.training[pid] = 'rest'
  }

  void rng
  return state
}

export const teamsOf = (state: GameState, pred: (t: Team) => boolean) =>
  Object.values(state.teams).filter(pred)

export const squadOf = (state: GameState, teamId: string): Player[] =>
  (state.teams[teamId]?.roster ?? [])
    .map((id) => state.players[id])
    .filter((p): p is Player => !!p)

export const freeAgents = (state: GameState): Player[] =>
  Object.values(state.players).filter((p) => p.teamId === null)

/** Wage bill per season for a club. */
export const wageBill = (state: GameState, teamId: string): number =>
  squadOf(state, teamId).reduce((s, p) => s + p.salary, 0) +
  // a coach the manager hired is paid like everyone else
  (state.teams[teamId]?.coach?.salary ?? 0) +
  // assistants and analysts are on the payroll too, for our club only
  (teamId === state.myTeam
    ? (state.staff ?? []).reduce((s, m) => s + m.salary, 0)
    : 0)
