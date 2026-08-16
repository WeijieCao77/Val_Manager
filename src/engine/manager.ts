import { Rng, clamp, hashStr } from './rng'

/**
 * The manager themselves.
 *
 * The design rule here is that a background is mostly a story, not a build:
 * every origin gives exactly two strengths and one weakness of the same size,
 * so nothing is strictly better. The one real trade-off is age — starting older
 * buys reputation (a better first job) at the cost of how fast you improve.
 */
/**
 * The eight talents.
 *
 * Named for what they do rather than for a department: there is no scouting
 * network and no academy in this game, so 球探 and 青训 promised systems that
 * do not exist. 眼光 is how precisely you can read a player's ceiling, and
 * 带新人 is how fast the young ones improve under you.
 */
export type ManagerSkill =
  | 'training' | 'negotiation' | 'tactics' | 'scouting'
  | 'medical' | 'business' | 'locker' | 'youth'

export const SKILL_CN: Record<ManagerSkill, string> = {
  training: '训练', negotiation: '谈判', tactics: '战术', scouting: '眼光',
  medical: '体能', business: '商务', locker: '更衣室', youth: '带新人',
}

export const SKILL_HINT: Record<ManagerSkill, string> = {
  training: '训练收益更高',
  negotiation: '转会与续约更容易谈成',
  tactics: '比赛中的战术加成更大',
  scouting: '看得准潜力：低时选手潜力只显示为区间，高时显示确切数字',
  medical: '伤病更少，休息恢复更多体能',
  business: '赞助收入更高',
  locker: '士气更稳，不满消退更快',
  youth: '23 岁以下选手的训练收益更高',
}

export interface ManagerOrigin {
  key: string
  label: string
  /** one line of background, shown when choosing */
  blurb: string
  /** shifts the reputation you start with */
  repMod: number
  strong: [ManagerSkill, ManagerSkill]
  weak: ManagerSkill
  /** extra cash on day one, for the origins where that is the point */
  startingFunds?: number
}

/**
 * Eight origins. Each is two strengths and one weakness of equal magnitude, so
 * the deal is always even; what differs is which levers you get.
 * These are deliberately thin for now — the mechanism matters more than the
 * flavour, and the flavour is easy to deepen later.
 */
export const ORIGINS: ManagerOrigin[] = [
  {
    key: 'expro', label: '退役职业选手', repMod: 12,
    blurb: '你在赛场上待过，选手信你说的话，但从没管过账。',
    strong: ['locker', 'tactics'], weak: 'business',
  },
  {
    key: 'coach', label: '前教练 / 助教', repMod: 9,
    blurb: '你在教练席上熬了很多年，懂训练也懂临场，只是不擅长跟人谈钱。',
    strong: ['tactics', 'training'], weak: 'negotiation',
  },
  {
    key: 'analyst', label: '数据分析师', repMod: -2,
    blurb: '你靠一份份报告看人，比谁都准，但很少走进更衣室。',
    strong: ['scouting', 'training'], weak: 'locker',
  },
  {
    key: 'crossover', label: '别的项目转来', repMod: 8,
    blurb: '你在另一个项目做到过顶级，管理和资源都不缺，只是这个游戏还得重新学。',
    strong: ['business', 'negotiation'], weak: 'tactics',
  },
  {
    key: 'academy', label: '青训教练', repMod: -4,
    blurb: '你带出过好几个新人，看苗子很有一套，但没打过真正的大场面。',
    strong: ['youth', 'scouting'], weak: 'tactics',
  },
  {
    key: 'streamer', label: '主播 / 名人', repMod: 4,
    blurb: '你有流量，赞助商喜欢你，但圈子里没人把你当行家。',
    strong: ['business', 'negotiation'], weak: 'locker',
  },
  {
    key: 'investor', label: '投资人', repMod: 6,
    blurb: '你自己掏钱进的圈，账上不缺钱，但你更懂生意而不是比赛。',
    strong: ['business', 'medical'], weak: 'tactics',
    startingFunds: 900_000,
  },
  {
    key: 'grassroots', label: '草根出身', repMod: -8,
    blurb: '你从网吧战队一路打杂上来，什么都自学，只是没人听过你的名字。',
    strong: ['training', 'youth'], weak: 'business',
  },
]

export interface Manager {
  name: string
  age: number
  originKey: string
  /** gates which clubs will hire you */
  reputation: number
  /** talent points not yet spent */
  points?: number
  /** where each skill started, so refunds cannot dip below the origin */
  baseSkills?: Record<ManagerSkill, number>
  /** how fast your skills improve; the price of starting with reputation */
  growth: number
  skills: Record<ManagerSkill, number>
}

export const AGE_MIN = 18
export const AGE_MAX = 60

/** Bands sit young: in VALORANT, forty already reads as a veteran. */
export function ageBand(age: number): { key: string; label: string; note: string } {
  if (age <= 26) {
    return { key: 'young', label: '青年', note: '没人认识你，只能从底层带起，但成长最快。' }
  }
  if (age <= 35) {
    return { key: 'mid', label: '中生代', note: '有一定履历，能接手中游球队，成长中等。' }
  }
  return { key: 'senior', label: '资深', note: '名字有分量，能接手强队，但你基本定型了。' }
}

/**
 * Deliberately on the same scale as Team.reputation (which runs ~49-83), so
 * the two can be compared directly. The floor is set so that even the youngest
 * unknown can always take a Challengers job — starting low is the point, being
 * unable to start at all is not.
 */
function ageReputation(age: number): number {
  if (age <= 26) return 35 + (age - AGE_MIN) * 1.1
  if (age <= 35) return 46 + (age - 27) * 1.6
  return clamp(61 + (age - 36) * 0.9, 61, 72)
}

function ageGrowth(age: number): number {
  if (age <= 26) return 1.45
  if (age <= 35) return 1.0
  return 0.6
}

/** Deal three origins to choose between — random selection, even options. */
export function dealOrigins(seed: number, n = 3): ManagerOrigin[] {
  return new Rng(seed).shuffle(ORIGINS.slice()).slice(0, n)
}

export function createManager(name: string, age: number, originKey: string): Manager {
  const origin = ORIGINS.find((o) => o.key === originKey) ?? ORIGINS[0]
  const skills = {} as Record<ManagerSkill, number>
  for (const k of Object.keys(SKILL_CN) as ManagerSkill[]) skills[k] = 50
  for (const s of origin.strong) skills[s] = 65
  skills[origin.weak] = 35

  return {
    name: name.trim() || '无名经理',
    age: Math.round(clamp(age, AGE_MIN, AGE_MAX)),
    originKey: origin.key,
    reputation: Math.round(clamp(ageReputation(age) + origin.repMod, 25, 84)),
    growth: ageGrowth(age),
    skills,
    baseSkills: { ...skills },
    points: TALENT_POINTS,
  }
}

/** A skill as a small multiplier around 1, for use at call sites. */
/**
 * Talent points handed out at the start of a career.
 *
 * Eight is deliberately not enough to be good at everything: two skills taken
 * to the ceiling, or a broad but unremarkable spread. Origin already decides
 * where you begin, so these decide what you become.
 */
export const TALENT_POINTS = 8
export const SKILL_MIN = 20
export const SKILL_MAX = 90
/** each point buys this much of a skill */
export const POINT_STEP = 5

/**
 * A skill's effect, as a multiplier around 1.
 *
 * Everything reads through here so the numbers stay comparable: at the default
 * strength a maxed skill is worth about +16%, a neglected one about -12%.
 */
export const skillMod = (m: Manager | undefined, k: ManagerSkill, strength = 0.004): number =>
  1 + ((m?.skills[k] ?? 50) - 50) * strength

/** Spend or refund a point. Returns null when the move is not allowed. */
export function spendPoint(m: Manager, k: ManagerSkill, delta: 1 | -1): string | null {
  const now = m.skills[k] ?? 50
  if (delta > 0) {
    if ((m.points ?? 0) <= 0) return '没有可用的天赋点了。'
    if (now >= SKILL_MAX) return `${SKILL_CN[k]}已经到上限了。`
    m.skills[k] = now + POINT_STEP
    m.points = (m.points ?? 0) - 1
    return null
  }
  // only points you added can be taken back, never the origin's own baseline
  if (now - POINT_STEP < (m.baseSkills?.[k] ?? SKILL_MIN)) return '这一项不能再降了。'
  m.skills[k] = now - POINT_STEP
  m.points = (m.points ?? 0) + 1
  return null
}

/**
 * Can this manager be hired here?
 *
 * Reputation gates the club's standing, and the very top of each league is
 * always shut — those jobs are earned by winning, not chosen at the start.
 */
/** Challengers clubs will take anyone — there is always somewhere to start. */
export const OPEN_TO_ALL = 52

export function canManage(
  managerRep: number, teamReputation: number, isTopOfLeague: boolean,
): boolean {
  if (isTopOfLeague) return false
  if (teamReputation <= OPEN_TO_ALL) return true
  return teamReputation <= managerRep + 12
}

/**
 * Potential as the manager's scouting can actually see it.
 *
 * A number nobody could really know was being displayed to four significant
 * figures. Scouting does not change what a player will become — it changes how
 * precisely you can read it, so a poor scout sees a wide band and a great one
 * sees the number. The band is deterministic per player, so it does not shimmer
 * between renders, and it always contains the truth.
 */
export function scoutedPotential(
  m: Manager | undefined, playerId: string, potential: number, analyst = 0,
): { text: string; exact: boolean; low: number; high: number } {
  // 数据建模: an analyst reading the numbers is worth real scouting skill
  const skill = (m?.skills.scouting ?? 50) + analyst * 22
  // 90 -> ±0, 50 -> ±5, 20 -> ±9
  const band = Math.max(0, Math.round((88 - skill) / 7.5))
  if (band <= 0) return { text: String(potential), exact: true, low: potential, high: potential }

  // offset the window by a stable per-player hash so the true value is not
  // always dead centre — otherwise a wide band still gives the answer away
  const drift = (hashStr(`scout:${playerId}`) % (band + 1)) - Math.floor(band / 2)
  const low = Math.max(30, Math.min(potential, potential - band + drift))
  const high = Math.min(99, Math.max(potential, potential + band + drift))
  return { text: `${low}~${high}`, exact: false, low, high }
}
