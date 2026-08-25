import type { Manager } from './manager'

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

/**
 * A squad-wide drill run alongside each player's individual focus.
 *
 * Individual practice only ever moved one number on one player, which made the
 * training screen a row of identical dropdowns. These are the sessions a real
 * team actually runs, and each touches several things at once.
 */
/**
 * The squad-wide session for the week.
 *
 * These three compete for the same practice time, so only one can run. Pair
 * work is separate — two players staying behind to drill together does not
 * stop the other three doing anything.
 */
export type TeamDrill =
  | { kind: 'none' }
  /** run the map until everyone knows it: map comfort plus cohesion */
  | { kind: 'map'; map: string }
  /** the coach takes them through the tape: reading the game, and calling it */
  | { kind: 'review' }
  /** learning an agent from a role they do not yet cover */
  | { kind: 'agent'; playerId: string; role: Role }

/**
 * A club approaching the manager.
 *
 * Success is not rewarded by unlocking a menu — it is rewarded by better clubs
 * wanting you. The very top jobs only ever arrive this way.
 */
export interface JobOffer {
  id: string
  teamId: string
  day: number
  expiresOn: number
  /** what they are offering you, in their words */
  pitch: string
}

/** Something the manager did, so the day can be recounted. */
export interface Activity {
  day: number
  kind: 'training' | 'scrim' | 'transfer' | 'squad' | 'tactics' | 'commercial'
  text: string
}

/** The standing a player was promised when they signed. */
export type SquadRole = 'star' | 'starter' | 'rotation' | 'bench'

export const SQUAD_ROLE_CN: Record<SquadRole, string> = {
  star: '核心', starter: '首发', rotation: '轮换', bench: '替补',
}

/**
 * Everything agreed at signing, not just a wage. Each term is a lever the
 * manager can trade against the others: cash up front instead of salary, a
 * bigger prize cut instead of either, or a promise about playing time that the
 * club then has to honour.
 */
export interface Contract {
  /** annual base, in USD */
  salary: number
  years: number
  /** one-off payment on signing */
  signingBonus: number
  /** share of prize money paid to the player, percent */
  bonusShare: number
  /** the standing the club committed to */
  promisedRole: SquadRole
  /** fixed fee another club can trigger; 0 means none */
  releaseClause: number
  /** the player agreed not to be sold without consent */
  noPoach: boolean
}

export const defaultContract = (salary: number, years: number): Contract => ({
  salary, years, signingBonus: 0, bonusShare: 10,
  promisedRole: 'starter', releaseClause: 0, noPoach: false,
})

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
  /**
   * How well the player knows each role, 0-100.
   *
   * Learning a position is not a switch that flips. Drilling a new role builds
   * this up; only at 100 does he genuinely cover it, and the climb is slow
   * enough that retraining a position is a season-long project, not a month.
   */
  rolePro?: Partial<Record<Role, number>>
  /** true when they cover a second role for their club */
  flex?: boolean
  /** derived from real statistics, not authored */
  traits?: Trait[]
  age: number
  isIgl: boolean
  attrs: Attrs
  overall: number
  /**
   * How much better this player is at the biggest events than his own
   * baseline, in rating points. Not any single attribute, so it is carried
   * separately and re-added on every recompute — folded into `overall` it was
   * lost the first time he trained.
   */
  stageBonus?: number
  potential: number
  /** 0-100, short-term performance swing */
  form: number
  morale: number
  fatigue: number
  salary: number
  value: number
  contractYears: number
  /** full terms; older saves fall back to salary/contractYears alone */
  contract?: Contract
  /** how let down they feel about promises the club has not kept, 0-100 */
  grievance?: number
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
  /**
   * Career rounds behind this player's numbers.
   *
   * A hundred rounds as a stand-in is not a career. Attributes are already
   * shrunk toward the league mean when this is small, and selection uses it so
   * an unknown quantity does not displace a proven starter.
   */
  rounds?: number
  /**
   * Month the player joined their club, as YYYY-MM, from vlr.gg.
   *
   * Used to work out how long two team-mates have actually played together —
   * absent where vlr does not record it.
   */
  joined?: string
  /**
   * How much this player trusts the manager, 0-100.
   *
   * Slower and more cumulative than morale, and about you rather than about
   * results — see engine/trust.ts.
   */
  trust?: number
  /** a streaming contract this player has signed */
  stream?: StreamDeal
  /** set when the player has been transfer-listed by their club */
  listed?: boolean
  /** the day they went on the list, so a stale listing can be withdrawn */
  listedOn?: number
  /** career marks already announced, so a milestone is reported once */
  marks?: { maps?: number }
  /** day he last asked for a better contract — see engine/life.ts */
  payAskedOn?: number
  /** day a rival was last reported to be watching him */
  rumourOn?: number
  /** whether his form was last reported as hot or cold, so it is said once */
  formFlag?: 'hot' | 'cold'
}

export interface Coach {
  name: string
  tactics: number
  development: number
  motivation: number
  /** paid weekly alongside the players; absent for the coach a club started with */
  salary?: number
}

export type StaffRole = 'head' | 'assistant' | 'analyst'

/**
 * What an analyst is actually good at.
 *
 * Only a handful exist in the real data, so they are differentiated by job
 * rather than by a couple of rating points — you hire the one whose speciality
 * fixes your problem.
 */
export type AnalystSpec = 'maps' | 'opponent' | 'potential' | 'economy' | 'review'

/** A real coach from the world data, available to hire. */
export interface StaffCandidate {
  name: string
  spec?: AnalystSpec
  /** the club they currently work at */
  from: string
  tactics: number
  development: number
  motivation: number
  salary: number
}

/** The manager's own deal with their club. */
export interface ManagerContract {
  salary: number
  years: number
  /** season it was signed */
  since: number
}

/** A job the manager has applied for, waiting on the club's answer. */
export interface JobApplication {
  id: string
  teamId: string
  day: number
  replyOn: number
  /** what the manager asked for */
  salary: number
  years: number
  answer?: 'accept' | 'reject'
  reason?: string
}

/**
 * An approach to another club about a coach they employ.
 *
 * You cannot simply offer a job to someone who already has one — the club has
 * to release them to talk to you first, and can say no.
 */
export interface StaffApproach {
  id: string
  /** the club that employs them */
  teamId: string
  name: string
  /** compensation offered to the club */
  fee: number
  day: number
  replyOn: number
  answer?: 'granted' | 'refused'
  reason?: string
}

/** An approach made to a coach, waiting on their answer. */
export interface StaffOffer {
  id: string
  name: string
  from: string
  role: StaffRole
  salary: number
  years: number
  /** day the offer was made, and the day they will answer */
  day: number
  replyOn: number
  tactics: number
  development: number
  motivation: number
  answer?: 'accept' | 'reject'
  reason?: string
}

/** Somebody on the coaching staff. */
export interface StaffMember {
  name: string
  role: StaffRole
  /** set for analysts */
  spec?: AnalystSpec
  tactics: number
  development: number
  motivation: number
  salary: number
  years: number
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

export type GigKind = 'fanmeet' | 'brand' | 'campus' | 'shoot' | 'stream'

/**
 * A commercial booking: an appearance, a shoot, a stream.
 *
 * Money the club does not have to win. The cost is the squad's time — every
 * attendee loses a share of that week's training.
 */
export interface Gig {
  id: string
  kind: GigKind
  label: string
  partner: string
  /** the day it takes place — chosen by the manager within the window */
  day: number
  /** the last day the partner can accommodate it */
  windowEnd?: number
  /** last day it can still be accepted */
  expiresOn: number
  fee: number
  /** how many players must attend */
  heads: number
  fatigue: number
  morale: number
  fans: number
  blurb: string
  accepted?: boolean
  attendees?: string[]
  done?: boolean
}

/** A club-run event the manager organises, rather than one they are invited to. */
export type VentureKind = 'openday' | 'bootcamp' | 'watchparty' | 'merch'

export interface Venture {
  kind: VentureKind
  /** day it pays out */
  day: number
  cost: number
  heads: number
  attendees: string[]
}

/** A player's streaming deal: steady money, at a cost to their week. */
export interface StreamDeal {
  platform: string
  /** total paid over the term, not a season */
  fee: number
  /** term length; platforms sign short and renegotiate */
  months: number
  /** hours a week, which is what makes it a trade-off */
  nights: number
  since: number
  /** day the deal lapses */
  until: number
}

/**
 * An enquiry about a player who is not for sale.
 *
 * Most players a manager actually wants are neither listed nor free agents.
 * Asking costs nothing but time and tells you two things you could not
 * otherwise know: what the club would want for him, and whether he would even
 * consider the move.
 */
export interface PlayerEnquiry {
  id: string
  playerId: string
  /** the club that holds his contract */
  teamId: string
  day: number
  replyOn: number
  answer?: 'open' | 'closed'
  /** what the club says they would want, once they have answered */
  askingFee?: number
  /** how the player himself feels about it */
  interest?: 'keen' | 'open' | 'reluctant' | 'no'
  reason?: string
}

/** A sponsorship being negotiated, before it becomes a Sponsor. */
export interface SponsorTalk {
  id: string
  name: string
  industry: string
  /** guaranteed money per season */
  base: number
  /** extra per league placement above the threshold */
  bonus: number
  bonusPlacement: number
  /** what they want in return */
  demands: { key: 'gigs' | 'placing' | 'stream' | 'exclusive'; text: string }[]
  day: number
  replyOn: number
  /** 'offer' = terms are on the table, waiting for the manager */
  answer?: 'offer' | 'accept' | 'reject'
  reason?: string
}

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
  /** short form — EDG, XLG, KBG — used everywhere space is tight */
  tag: string
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

/**
 * Why a map went the way it did.
 *
 * The match engine already works these out to decide the result; keeping them
 * is what lets a manager see whether they lost on map comfort, on chemistry,
 * or on the sliders they set before kickoff.
 */
export interface EdgeBreakdown {
  /** weighted player ability */
  base: number
  igl: number
  chem: number
  coach: number
  /** role composition — a missing sentinel costs here */
  comp: number
  /** fielding fewer than five; absent on matches played before it was priced */
  shortHanded?: number
  map: number
  utility: number
  /** what the four tactical sliders were worth on each side */
  tacticsAtk: number
  tacticsDef: number
  atk: number
  def: number
}

export interface MapScore {
  map: string
  scoreA: number
  scoreB: number
  /** per-side factor breakdown, for the post-match explanation */
  edge?: { a: EdgeBreakdown; b: EdgeBreakdown }
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
  /** scrims skip the veto: the map and format are agreed in advance */
  scrim?: { map: string; format: 'first13' | 'full24' }
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
  /** the full package offered, when the UI produced one */
  terms?: Contract
  /** day the offer was made */
  day: number
  /** day the other side comes back to you */
  respondOn?: number
  status: 'pending' | 'accepted' | 'rejected' | 'expired'
  /** null when the club accepted but the player still has to agree */
  note?: string
}

export interface Inbox {
  items: NewsItem[]
}

/**
 * A target the board sets at the start of a competitive stage and judges at the
 * end of it. Stage-length rather than daily, so it gives the season a shape
 * without asking the manager to do anything every morning.
 */
export interface StageObjective {
  stage: StageKey
  /** finish at or above this position in the league table */
  placeAtLeast: number
  text: string
  settled?: boolean
  met?: boolean
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
  /** the manager's own background and skills */
  manager?: Manager
  players: Record<string, Player>
  teams: Record<string, Team>
  comps: Record<string, Competition>
  fixtures: Fixture[]
  news: NewsItem[]
  offers: TransferOffer[]
  /** per-player weekly training focus */
  training: Record<string, keyof Attrs | 'rest'>
  /** the squad-wide drill running alongside it */
  drill?: TeamDrill
  /** pair work, which runs alongside whichever main drill is set */
  duo?: { a: string; b: string }
  /**
   * Day the training plan can next be changed.
   *
   * A confirmed plan is committed until it has actually been run, so the week
   * is a decision rather than something you can keep nudging.
   */
  drillLock?: number
  /**
   * Set when a committed week was torn up.
   *
   * Cancelling is allowed, but it costs the week: the squad has already been
   * working to the old plan, so the new one does not start paying until the
   * next cycle.
   */
  drillVoid?: boolean
  /**
   * Pairwise relationships, keyed by the two player ids sorted and joined.
   *
   * Symmetric by construction — see engine/bonds.ts.
   */
  bonds?: Record<string, number>
  /**
   * Set while the guided trial day is running.
   *
   * The tutorial genuinely rewinds the clock to 31 December rather than
   * labelling 1 January as if it were — so the turn it teaches is one day long
   * and ends by arriving at the real first day.
   */
  tutorialDay?: boolean
  /** the day's action budget — see engine/actions.ts */
  actions?: { day: number; used: number }
  /** commercial offers on the table and already booked */
  gigs?: Gig[]
  /** club-run events currently being organised */
  ventures?: Venture[]
  /** day a sponsor pitch can next be made, so it is not spammable */
  pitchCooldown?: number
  /** optional rule: each club may hold at most two players from other regions */
  importLimit?: boolean
  /** sponsorship offers on the table, awaiting our answer or theirs */
  sponsorTalks?: SponsorTalk[]
  /**
   * Days each player spent on commercial work this week.
   *
   * Read at the weekly settlement: a day being famous is a day not practising.
   */
  commercialDays?: Record<string, number>
  /** a log of what the manager did, so today can be recounted */
  activity?: Activity[]
  finances: {
    balance: number
    log: { day: number; label: string; amount: number }[]
  }
  /** career-long honours for the managed club */
  honours: { year: number; title: string }[]
  /** last processed match ids so the UI can surface results */
  lastResults: string[]
  boardConfidence: number
  /** what the board asked for this stage, and how it was judged */
  objective?: StageObjective
  /** the board has warned us; another failure ends the job */
  onNotice?: boolean
  /** how many stage objectives we have missed in a row */
  missedStreak?: number
  /** assistants and analysts, alongside team.coach (the head coach) */
  staff?: StaffMember[]
  /** approaches to coaches that have not been answered yet */
  staffOffers?: StaffOffer[]
  /** clubs we have asked about their coach */
  staffApproaches?: StaffApproach[]
  /** players we have enquired about who were not on the market */
  enquiries?: PlayerEnquiry[]
  /** clubs currently trying to hire us away */
  jobOffers?: JobOffer[]
  /** jobs we have applied for ourselves */
  jobApplications?: JobApplication[]
  /** our own contract with the current club */
  managerContract?: ManagerContract
  /** clubs we have managed, in order */
  tenures?: { teamId: string; fromYear: number; toYear?: number }[]
  /** set when the career is over; the text is why */
  gameOver?: string
}
