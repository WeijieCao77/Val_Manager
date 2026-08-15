import { Rng, clamp } from './rng'

/**
 * The manager themselves.
 *
 * The design rule here is that a background is mostly a story, not a build:
 * every origin gives exactly two strengths and one weakness of the same size,
 * so nothing is strictly better. The one real trade-off is age — starting older
 * buys reputation (a better first job) at the cost of how fast you improve.
 */
export type ManagerSkill =
  | 'training' | 'negotiation' | 'tactics' | 'scouting'
  | 'medical' | 'business' | 'locker' | 'youth'

export const SKILL_CN: Record<ManagerSkill, string> = {
  training: '训练', negotiation: '谈判', tactics: '战术', scouting: '球探',
  medical: '体能', business: '商务', locker: '更衣室', youth: '青训',
}

export const SKILL_HINT: Record<ManagerSkill, string> = {
  training: '训练收益更高',
  negotiation: '转会与续约更容易谈成',
  tactics: '比赛中的战术加成更大',
  scouting: '潜力看得更准',
  medical: '伤病更少，体能恢复更快',
  business: '赞助收入更高',
  locker: '士气更稳，不满消退更快',
  youth: '年轻选手成长更快',
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
  }
}

/** A skill as a small multiplier around 1, for use at call sites. */
export const skillMod = (m: Manager | undefined, k: ManagerSkill, strength = 0.004): number =>
  1 + ((m?.skills[k] ?? 50) - 50) * strength

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
