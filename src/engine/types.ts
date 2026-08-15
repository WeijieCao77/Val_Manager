export type Region = 'Americas' | 'EMEA' | 'Pacific' | 'China'
export type Role = '决斗者' | '先锋' | '控场' | '哨卫' | '自由人'
export type Tier = 1 | 2

export const REGIONS: Region[] = ['Americas', 'EMEA', 'Pacific', 'China']
export const ROLES: Role[] = ['决斗者', '先锋', '控场', '哨卫', '自由人']
export const REGION_CN: Record<Region, string> = {
  Americas: '美洲', EMEA: '欧非中东', Pacific: '太平洋', China: '中国',
}

export interface Attrs {
  aim: number
  reaction: number
  awareness: number
  utility: number
  clutch: number
  teamwork: number
  communication: number
  igl: number
}

export const ATTR_KEYS: (keyof Attrs)[] = [
  'aim', 'reaction', 'awareness', 'utility', 'clutch', 'teamwork', 'communication', 'igl',
]
export const ATTR_CN: Record<keyof Attrs, string> = {
  aim: '枪法', reaction: '反应', awareness: '意识', utility: '道具',
  clutch: '残局', teamwork: '协同', communication: '沟通', igl: '指挥',
}

/** Accumulated performance over a competition period. */
export interface Stats {
  maps: number
  rounds: number
  kills: number
  deaths: number
  assists: number
  firstKills: number
  firstDeaths: number
  damage: number
  clutches: number
  mvps: number
}

export const emptyStats = (): Stats => ({
  maps: 0, rounds: 0, kills: 0, deaths: 0, assists: 0,
  firstKills: 0, firstDeaths: 0, damage: 0, clutches: 0, mvps: 0,
})

/**
 * A characteristic read off the player's real numbers — top or bottom decile of
 * the professional field on some axis. `good: false` marks a real weakness.
 */
export interface Trait {
  key: string
  label: string
  good: boolean
}

/** What vlr.gg actually recorded for this player, kept for reference in the UI. */
export interface VlrLine {
  rating: number | null
  acs: number | null
  rounds: number
}

export interface Player {
  id: string
  ign: string
  teamId: string | null
  region: Region
  /** ISO-ish country code from vlr.gg, e.g. 'kr' */
  nat?: string
  /** real name, where Liquipedia has one */
  realName?: string | null
  /** ISO birthdate from Liquipedia, null when unknown */
  birth?: string | null
  /** true when age was inferred rather than taken from a real birthdate */
  ageEstimated?: boolean
  /** the real statistical line this player's attributes were derived from */
  vlr?: VlrLine
  /** primary role — the one they play most */
  role: Role
  /**
   * Every role this player actually covers. Modern VALORANT players routinely
   * double up (smokes + sentinel is the classic pairing), so composition checks
   * count all of these, not just `role`.
   */
  roles?: Role[]
  /** true when they cover a second role for their club */
  flex?: boolean
  /** derived from real statistics, not authored */
  traits?: Trait[]
  age: number
  isIgl: boolean
  attrs: Attrs
  overall: number
  potential: number
  /** 0-100, short-term performance swing */
  form: number
  morale: number
  fatigue: number
  salary: number
  value: number
  contractYears: number
  loyalty: number
  ambition: number
  agentPool: string[]
  season: Stats
  career: Stats
  /** day index this player is available again; 0 = fit */
  injuredUntil: number
  injuryNote?: string
  /** per-attribute training progress 0-100, rolls over into a +1 */
  xp: Partial<Record<keyof Attrs, number>>
  /** set when the player has been transfer-listed by their club */
  listed?: boolean
}

export interface Coach {
  name: string
  tactics: number
  development: number
  motivation: number
}

export interface Tactics {
  /** 0 = 慢节奏运营, 100 = 快节奏突破 */
  pace: number
  /** 0 = 省道具, 100 = 道具全开 */
  utility: number
  /** 0 = 保守, 100 = 激进搏杀 */
  aggression: number
  /** 0 = 死守战术板, 100 = 中局随机应变 */
  adaptability: number
}

export const defaultTactics = (): Tactics => ({
  pace: 50, utility: 55, aggression: 50, adaptability: 50,
})

export interface Sponsor {
  name: string
  perSeason: number
  /** bonus paid if the team finishes at/above this league placement */
  bonusPlacement: number
  bonus: number
}

export interface Team {
  id: string
  name: string
  region: Region
  tier: Tier
  league: string
  rating: number
  budget: number
  reputation: number
  roster: string[]
  starters: string[]
  /** null when no real head coach is on record — never an invented one */
  coach: Coach | null
  facilities: number
  tactics: Tactics
  sponsors: Sponsor[]
  /** map-by-map comfort, 0-100 */
  mapPrefs: Record<string, number>
  seasonPrize: number
  /** VCT championship points earned this season */
  champPoints: number
}

/** How a single round played out — drives the broadcast-style round ribbon. */
export interface RoundLog {
  n: number
  winner: 'A' | 'B'
  /** true when team A was attacking this round */
  aAttack: boolean
  end: 'elim' | 'spike' | 'defuse' | 'time'
  /** economy state each side went into the round with */
  buyA: 'eco' | 'force' | 'full'
  buyB: 'eco' | 'force' | 'full'
}

export interface MapScore {
  map: string
  scoreA: number
  scoreB: number
  /** per-player line for this map, keyed by player id */
  lines: Record<string, MapLine>
  /** kept only for the managed club's matches, to bound save size */
  rounds?: RoundLog[]
}

export interface MapLine {
  kills: number
  deaths: number
  assists: number
  damage: number
  firstKills: number
  firstDeaths: number
  clutches: number
  rounds: number
  acs: number
}

export interface MatchResult {
  mapsWonA: number
  mapsWonB: number
  maps: MapScore[]
  vetoLog: string[]
  mvp: string | null
  /**
   * Who actually played for each side, captured at match time. Scoreboards must
   * use this rather than a player's current club — otherwise anyone transferred
   * afterwards silently disappears from matches they played in.
   */
  lineups?: { a: string[]; b: string[] }
  /** short round-by-round narrative from the decisive map */
  highlights: string[]
}

export type StageKey =
  | 'preseason' | 'kickoff' | 'masters1' | 'stage1' | 'stage2'
  | 'masters2' | 'champions' | 'offseason'
  | 'challengers1' | 'challengers2' | 'ascension'

export interface Fixture {
  id: string
  day: number
  stage: StageKey
  /** league key ('VCT Americas'), or an international event name */
  comp: string
  teamA: string
  teamB: string
  bo: 1 | 3 | 5
  /** bracket label, e.g. '常规赛 W3' / '胜者组决赛' */
  label: string
  played: boolean
  result?: MatchResult
  /** filled in for bracket games once seeding is known */
  pending?: boolean
}

export interface StandingRow {
  teamId: string
  w: number
  l: number
  mapW: number
  mapL: number
  roundW: number
  roundL: number
  pts: number
}

export interface Competition {
  key: string
  name: string
  region?: Region
  tier?: Tier
  stage: StageKey
  teams: string[]
  standings: Record<string, StandingRow>
  /** finishing order once the competition concludes (team ids, best first) */
  finished: string[]
  champion?: string
  /** seeds sitting out the opening knockout round */
  byes?: string[]
  /** true once the group phase has been converted into a bracket */
  bracketStarted?: boolean
  /** prize money and championship points have been handed out */
  awarded?: boolean
}

export interface NewsItem {
  day: number
  kind: 'match' | 'transfer' | 'league' | 'club' | 'player' | 'system'
  text: string
  important?: boolean
}

export interface TransferOffer {
  id: string
  playerId: string
  fromTeam: string | null
  toTeam: string
  fee: number
  salary: number
  years: number
  /** day the offer was made; offers expire */
  day: number
  status: 'pending' | 'accepted' | 'rejected' | 'expired'
  /** null when the club accepted but the player still has to agree */
  note?: string
}

export interface Inbox {
  items: NewsItem[]
}

export interface GameState {
  version: number
  seed: number
  /** day index since career start */
  day: number
  year: number
  stage: StageKey
  /** the team the human manages */
  myTeam: string
  managerName: string
  players: Record<string, Player>
  teams: Record<string, Team>
  comps: Record<string, Competition>
  fixtures: Fixture[]
  news: NewsItem[]
  offers: TransferOffer[]
  /** per-player weekly training focus */
  training: Record<string, keyof Attrs | 'rest'>
  finances: {
    balance: number
    log: { day: number; label: string; amount: number }[]
  }
  /** career-long honours for the managed club */
  honours: { year: number; title: string }[]
  /** last processed match ids so the UI can surface results */
  lastResults: string[]
  boardConfidence: number
  gameOver?: string
}
