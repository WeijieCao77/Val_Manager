/**
 * New blood, so a long career still has somebody to sign.
 *
 * The world is 518 real professionals and it only ever ages. Players retire,
 * nobody arrives, and by the sixth or seventh season the free-agent list is
 * empty, AI squads are down to five, and every mechanic built on youth — the
 * winter re-rating, 带新人, the rivalry drill — is developing nobody.
 *
 * The answer could not be to invent people. Every name in this game is a real
 * professional and that is the whole premise, so instead scripts/fetch_prospects.py
 * goes and finds more real ones: players from the tiers below the leagues we
 * simulate — regional Challengers, academies, Game Changers — who are not in
 * world.json and who are young enough that arriving years from now still
 * leaves a career to play.
 *
 * Two rules keep them honest:
 *
 *  - Their age is computed from a real recorded birthdate against the game's
 *    own year. A prospect born in 2008 arrives in 2031 aged 23, not aged 18,
 *    because that is how old he is. Nobody's age is chosen to be convenient.
 *  - The youngest go first. The pool is finite, so spending it oldest-first
 *    would hand a rebuilding club a 27-year-old "prospect" while the teenagers
 *    waited their turn.
 *
 * What is NOT real, and cannot be: their ability. These are players with no
 * top-flight record, so there is nothing to derive a rating from. They arrive
 * unproven — a modest overall with a wide, deliberately uncertain ceiling,
 * seeded from the player's own id so the same man is the same man in every
 * career. Finding the one worth signing is the point.
 */
import RAW from '../data/prospects.json'
import { Rng, clamp, hashStr } from './rng'
import { AGENT_ROLE } from './content'
import { recomputeOverall, refreshValue } from './player'
import { ATTR_KEYS, defaultContract } from './types'
import type { Attrs, GameState, Player, Region, Role } from './types'

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

/** The first season new blood arrives, and how many a year. */
export const INTAKE_FROM = 2027
export const INTAKE_MIN = 10
export const INTAKE_MAX = 15

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
    agentPool: (row.agents ?? []).slice(0, 4),
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
 * Let a year's worth of new blood into the world.
 *
 * Called once at the season rollover. They arrive as free agents rather than
 * being placed on clubs: the point is that there is somebody to sign.
 */
export function admitProspects(state: GameState, rng: Rng): string[] {
  if (state.year < INTAKE_FROM) return []
  state.prospectsTaken ??= []
  const taken = new Set(state.prospectsTaken)
  const pool = PROSPECTS.filter((r) => !taken.has(r.id) && !state.players[r.id])
  if (!pool.length) return []

  // youngest first: the pool is finite, and spending it oldest-first would
  // hand a rebuilding club a 27-year-old "prospect"
  pool.sort((a, b) => ageIn(a, state.year) - ageIn(b, state.year))
  const n = Math.min(pool.length, rng.int(INTAKE_MIN, INTAKE_MAX))
  const arriving = pool.slice(0, n)

  for (const row of arriving) {
    const p = makeProspect(row, state.year)
    state.players[p.id] = p
    state.prospectsTaken.push(row.id)
  }
  const ages = arriving.map((r) => ageIn(r, state.year))
  const lo = Math.min(...ages)
  const hi = Math.max(...ages)
  // Say what actually arrived. The pool ages in real time — everyone in it was
  // born by 2009 — so after a few seasons the intake is not teenagers any
  // more, and announcing 27-year-olds as 「年轻选手」 is simply a lie the
  // player can read straight off the ages in the same sentence.
  const what = lo <= 21 ? '新一批年轻选手进入职业圈'
    : lo <= 24 ? '新一批选手进入职业圈'
    : '一批次级联赛选手进入自由市场'
  return [
    `🌱 ${what}：${arriving.length} 人成为自由人`
    + `（${lo}~${hi} 岁），转会市场可以签下他们。`,
  ]
}

void defaultContract
