/**
 * More real professionals, so the world does not run out of people.
 *
 * The world is 518 real players and it only ever ages. Players retire, nobody
 * arrives, and by the sixth or seventh season the free-agent list is empty and
 * AI squads are down to five.
 *
 * The answer could not be to invent people — every name in this game is a real
 * professional and that is the whole premise — so scripts/fetch_prospects.py
 * goes and finds more real ones: players from the tiers below the leagues we
 * simulate who are not in world.json. They are not a youth academy and there
 * is no intake ceremony; they are simply the rest of the professional scene,
 * available from day one like anybody else without a club.
 *
 * Two rules keep them honest:
 *
 *  - Their age comes from a real recorded birthdate. Someone born in 2004 is
 *    22 in 2026 because that is how old he is, and nobody's age is chosen to
 *    be convenient.
 *  - What is NOT real, and cannot be, is their ability: these are players with
 *    no top-flight record, so there is nothing to derive a rating from. They
 *    arrive unproven, seeded from their own id so the same man is the same man
 *    in every career, with a ceiling that closes as they get older.
 */
import { canonAgents } from './content'
import RAW from '../data/prospects.json'
import { Rng, clamp, hashStr } from './rng'
import { AGENT_ROLE } from './content'
import { recomputeOverall, refreshValue } from './player'
import { ATTR_KEYS, defaultContract } from './types'
import type { Attrs, Player, Region, Role } from './types'

export interface ProspectRow {
  id: string
  ign: string
  real?: string | null
  nat?: string | null
  born?: string | null
  age?: number | null
  agents?: string[]
}

interface ProspectFile {
  meta: { built: string; source: string; count: number }
  players: ProspectRow[]
}

export const PROSPECTS = (RAW as unknown as ProspectFile).players ?? []

/** Nationality → region, mirroring imports.ts so the import rule still works. */
const NAT_REGION: Record<string, Region> = {
  us: 'Americas', ca: 'Americas', br: 'Americas', ar: 'Americas',
  cl: 'Americas', mx: 'Americas', pe: 'Americas', co: 'Americas',
  uy: 'Americas', do: 'Americas', ec: 'Americas', bo: 'Americas',
  cn: 'China', hk: 'China', mo: 'China', tw: 'China',
  kr: 'Pacific', jp: 'Pacific', id: 'Pacific', th: 'Pacific',
  ph: 'Pacific', sg: 'Pacific', my: 'Pacific', vn: 'Pacific',
  in: 'Pacific', au: 'Pacific', nz: 'Pacific',
  gb: 'EMEA', fr: 'EMEA', de: 'EMEA', es: 'EMEA', tr: 'EMEA',
  ru: 'EMEA', pl: 'EMEA', se: 'EMEA', dk: 'EMEA', ua: 'EMEA',
  it: 'EMEA', nl: 'EMEA', be: 'EMEA', fi: 'EMEA', no: 'EMEA',
  pt: 'EMEA', cz: 'EMEA', ro: 'EMEA', gr: 'EMEA', il: 'EMEA',
  ch: 'EMEA', at: 'EMEA', hu: 'EMEA', rs: 'EMEA', bg: 'EMEA',
  kg: 'EMEA', kz: 'EMEA', az: 'EMEA', ma: 'EMEA', sa: 'EMEA',
}

const CORE: Role[] = ['决斗者', '先锋', '控场', '哨卫']

/** The job he actually plays, read off the agents he has been seen on. */
function roleOf(row: ProspectRow, rng: Rng): Role {
  const counts = new Map<Role, number>()
  for (const a of row.agents ?? []) {
    // the scrape lowercases agent file names; AGENT_ROLE is keyed by the
    // display name, so match case-insensitively
    const key = Object.keys(AGENT_ROLE).find((k) => k.toLowerCase().replace('/', '') === a)
    const r = key ? AGENT_ROLE[key] : undefined
    if (r) counts.set(r, (counts.get(r) ?? 0) + 1)
  }
  let best: Role | null = null
  for (const [r, n] of counts) if (!best || n > (counts.get(best) ?? 0)) best = r
  return best ?? rng.pick(CORE)
}

/** How old he is in this game year, from his real birthdate. */
export const ageIn = (row: ProspectRow, year: number): number => {
  const born = row.born ? Number(row.born.slice(0, 4)) : null
  if (born) return year - born
  return (row.age ?? 20) + (year - 2026)
}

/**
 * Turn a scraped row into a player of this world.
 *
 * Unproven by construction: a rating a good academy player would carry, and a
 * ceiling that is genuinely unknown — some of these become stars and most do
 * not, which is what makes scouting them worth doing.
 */
export function makeProspect(row: ProspectRow, year: number): Player {
  const rng = new Rng(hashStr(`prospect:${row.id}`))
  const age = clamp(ageIn(row, year), 16, 30)
  const role = roleOf(row, rng)

  // where an academy player sits: good enough to be worth a contract, not
  // good enough to walk into a starting five
  const base = Math.round(rng.norm(58, 5))
  const attrs = {} as Attrs
  for (const k of ATTR_KEYS) {
    attrs[k] = clamp(Math.round(base + rng.range(-7, 7)), 25, 92)
  }
  // the calling attribute is not something an unknown teenager has
  attrs.igl = clamp(Math.round(base - rng.range(4, 14)), 20, 80)

  const nat = (row.nat ?? '').toLowerCase() || undefined
  const p: Player = {
    id: row.id,
    ign: row.ign,
    teamId: null,
    region: (nat ? NAT_REGION[nat] : undefined) ?? 'EMEA',
    nat,
    realName: row.real ?? null,
    birth: row.born ?? undefined,
    joined: undefined,
    rounds: 0,
    role,
    roles: [role],
    flex: false,
    traits: [],
    agentPool: canonAgents(row.agents ?? []).slice(0, 4),
    age,
    ageEstimated: !row.born,
    isIgl: false,
    attrs,
    overall: 0,
    stageBonus: 1,
    potential: 0,
    form: 70,
    morale: 70,
    fatigue: 0,
    salary: 0,
    value: 0,
    contractYears: 0,
    loyalty: Math.round(rng.range(40, 75)),
    ambition: Math.round(rng.range(45, 85)),
    injuredUntil: 0,
    xp: {},
    season: {
      maps: 0, rounds: 0, kills: 0, deaths: 0, assists: 0,
      firstKills: 0, firstDeaths: 0, damage: 0, clutches: 0, mvps: 0,
    },
    career: {
      maps: 0, rounds: 0, kills: 0, deaths: 0, assists: 0,
      firstKills: 0, firstDeaths: 0, damage: 0, clutches: 0, mvps: 0,
    },
  }

  recomputeOverall(p)
  // The ceiling is the whole story for a teenager, and it is deliberately
  // wide: a handful of these are future internationals and most top out in the
  // second tier. The manager's 眼光 talent is what turns the guess into
  // information.
  //
  // But it has to close with age, because the pool does. These are real people
  // with real birthdays, so the same 121 names get older every season the
  // career runs — by the back half of a ten-year tenure the youngest man left
  // is in his mid-twenties. Handing him a nineteen-year-old's ceiling would
  // make late-career scouting strictly better than early-career scouting,
  // which is backwards.
  const room = clamp((26 - age) / 8, 0.12, 1)
  const head = Math.max(2, Math.round(rng.norm(16, 9) * room))
  p.potential = clamp(p.overall + head, p.overall, 97)
  p.salary = Math.round(clamp(18_000 + p.overall * 700, 15_000, 90_000))
  refreshValue(p)
  return p
}

/**
 * Everyone this file can add to a world, as free agents.
 *
 * Called once when the world is built. They go straight into the player pool
 * with no club, which is what "in the pool" means — the transfer market lists
 * them, AI clubs short of five sign them, and a manager scouting the market
 * finds them next to everybody else.
 */
export function freeAgentPool(year: number): Player[] {
  return PROSPECTS.map((row) => makeProspect(row, year))
}

void defaultContract
