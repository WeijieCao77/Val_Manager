import { canonAgents } from './content'
import raw from '../data/world.json'
import { dossierOf } from './dossier'
import { Rng, clamp, hashStr } from './rng'
import { AGENTS, MAPS, SPONSOR_NAMES } from './content'
import { defaultTactics, emptyStats, ROLES } from './types'
import type { Attrs, GameState, Player, Role, Sponsor, Team } from './types'
import { ORIGINS } from './manager'
import type { Manager } from './manager'
import { freeAgentPool } from './prospects'
import { WORLD_TEAMS, type RawTeam } from './teams'
import { squadOf } from './roster'

interface RawPlayer {
  id: string; ign: string; teamId: string | null; region: string; role: string
  roles?: string[]; flex?: boolean; agentPool?: string[]; roleSource?: string
  traits?: { key: string; label: string; good: boolean }[]
  nat?: string; realName?: string | null; birth?: string | null; ageEstimated?: boolean
  /** YYYY-MM they joined their club, where vlr.gg records it */
  joined?: string | null
  rounds?: number
  vlr?: { rating: number | null; acs: number | null; rounds: number }
  age: number; isIgl: boolean; iglSource?: 'verified' | 'inferred'
  attrs: Attrs; overall: number; potential: number
  form: number; morale: number; fatigue: number; salary: number; value: number
  contractYears: number; loyalty: number; ambition: number
}

const RAW = raw as unknown as { players: RawPlayer[] }

/**
 * Every real analyst in the world, and there are very few.
 *
 * Liquipedia records an analyst for only a handful of clubs, and this project
 * does not invent people — so an analyst is a genuinely scarce hire rather than
 * another row in the same list as the assistant coaches.
 */

export const WORLD_PLAYERS = RAW.players

/** Coaching quality when a club has no real head coach on record. */

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
/** Ability, discounted while the sample behind it is thin. */
export const confidentRating = (p: Player): number =>
  p.overall - Math.round(14 * (1 - (p.rounds ?? 0) / ((p.rounds ?? 0) + 900)))

export function autoStarters(state: GameState, teamId: string): string[] {
  const team = state.teams[teamId]
  const squad = team.roster
    .map((id) => state.players[id])
    .filter((p): p is Player => !!p)
    // An unproven player rates at the league average because we have not seen
    // him, not because he is average. Sharks came out ahead of Lysoar on 119
    // rounds against 8031, and was picked to start over him. Thin samples are
    // discounted for selection.
    //
    // A man in the treatment room goes to the back of the queue whatever he
    // rates: "已自动排出最佳首发" used to hand back a five with three injured
    // men in it, and the same screen then warned the caller was unavailable.
    // He is still eligible — a squad with nobody fit must field somebody.
    .sort((a, b) => {
      const fit = (x: Player) => (x.injuredUntil > state.day ? 1 : 0)
      return fit(a) - fit(b) || confidentRating(b) - confidentRating(a)
    })

  const chosen: Player[] = []
  // 自由人 is "covers anything", not a slot to fill — treating it as one forced
  // the squad's only flex player into the five ahead of better options
  const core = ROLES.filter((r) => r !== '自由人')
  for (const role of core) {
    const p = squad.find((x) => x.role === role && !chosen.includes(x))
    if (p) chosen.push(p)
  }
  // Then close any gap with someone who covers it as a second role. Filling
  // slots by main role alone left Fire Flux fielding no sentinel while the one
  // player who can hold a site sat on the bench, because sentinel is his
  // second job — a -5 the squad never had to take.
  for (const role of core) {
    if (chosen.length >= 5) break
    if (chosen.some((x) => (x.roles ?? [x.role]).includes(role))) continue
    const p = squad.find((x) => !chosen.includes(x) && (x.roles ?? [x.role]).includes(role))
    if (p) chosen.push(p)
  }
  for (const p of squad) {
    if (chosen.length >= 5) break
    if (!chosen.includes(p)) chosen.push(p)
  }
  const five = chosen.slice(0, 5)

  // The caller goes out with the team. Picking purely on rating left FNATIC,
  // Gen.G and three others starting without one, because an IGL is often the
  // worst fragger on the roster — Boaster rates 61 in a squad of high 80s. The
  // sim already prices that at -4 to both sides and -3 mid-round, which is more
  // than any single role gap costs, so a lineup that drops him is simply a
  // worse lineup. He replaces the lowest-rated starter whose roles someone
  // else still covers.
  const igl = squad.filter((p) => p.isIgl).sort((a, b) => b.attrs.igl - a.attrs.igl)[0]
  if (igl && !five.includes(igl)) {
    const covered = (without: Player) => {
      const rest = five.filter((x) => x !== without).concat(igl)
      const have = new Set(rest.flatMap((p) => p.roles ?? [p.role]))
      return ROLES.filter((r) => r !== '自由人').every((r) => have.has(r))
    }
    const drop = five
      .slice()
      .sort((a, b) => confidentRating(a) - confidentRating(b))
      .find(covered)
    if (drop) five[five.indexOf(drop)] = igl
  }
  return five.map((p) => p.id)
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
    // world.json was built before the player pages were scraped and is missing
    // a nationality for 178 of the 518, and a real name for rather more. The
    // dossier has both for everyone. Overlaid here rather than rewritten into
    // world.json so the two files keep their jobs — world.json is what the
    // simulation reads, dossier.json is who these people are.
    const d = dossierOf(rp.id)
    players[rp.id] = {
      ...rp,
      nat: rp.nat || d?.nat || undefined,
      realName: rp.realName ?? d?.real ?? null,
      // The spread is shallow. Nested objects that the game MUTATES must be
      // copied, or every career in one page session shares them with the
      // imported world file — the roster array taught this lesson below, and
      // attrs re-taught it when a test that rolled many worlds watched its
      // "fresh" players arrive pre-trained by the previous world's seasons.
      attrs: { ...rp.attrs },
      traits: rp.traits ? [...rp.traits] : rp.traits,
      // the scrape leaves this null when vlr does not record a join date
      joined: rp.joined ?? undefined,
      region: rp.region as Player['region'],
      role: rp.role as Role,
      roles: (rp.roles as Role[] | undefined) ?? [rp.role as Role],
      // the agents this player really used, where we have them; otherwise a
      // plausible pool for the roles they cover
      agentPool: rp.agentPool?.length
        ? canonAgents(rp.agentPool)
        : ((rp.roles as Role[] | undefined) ?? [rp.role as Role])
            .flatMap((r) => pickAgents(r, prng)),
      season: emptyStats(),
      career: emptyStats(),
      injuredUntil: 0,
      xp: {},
      // the in-save CV starts on day one — the farewell card reads this,
      // never the real-world record
      clubHist: rp.teamId ? [{ team: rp.teamId, from: 2026, to: 2026 }] : [],
    }
  }

  // The rest of the professional scene: real players from below the simulated
  // leagues, without a club. They are ordinary free agents from day one — the
  // market lists them, AI sides short of five sign them — which is the whole
  // point, because a world of 518 that only ages runs out of people.
  for (const p of freeAgentPool(2026)) {
    if (!players[p.id]) players[p.id] = p
  }

  const teams: Record<string, Team> = {}
  for (const rt of WORLD_TEAMS) {
    const trng = new Rng(hashStr(rt.id + 'team') ^ s)
    const mapPrefs: Record<string, number> = {}
    for (const m of MAPS) {
      mapPrefs[m] = Math.round(clamp(trng.norm(50, 14), 15, 92))
    }
    teams[rt.id] = {
      ...rt,
      // A spread is shallow, so every game shared one roster array with the
      // imported world file. Signing someone in one career pushed him into the
      // next one — where his teamId was still null, leaving a name on a roster
      // that belonged to nobody. Anything that walks the roster counted him;
      // anything that went via teamId did not.
      roster: [...rt.roster],
      coach: rt.coach ? { ...rt.coach } : rt.coach,
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
    // Static data may honestly leave a club's real caller unknown. AI clubs
    // still appoint an in-save stand-in; the human's club leaves that choice
    // to the manager and the squad screen warns about it.
    ensureCaller(state, id)
    teams[id].starters = autoStarters(state, id)
  }
  for (const pid of teams[myTeamId].roster) {
    state.training[pid] = 'rest'
  }
  // the squad you inherited, kept so an ending can ask who is still here in
  // ten years' time — the record, not a flag set when somebody leaves
  state.startingSquad = [...teams[myTeamId].roster]
  state.startFacilities = teams[myTeamId].facilities
  state.startTier = teams[myTeamId].tier
  // they are yours from today, so today is where their development is measured from
  for (const id of state.startingSquad) {
    const p = state.players[id]
    if (p) p.arrivedOverall = p.overall
  }

  void rng
  return state
}

export const teamsOf = (state: GameState, pred: (t: Team) => boolean) =>
  Object.values(state.teams).filter(pred)

/**
 * Hand the in-game calling to another of our players.
 *
 * The squad screen has warned "让别人接过指挥" since the day it learned to
 * notice a missing caller — and offered no way to do it. The flag could only
 * move by selling the incumbent. Now it is a decision like naming starters:
 * free of action points, because it is an internal arrangement, not business.
 *
 * The new caller keeps his own igl attribute — a 55-rated stand-in calls like
 * a 55-rated stand-in (about −0.5 to the sim) — but that is far cheaper than
 * calling with nobody, which costs −4 to both halves and −3 mid-round. Taking
 * the armband off a healthy incumbent stings him a little; an injured or
 * benched one is relieved someone is doing the job.
 */
export function appointIgl(state: GameState, playerId: string): string {
  const p = state.players[playerId]
  if (!p) return '找不到这名选手。'
  if (p.teamId !== state.myTeam) return '只能任命自己队里的选手。'
  if (p.isIgl) return `${p.ign} 已经是指挥了。`
  // Every other flag comes off, not just one. A squad can hold several IGLs
  // by trade (a bought caller keeps his flag), and the loudest of them calls
  // by default — so an appointment that left a louder voice flagged would be
  // silently overruled by the very rule it exists to override.
  const prevs = squadOf(state, state.myTeam).filter((x) => x.isIgl)
  const prev = prevs.sort((a, b) => b.attrs.igl - a.attrs.igl)[0]
  for (const x of prevs) {
    x.isIgl = false
    x.iglSource = undefined
    const healthy = x.injuredUntil <= state.day
    const starting = state.teams[state.myTeam].starters.includes(x.id)
    if (healthy && starting) {
      // a healthy starter stripped of the calling takes it personally
      x.morale = Math.max(0, x.morale - 5)
      x.grievance = Math.min(100, (x.grievance ?? 0) + 6)
    }
  }
  p.isIgl = true
  p.iglSource = 'verified'
  state.news.push({
    day: state.day, kind: 'club', important: true,
    text: `${p.ign} 接过队内指挥${prev ? `（此前是 ${prev.ign}）` : ''}。`,
  })
  return prev
    ? `${p.ign} 接过指挥。${prev.ign} 交出了这个角色${
      prev.injuredUntil > state.day ? '——他还在养伤，这是明智的安排' : '，心里未必舒服'}。`
    : `${p.ign} 出任队内指挥。`
}

/**
 * Make sure an AI club has somebody calling.
 *
 * Selling your IGL is a decision; for an AI club it was a life sentence — no
 * code path ever appointed a successor, so the club played the rest of its
 * days at the full no-caller penalty. A real club promotes someone within the
 * week. Our own club is exempt: the squad screen warns and offers the
 * appointment, and that decision belongs to the player.
 */
export function ensureCaller(state: GameState, teamId: string): void {
  if (teamId === state.myTeam) return
  const squad = squadOf(state, teamId)
  if (!squad.length || squad.some((p) => p.isIgl)) return
  const next = squad.slice().sort((a, b) => b.attrs.igl - a.attrs.igl)[0]
  next.isIgl = true
  next.iglSource = 'inferred'
}

// squadOf / freeAgents / coachOr / wageBill live in roster.ts and WORLD_TEAMS
// in teams.ts, and they are NOT re-exported from here on purpose: a re-export
// looks free and is not — importing one through this module drags all 518
// players in behind it, which is exactly how the front page ended up
// downloading the game to print two integers.

/** Wage bill per season for a club. */
