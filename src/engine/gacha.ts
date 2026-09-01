/**
 * The card mode: pull real professionals, build a five, and take it out.
 *
 * Kept entirely separate from the career save. A career is a club you manage
 * over seasons; this is a collection you own across sessions, tied to an
 * account id rather than to one browser — see engine/account.ts. The two never
 * share state, and nothing here writes into a career.
 */
import { Rng, clamp, hashStr } from './rng'
import { WORLD_TEAMS } from './teams'
import { REGION_CN } from './types'
import {
  ALL_CARDS, COACH_CARDS, COINS_FOR, DUPES_FOR, LEGEND_CARDS, MAX_LEVEL, PLAYER_CARDS,
  SALVAGE, SQUAD_SLOTS, cardById, emptySquad, isPlayerCard, personOf, rarityRank, ratingAt,
  squadRating,
} from './cards'
import type { Card, CoachCard, Rarity, Squad } from './cards'
import { newChallenge } from './challenge'
import type { ChallengeState } from './challenge'

export const GACHA_VERSION = 1

// ---------------------------------------------------------------- packs

/**
 * The four series, and the pack that only deals from one of them.
 *
 * A single 607-card pile is a number, not a collection: 「还差多少」 has no
 * answer a person can hold, and no pull ever moves you visibly closer to
 * anything. Cut by the thing this sport is actually organised by — the four
 * regions — it becomes four collections you can finish, and a pack that deals
 * only from one of them is a way to chase the half you are missing rather
 * than the whole world at once.
 *
 * The regions come off the cards themselves; nothing here is invented.
 */
export const SERIES = ['China', 'Pacific', 'Americas', 'EMEA'] as const
export type Series = (typeof SERIES)[number]

export type PackKind =
  | 'scout' | 'elite' | 'ten' | 'coach'
  // one per series — same three cards, drawn only from that region
  | 'cn' | 'pac' | 'ame' | 'emea'

export interface PackDef {
  kind: PackKind
  name: string
  blurb: string
  cost: number
  draws: number
  /**
   * Chance of a彩卡 on each individual draw.
   *
   * Deliberately a lottery: twenty cards, and at five pulls a day it is months
   * between them. MYTHIC_FLOOR is the only thing that makes it a certainty.
   */
  mythic: number
  /** chance of a gold on each individual draw */
  gold: number
  silver: number
  /** the pack promises at least one card of this metal */
  floor?: Rarity
  /**
   * Whether coins can buy it at all.
   *
   * The ten-pull cannot. Capping the shop at two packs a day did nothing while
   * both of them could be ten-pulls — twenty cards is not a slower day than
   * twenty cards. It is now earned only: a promotion, a cup title, or a
   * seven-day streak. That also gives it something to be, which "the expensive
   * one" never was.
   */
  shop?: boolean
  /** coach packs deal from a different deck; a series deals from one region */
  pool: 'player' | 'coach' | Series
}

/**
 * Prices, set from what a day actually earns rather than from feel.
 *
 * scripts/economy_check.ts measures E(coins) per match from the simulation —
 * the reward table alone cannot, because it does not know the win rate. At
 * 大师 with the meter played out that is about 2,250 coins a day, so 750 buys
 * three 试训包 or banks most of a 选拔包, and choosing between those is the
 * decision the old two-a-day counter took away.
 */
export const PACKS: Record<PackKind, PackDef> = {
  scout: {
    kind: 'scout', name: '试训包', pool: 'player',
    blurb: '一张选手卡。大部分是铜卡，但金卡就是从这里出的。',
    cost: 750, draws: 1, mythic: 0.0001, gold: 0.03, silver: 0.26, shop: true,
  },
  elite: {
    kind: 'elite', name: '选拔包', pool: 'player',
    blurb: '三张选手卡，至少一张银卡起。',
    cost: 2400, draws: 3, mythic: 0.0004, gold: 0.08, silver: 0.38, floor: 'silver', shop: true,
  },
  ten: {
    kind: 'ten', name: '十连包', pool: 'player',
    blurb: '十张选手卡，必出金卡，彩卡出得最多。买不到——升段、夺冠、连签七天才有。',
    cost: 5000, draws: 10, mythic: 0.0012, gold: 0.06, silver: 0.34, floor: 'gold', shop: false,
  },
  // The series packs: same three cards as a 选拔包 and the same odds, priced a
  // little above it. What you are buying is not volume, it is aim — a 中国包
  // cannot hand you an EMEA bronze you already own twice, which is the whole
  // complaint about a 607-card pile answered in one line.
  cn: {
    kind: 'cn', name: '中国包', pool: 'China',
    blurb: '只出中国赛区的选手卡。三张，至少一张银卡起——想补哪个赛区就开哪个。',
    cost: 2600, draws: 3, mythic: 0.0004, gold: 0.08, silver: 0.38, floor: 'silver', shop: true,
  },
  pac: {
    kind: 'pac', name: '太平洋包', pool: 'Pacific',
    blurb: '只出太平洋赛区的选手卡。三张，至少一张银卡起。',
    cost: 2600, draws: 3, mythic: 0.0004, gold: 0.08, silver: 0.38, floor: 'silver', shop: true,
  },
  ame: {
    kind: 'ame', name: '美洲包', pool: 'Americas',
    blurb: '只出美洲赛区的选手卡。三张，至少一张银卡起。',
    cost: 2600, draws: 3, mythic: 0.0004, gold: 0.08, silver: 0.38, floor: 'silver', shop: true,
  },
  emea: {
    kind: 'emea', name: 'EMEA 包', pool: 'EMEA',
    blurb: '只出欧非中东赛区的选手卡。三张，至少一张银卡起。',
    cost: 2600, draws: 3, mythic: 0.0004, gold: 0.08, silver: 0.38, floor: 'silver', shop: true,
  },
  coach: {
    kind: 'coach', name: '教练包', pool: 'coach',
    blurb: '一名真实教练。带过你阵容里的人，默契还会更高。',
    // no legend coaches: a彩卡 is a night somebody played, and these twenty
    // nights were played by players
    cost: 1200, draws: 1, mythic: 0, gold: 0.12, silver: 0.42, shop: true,
  },
}

/**
 * Which series a pack belongs to, for the collection screen.
 */
export const seriesOfPack = (kind: PackKind): Series | null =>
  kind === 'cn' ? 'China'
    : kind === 'pac' ? 'Pacific'
      : kind === 'ame' ? 'Americas'
        : kind === 'emea' ? 'EMEA' : null

export const PACK_ORDER: PackKind[] = [
  'scout', 'elite', 'ten', 'coach', 'cn', 'pac', 'ame', 'emea',
]

/**
 * How long a dry run is allowed to get.
 *
 * Pure 4% means one player in fifty opens twenty-five packs without a gold and
 * concludes the game is broken — which, from where they are sitting, it is.
 * Odds climb from the 25th pull and the 45th is a certainty.
 */
export const SOFT_PITY = 25
export const HARD_PITY = 45

/**
 * How long a彩卡 drought is allowed to run.
 *
 * The odds alone are months between cards, which is the point — but "never" is
 * not a feeling a collection should be able to produce.
 *
 * This number, not the `mythic` rates above, is what decides how rare a legend
 * actually is. At one draw a pack the floor alone pays 1/500, while the
 * natural roll paid 0.03% — measured, the 试训包 handed out a彩卡 every 458
 * packs and seven eighths of them came from here. Lowering the published rate
 * without moving this would have changed almost nothing.
 */
export const MYTHIC_FLOOR = 1200

// ---------------------------------------------------------------- the day

/**
 * Why the mode has a daily budget at all.
 *
 * It did not, and the whole thing collapsed into one sitting: the ladder and
 * the cup could be played forever, forever meant unlimited coins, and unlimited
 * coins meant unlimited packs. A collection you can finish in an afternoon is
 * not a collection, and there was no reason to ever come back tomorrow.
 *
 * Two taps, closed in the two places that were open. Matches cost 体力, which
 * refills once a day; and coins can only buy a couple of packs a day however
 * many coins you have. Packs you were GIVEN — the check-in, the quest board, a
 * promotion, a cup title — are not capped, because those are already once-a-day
 * things and taking them away twice would just be mean.
 */
export const STAMINA_MAX = 15
export const STAMINA_COST = { ladder: 2, cup: 3 } as const
export type PlayKind = keyof typeof STAMINA_COST

/**
 * How long one point takes to come back.
 *
 * It used to be a single refill at midnight, which produced exactly the shape
 * you would expect: burn the lot in one sitting, then nothing to do until
 * tomorrow. A trickle lets the same daily allowance be spent in two or three
 * visits instead of one.
 *
 * One every 50 minutes, cap 15: a ladder match every 100 minutes sustained,
 * seven in a row from a full meter, 12.5 hours to fill it, and 28.8 points a
 * day if you check in through the day.
 *
 * It was one every two hours, chosen to hold the daily ceiling at six matches.
 * That reasoning ignored that nobody is awake for 24 hours — eight of those
 * hours are spent asleep, and with a 20-hour fill time the meter was still
 * only part full on waking. Two hours between matches is already a long wait
 * for a browser game. The pacing moved to where it belongs instead: the price
 * of a pack, which throttles without ever telling anyone they may not play.
 *
 * Then it was one an hour, which was tidy and slightly wrong: an hourly meter
 * hands out exactly 24 points a day, so a player who visits at the same two
 * times every day is forever one point short of the eighth match and the
 * remainder is always zero. Fifty minutes breaks that alignment — 28.8 points
 * a day — and the whole of the surplus lands on people who come back more
 * than once, which is the behaviour worth paying for. The wait a player
 * actually feels, one ladder match, goes from two hours to 1h40m.
 */
export const STAMINA_REGEN_MS = 50 * 60 * 1000

/**
 * "50 分钟" / "1 小时" — the interval in the largest whole unit that fits it.
 *
 * Exported with an argument because the balance scripts label their comparison
 * rows with it too. The interval has been retuned three times now and the
 * first two times a hardcoded "每 2 小时" survived in three separate strings,
 * so the game told players something that was no longer true.
 */
export const staminaEvery = (ms: number = STAMINA_REGEN_MS): string => {
  const min = Math.round(ms / 60_000)
  return min % 60 === 0 ? `${min / 60} 小时` : `${min} 分钟`
}

/** "每 50 分钟回 1 点" — written from the constant, never typed out. */
export const staminaRate = (): string => {
  const every = staminaEvery()
  return every === '1 小时' ? '每小时回 1 点' : `每 ${every}回 1 点`
}

/**
 * How long a full meter takes to build from empty, in hours.
 *
 * One decimal, because the interval no longer divides an hour: rounding 12.5
 * to 13 would put a number on screen that the meter itself contradicts.
 */
export const staminaFillHours = (): number =>
  Math.round((STAMINA_MAX * STAMINA_REGEN_MS) / 360_000) / 10

/**
 * There is no daily purchase limit, deliberately.
 *
 * There was one, and it was the wrong tool: opening packs is what the mode IS,
 * and a counter that says "no more today" with coins still in your pocket is a
 * closed door on the front of the game. It also barely bound — at the old
 * prices a day's play only ever bought two packs anyway, so the cap was mostly
 * decoration with an occasional insult attached. Prices do the pacing now.
 */

const goldChance = (base: number, pity: number): number => {
  if (pity >= HARD_PITY - 1) return 1
  if (pity < SOFT_PITY) return base
  return Math.min(1, base + (pity - SOFT_PITY + 1) * 0.055)
}

// ---------------------------------------------------------------- state

export interface OwnedCard {
  id: string
  /** 0-5; each level is +1 rating */
  level: number
  /** spare copies, spent on levelling or sold */
  dupes: number
  /** total copies ever pulled, for the collection stats */
  seen: number
  /** ISO date of the first copy */
  got: string
}

export const DIVISIONS = ['青铜', '白银', '黄金', '铂金', '钻石', '大师'] as const

/**
 * The rungs inside a division, and what each is worth.
 *
 * Six divisions was too coarse to feel like progress — 「一直打那个星也不会
 * 长」 — so each one is cut into numbered rungs the way every ladder in this
 * genre does it: 青铜 III → 青铜 II → 青铜 I → 白银 III. 钻石 gets four,
 * because the last stretch before 大师 should be the long one.
 *
 * Deliberately the SAME number of stars per division as before (3/3/6/6/8
 * against the old 3/4/5/6/8, 26 either way): this is more frequent feedback on
 * the same climb, not a longer climb. Nothing about an existing save changes
 * except how it is drawn.
 */
export const TIERS_PER_DIV = [3, 3, 3, 3, 4, 1] as const
const STARS_PER_TIER = [1, 1, 2, 2, 2, 0] as const

/** Roman numerals, biggest number at the bottom of the division. */
const TIER_CN = ['I', 'II', 'III', 'IV'] as const

export const starsFor = (div: number): number => {
  const d = clamp(div, 0, DIVISIONS.length - 1)
  return TIERS_PER_DIV[d] * STARS_PER_TIER[d]
}

/** Which rung of its division a star count sits on, counted from the bottom. */
export const tierOf = (div: number, stars: number): number => {
  const d = clamp(div, 0, DIVISIONS.length - 1)
  const per = STARS_PER_TIER[d]
  if (per <= 0) return 0
  return clamp(Math.floor(stars / per), 0, TIERS_PER_DIV[d] - 1)
}

/** Stars showing on the rung currently being climbed. */
export const starsOnTier = (div: number, stars: number): number => {
  const d = clamp(div, 0, DIVISIONS.length - 1)
  const per = STARS_PER_TIER[d]
  return per <= 0 ? 0 : stars % per
}

export const tierStars = (div: number): number =>
  STARS_PER_TIER[clamp(div, 0, DIVISIONS.length - 1)]

/**
 * 大师 and the two ranks past it.
 *
 * Above 大师 the ladder stops counting stars and starts counting points, with
 * no ceiling — the whole complaint was that the climb ended. The names are
 * VALORANT's own top ranks rather than invented ones.
 */
export const MASTER_DIV = DIVISIONS.length - 1
export const MASTER_TITLES = [
  { at: 2500, name: '辐能' },
  { at: 1000, name: '不朽' },
  { at: 0, name: '大师' },
] as const

export const masterTitle = (points: number): string =>
  MASTER_TITLES.find((t) => points >= t.at)?.name ?? '大师'

/** What the badge says, at any point on the ladder. */
export function rankName(div: number, stars: number, points = 0): string {
  if (div >= MASTER_DIV) return `${masterTitle(points)} ${points}`
  return `${DIVISIONS[div]} ${TIER_CN[TIERS_PER_DIV[div] - 1 - tierOf(div, stars)]}`
}

export interface LadderState {
  div: number
  stars: number
  best: number
  wins: number
  losses: number
  streak: number
  /** 大师 and above only: the uncapped score the leaderboard ranks on */
  points?: number
  /** the highest that score has ever been, which is what a career is judged on */
  bestPoints?: number
}

export interface CupLeg {
  opponent: string
  win: boolean
  mapsWon: number
  mapsLost: number
}

export interface CupState {
  /** the three clubs standing between you and the trophy */
  path: string[]
  round: number
  legs: CupLeg[]
  done: boolean
  won: boolean
  /** what the entry fee was, so the payout table can be read against it */
  entry: number
}

export type QuestKey = 'play3' | 'win2' | 'open2' | 'upgrade1' | 'cup1'

export interface Quest {
  key: QuestKey
  label: string
  target: number
  reward: number
}

export const QUESTS: Record<QuestKey, Quest> = {
  play3: { key: 'play3', label: '打 3 场天梯', target: 3, reward: 240 },
  win2: { key: 'win2', label: '赢 2 场天梯', target: 2, reward: 320 },
  open2: { key: 'open2', label: '开 2 个卡包', target: 2, reward: 200 },
  upgrade1: { key: 'upgrade1', label: '升级 1 张卡', target: 1, reward: 260 },
  cup1: { key: 'cup1', label: '打 1 轮杯赛', target: 1, reward: 300 },
}

export interface DailyState {
  /** server date of the last check-in, YYYY-MM-DD */
  claimed: string | null
  streak: number
  /** the day the current quest set belongs to */
  questDay: string | null
  picked: QuestKey[]
  progress: Partial<Record<QuestKey, number>>
  taken: QuestKey[]
  /** 体力 banked at `staminaAt`, and the moment it was banked (epoch ms) */
  stamina: number
  staminaAt: number
}

export interface LogEntry {
  at: string
  text: string
}

export interface GachaState {
  version: number
  /** the account id this collection belongs to; the whole of identity */
  id: string
  name: string
  createdAt: string
  coins: number
  cards: Record<string, OwnedCard>
  packs: Partial<Record<PackKind, number>>
  squad: Squad
  /** pulls since the last gold */
  pity: number
  /** pulls since the last彩卡 — see MYTHIC_FLOOR */
  mythicDry: number
  pulls: number
  ladder: LadderState
  cup: CupState | null
  daily: DailyState
  /** 每日挑战 — see engine/challenge.ts */
  challenge?: ChallengeState
  /** how many series milestones have been collected, per region */
  series?: Partial<Record<Series, number>>
  /** 好友对战房 — see FriendRec */
  friends?: FriendRec[]
  /** saved squad presets — see SQUAD_PRESETS */
  presets?: (SquadPreset | null)[]
  log: LogEntry[]
  /** rolling seed, so a reload cannot reroll the same pack */
  seed: number
}

/**
 * Somebody you have played, and the running score between you.
 *
 * Kept on your own save rather than the server, and that is the honest shape
 * of it: a friendly costs nothing, pays nothing, and moves no ladder, so there
 * is nothing here worth defending against a determined liar. Two accounts
 * trading wins would be farming a number that buys nothing, which is exactly
 * why the friendlies pay nothing.
 *
 * It also means the two sides keep their own tallies. They will agree as long
 * as both people play their matches; they are not one shared record, and the
 * screen says so.
 */
export interface FriendRec {
  /** eight characters of their id's hash — never their id */
  code: string
  name: string
  tag: string
  wins: number
  losses: number
  /** last played, as a date */
  at: string
}

export const FRIEND_MAX = 24

/** File the result of a friendly, newest friend first. */
export function recordFriend(
  g: GachaState,
  who: { code: string; name: string; tag: string },
  win: boolean,
  today: string,
): FriendRec {
  const list = (g.friends ?? []).filter((f) => f.code !== who.code)
  const old = (g.friends ?? []).find((f) => f.code === who.code)
  const rec: FriendRec = {
    code: who.code,
    // the name is theirs and can change; keep the latest one they saved
    name: who.name, tag: who.tag,
    wins: (old?.wins ?? 0) + (win ? 1 : 0),
    losses: (old?.losses ?? 0) + (win ? 0 : 1),
    at: today,
  }
  g.friends = [rec, ...list].slice(0, FRIEND_MAX)
  return rec
}

/**
 * A squad you can come back to.
 *
 * Three slots, because the reason people asked for this is that they keep two
 * or three fives on the go — an all-EMEA one, an all-Pacific one, and the one
 * with their favourites in it — and rebuilding a five card by card to try the
 * other one is the kind of chore that stops people trying it at all.
 *
 * A preset stores card ids, not cards. Sell or salvage a card and the slot it
 * was in simply comes back empty when the preset is loaded, which is the
 * honest outcome — the alternative is a five that silently plays short.
 */
export interface SquadPreset {
  name: string
  squad: Squad
}

export const SQUAD_PRESETS = 3

/** Read the presets as a fixed-length list, whatever the save holds. */
export const presetsOf = (g: GachaState): (SquadPreset | null)[] =>
  Array.from({ length: SQUAD_PRESETS }, (_, i) => g.presets?.[i] ?? null)

/** Copy the five on the table into a slot. */
export function savePreset(g: GachaState, slot: number, name?: string): SquadPreset {
  const list = presetsOf(g)
  const rec: SquadPreset = {
    name: (name ?? list[slot]?.name ?? `配置 ${slot + 1}`).slice(0, 12),
    squad: { slots: [...g.squad.slots], coach: g.squad.coach },
  }
  list[slot] = rec
  g.presets = list
  note(g, `保存了卡组配置「${rec.name}」`)
  return rec
}

/**
 * Put a saved five back on the table.
 *
 * Anything no longer in the collection is dropped rather than restored, and
 * the count of what was dropped is returned so the screen can say so. A preset
 * quietly loading four men is worse than one that tells you it lost a card.
 */
export function loadPreset(g: GachaState, slot: number): { ok: boolean; missing: number } {
  const rec = presetsOf(g)[slot]
  if (!rec) return { ok: false, missing: 0 }
  let missing = 0
  const have = (id: string | null) => {
    if (!id) return null
    if (g.cards[id]) return id
    missing++
    return null
  }
  const slots = rec.squad.slots.slice(0, 5).map(have)
  while (slots.length < 5) slots.push(null)
  // the same person cannot occupy two seats — the ordinary card and his 彩卡
  // are two ids and one man
  const seen: string[] = []
  for (let i = 0; i < slots.length; i++) {
    const id = slots[i]
    if (!id) continue
    const who = (cid: string) => { const c = cardById(cid); return c ? personOf(c) : cid }
    if (seen.some((x) => who(x) === who(id))) { slots[i] = null; missing++ }
    else seen.push(id)
  }
  g.squad = { slots, coach: have(rec.squad.coach) }
  return { ok: true, missing }
}

export function renamePreset(g: GachaState, slot: number, name: string): void {
  const list = presetsOf(g)
  if (!list[slot]) return
  list[slot] = { ...list[slot]!, name: name.slice(0, 12) || `配置 ${slot + 1}` }
  g.presets = list
}

export function clearPreset(g: GachaState, slot: number): void {
  const list = presetsOf(g)
  list[slot] = null
  g.presets = list.some(Boolean) ? list : undefined
}

/**
 * Hand a spare copy away.
 *
 * Only ever a duplicate. The collection's card count is a term in the server's
 * 「progress never goes backwards」 check, so parting with your last copy of
 * something would make the next save look like a rollback and be refused —
 * and beyond that, a collection that can shrink is a collection somebody can
 * be talked out of.
 */
export function giveCard(g: GachaState, cardId: string): boolean {
  const owned = g.cards[cardId]
  if (!owned || owned.dupes < 1) return false
  owned.dupes -= 1
  const card = cardById(cardId)
  note(g, `把一张${card && isPlayerCard(card) ? card.ign : '卡'}送了出去`)
  return true
}

/** Take a card somebody sent. A card you already have arrives as a spare. */
export function receiveCard(g: GachaState, cardId: string, from: string): boolean {
  const card = cardById(cardId)
  if (!card) return false
  const had = g.cards[cardId]
  if (had) { had.dupes++; had.seen++ } else {
    g.cards[cardId] = {
      id: cardId, level: 0, dupes: 0, seen: 1, got: new Date().toISOString().slice(0, 10),
    }
  }
  note(g, `收到 ${from} 送的${isPlayerCard(card) ? card.ign : card.name}`)
  return true
}

export const STARTER_COINS = 3000

export function newGacha(id: string, name: string, today: string): GachaState {
  return {
    version: GACHA_VERSION,
    id,
    name,
    createdAt: today,
    coins: STARTER_COINS,
    cards: {},
    // enough to field a five on the first visit without spending anything
    packs: { scout: 3, elite: 1, coach: 1 },
    squad: emptySquad(),
    pity: 0,
    mythicDry: 0,
    pulls: 0,
    ladder: { div: 0, stars: 0, best: 0, wins: 0, losses: 0, streak: 0 },
    challenge: newChallenge(),
    cup: null,
    daily: {
      claimed: null, streak: 0, questDay: null, picked: [], progress: {}, taken: [],
      stamina: STAMINA_MAX, staminaAt: 0,
    },
    log: [],
    seed: hashStr(id + today) >>> 0,
  }
}

/** Advance and return the account's own rng, so nothing is re-rollable. */
/**
 * The account's own rng, advanced so nothing is re-rollable.
 *
 * The stored seed used to be written back after a SINGLE burn, before the
 * caller had drawn anything — so the next pack started one step behind where
 * this one started and replayed almost the same sequence. Measured: two
 * consecutive 十连包 shared 7.2 of their 20 cards, which is what the group
 * meant by 「开了两个十连卡包好像有九张卡都一样」. Within one pack it was
 * fine, which is why it looked like bad luck rather than a bug.
 *
 * `done` is what actually fixes it: the seed is written back past everything
 * the pack consumed. The burn stays, so a tab that dies mid-pack still cannot
 * reload and re-roll the same one.
 */
function roll(g: GachaState): { rng: Rng; done: () => void } {
  const rng = new Rng(g.seed)
  rng.next()
  g.seed = rng.state
  return { rng, done: () => { g.seed = rng.state } }
}

const note = (g: GachaState, text: string) => {
  g.log.unshift({ at: new Date().toISOString(), text })
  if (g.log.length > 60) g.log.length = 60
}

export const levelOf = (g: GachaState, cardId: string): number => g.cards[cardId]?.level ?? 0
export const owns = (g: GachaState, cardId: string): boolean => !!g.cards[cardId]

// ---------------------------------------------------------------- pulling

const bySeries = <T extends { region?: string }>(list: readonly T[], region: Series) =>
  list.filter((c) => c.region === region)

const seriesPool = (region: Series) => ({
  mythic: bySeries(LEGEND_CARDS, region),
  gold: bySeries(PLAYER_CARDS.filter((c) => c.rarity === 'gold'), region),
  silver: bySeries(PLAYER_CARDS.filter((c) => c.rarity === 'silver'), region),
  bronze: bySeries(PLAYER_CARDS.filter((c) => c.rarity === 'bronze'), region),
})

const POOLS = {
  player: {
    mythic: LEGEND_CARDS,
    gold: PLAYER_CARDS.filter((c) => c.rarity === 'gold'),
    silver: PLAYER_CARDS.filter((c) => c.rarity === 'silver'),
    bronze: PLAYER_CARDS.filter((c) => c.rarity === 'bronze'),
  },
  China: seriesPool('China'),
  Pacific: seriesPool('Pacific'),
  Americas: seriesPool('Americas'),
  EMEA: seriesPool('EMEA'),
  coach: {
    mythic: [] as CoachCard[],
    gold: COACH_CARDS.filter((c) => c.rarity === 'gold'),
    silver: COACH_CARDS.filter((c) => c.rarity === 'silver'),
    bronze: COACH_CARDS.filter((c) => c.rarity === 'bronze'),
  },
} as const

export interface Pulled {
  card: Card
  /** already owned, so this copy stacks as a duplicate */
  dupe: boolean
  /** what a spare copy would sell for, shown on the reveal */
  salvage: number
}

/**
 * Deal one pack.
 *
 * Mutates the account: spends the pack (or the coins), advances pity, and
 * files what came out. Returns the cards in the order they should be revealed
 * — worst first, so the flip that matters is the last one.
 */
export function openPack(
  g: GachaState, kind: PackKind, payWith: 'pack' | 'coins', today?: string,
): Pulled[] {
  const def = PACKS[kind]
  if (payWith === 'pack') {
    if ((g.packs[kind] ?? 0) < 1) throw new Error('没有这种卡包')
    g.packs[kind] = (g.packs[kind] ?? 0) - 1
  } else {
    if (def.shop === false) throw new Error(`${def.name}买不到，只能靠升段、夺冠或连签拿`)
    const price = packCost(kind, today)
    if (g.coins < price) throw new Error('金币不够')
    g.coins -= price
  }

  const { rng, done } = roll(g)
  const pool = POOLS[def.pool]
  const metals: Rarity[] = []
  for (let i = 0; i < def.draws; i++) {
    const r = rng.next()
    let metal: Rarity
    // the彩卡 roll happens first and on its own budget, so raising the gold
    // rate never quietly changes how rare a legend is
    const owed = def.mythic > 0 && g.mythicDry >= MYTHIC_FLOOR
    if (owed || r < def.mythic) {
      metal = 'mythic'
    } else {
      const gc = goldChance(def.gold, g.pity)
      // re-roll inside the remaining probability so the metals still sum to 1
      const rest = (r - def.mythic) / Math.max(1e-9, 1 - def.mythic)
      if (rest < gc) metal = 'gold'
      else if (rest < gc + def.silver) metal = 'silver'
      else metal = 'bronze'
    }
    if (metal === 'mythic') { g.mythicDry = 0; g.pity = 0 } else {
      // a coach pack cannot produce a彩卡, so it must not count toward the
      // floor either — otherwise the guarantee could be spent on a deck it
      // can never be paid out of
      if (def.mythic > 0) g.mythicDry = (g.mythicDry ?? 0) + 1
      if (metal === 'gold') g.pity = 0
      else g.pity++
    }
    metals.push(metal)
  }
  // honour the pack's promise on the last card, which is the one being watched
  if (def.floor) {
    const bestAt = metals.reduce(
      (b, m, i) => (rarityRank(m) > rarityRank(metals[b]) ? i : b), 0)
    if (rarityRank(metals[bestAt]) < rarityRank(def.floor)) {
      metals[bestAt] = def.floor
      if (def.floor === 'gold') g.pity = 0
    }
  }
  // worst first, so the card that matters is the last one turned over. Note
  // this is REVEAL order, not roll order — the floor counter above ran in roll
  // order, so a run measured off the reveal can look one pack longer than it was.
  metals.sort((a, b) => rarityRank(a) - rarityRank(b))

  const out: Pulled[] = []
  for (const metal of metals) {
    const list: readonly Card[] = pool[metal].length ? pool[metal] : pool.bronze
    const card = rng.pick(list)
    const had = g.cards[card.id]
    if (had) {
      had.dupes++
      had.seen++
    } else {
      g.cards[card.id] = {
        id: card.id, level: 0, dupes: 0, seen: 1, got: new Date().toISOString().slice(0, 10),
      }
    }
    out.push({ card, dupe: !!had, salvage: SALVAGE[card.rarity] })
  }
  g.pulls += def.draws
  bumpQuest(g, 'open2', 1)
  // past everything this pack drew, so the next one does not replay it
  done()

  const name = (c: Card) => (c.kind === 'player' ? c.ign : c.name)
  const mythics = out.filter((p) => p.card.rarity === 'mythic')
  const golds = out.filter((p) => p.card.rarity === 'gold')
  note(g, mythics.length
    ? `${def.name}：★ 彩卡 ${mythics.map((p) => (isPlayerCard(p.card) && p.card.legend ? p.card.legend.title : name(p.card))).join('、')}`
    : golds.length
      ? `${def.name}：抽到 ${golds.map((p) => name(p.card)).join('、')}（金卡）`
      : `${def.name}：${def.draws} 张，没有金卡`)
  return out
}

// ---------------------------------------------------------------- collection

/** Sell spare copies of a card. Never touches the copy in the collection. */
export function salvage(g: GachaState, cardId: string, count: number): number {
  const owned = g.cards[cardId]
  const card = cardById(cardId)
  if (!owned || !card) return 0
  const n = Math.max(0, Math.min(count, owned.dupes))
  if (!n) return 0
  owned.dupes -= n
  const coins = SALVAGE[card.rarity] * n
  g.coins += coins
  return coins
}

export interface UpgradeCost {
  dupes: number
  coins: number
  /** null when the card is already at the ceiling */
  to: number | null
  can: boolean
  why?: string
}

export function upgradeCost(g: GachaState, cardId: string): UpgradeCost {
  const owned = g.cards[cardId]
  if (!owned) return { dupes: 0, coins: 0, to: null, can: false, why: '还没有这张卡' }
  if (owned.level >= MAX_LEVEL) return { dupes: 0, coins: 0, to: null, can: false, why: '已经满级' }
  const dupes = DUPES_FOR[owned.level]
  const coins = COINS_FOR[owned.level]
  const can = owned.dupes >= dupes && g.coins >= coins
  return {
    dupes,
    coins,
    to: owned.level + 1,
    can,
    why: can ? undefined : owned.dupes < dupes ? `还差 ${dupes - owned.dupes} 张重复卡` : '金币不够',
  }
}

export function upgrade(g: GachaState, cardId: string): boolean {
  const cost = upgradeCost(g, cardId)
  if (!cost.can || cost.to == null) return false
  const owned = g.cards[cardId]
  owned.dupes -= cost.dupes
  g.coins -= cost.coins
  owned.level = cost.to
  const card = cardById(cardId)
  if (card) {
    note(g, `${card.kind === 'player' ? card.ign : card.name} 升到 +${owned.level}`
      + `（${ratingAt(card.rating, owned.level)}）`)
  }
  bumpQuest(g, 'upgrade1', 1)
  return true
}

/** Everything owned, with the card behind it, ready for the collection grid. */
export function collection(g: GachaState): { card: Card; owned: OwnedCard; rating: number }[] {
  return Object.values(g.cards)
    .map((owned) => {
      const card = cardById(owned.id)
      return card ? { card, owned, rating: ratingAt(card.rating, owned.level) } : null
    })
    .filter((x): x is { card: Card; owned: OwnedCard; rating: number } => !!x)
    .sort((a, b) => b.rating - a.rating)
}

export const collectionProgress = (g: GachaState) => ({
  owned: Object.keys(g.cards).length,
  total: ALL_CARDS.length,
})

/**
 * The four series, and how far into each one you are.
 *
 * 「607 张里有 9 张」 is a number nobody can act on. 「中国 9/143」 is four
 * collections that can each be finished, and it says which pack to open next.
 * Counted off the cards, so a legend of a Chinese player counts toward China
 * exactly as his ordinary card does.
 */
export interface SeriesProgress {
  region: Series
  owned: number
  total: number
  /** the pack that only deals from this series; 彩卡 counted apart */
  pack: PackKind
  legends: number
  legendsTotal: number
  /** milestones reached but not yet collected */
  ready: SeriesReward[]
  /** the next one, and how many more cards it wants */
  next: (SeriesReward & { need: number }) | null
}

/**
 * What a series pays out on the way through.
 *
 * A collection with no landmarks is a number that goes up, and a number that
 * goes up is not a reason to open another pack. Four marks per region, the
 * last one paying a 十连包 — the pack that cannot be bought — so finishing a
 * region is worth something you cannot simply buy your way to.
 */
export interface SeriesReward {
  /** share of the series, as a fraction */
  at: number
  coins: number
  /** 'self' means the series' own pack */
  pack?: PackKind | 'self'
  count?: number
  label: string
}

/**
 * Measured, not guessed: 25% of a region costs about 15 packs, 50% about 45,
 * 75% about 90, and the last card some three hundred more. The marks sit where
 * the curve bends, and the 90% one pays in the region's own packs because that
 * is the stretch where an ordinary pack has almost nothing left to give you.
 *
 * The whole ladder returns roughly 3% of what a region costs to finish. It is
 * meant to be a landmark, not an income — a series that paid for itself would
 * make every other pack on the shelf pointless.
 */
export const SERIES_REWARDS: SeriesReward[] = [
  { at: 0.25, coins: 1500, label: '+1500 金币' },
  { at: 0.5, coins: 1500, pack: 'elite', label: '选拔包 ×1，+1500 金币' },
  { at: 0.75, coins: 5000, label: '+5000 金币' },
  { at: 0.9, coins: 0, pack: 'self', count: 2, label: '本赛区包 ×2' },
  { at: 1, coins: 15000, pack: 'ten', label: '十连包 ×1，+15000 金币' },
]

/**
 * Built from the pack's own pool, not from every card that carries a region.
 *
 * Coaches have a region too, and a 中国包 cannot deal one — count them and the
 * bar stops at 122/136 with no pack on the shelf that can finish it, which
 * reads as a bug. The denominator is exactly what the pack can hand you.
 *
 * 彩卡 are the exception, and are counted separately below. Measured: a region
 * has two to seven legends, they arrive about once in three hundred draws, and
 * the last one of five takes some three thousand — so a 100% mark that needed
 * them would be a milestone almost nobody could reach, advertising a十连包 that
 * is never paid. The bar is the 选手卡; the legends are the trophy on top.
 */
const SERIES_CARDS = Object.fromEntries(SERIES.map((r) => {
  const pool = POOLS[r]
  return [r, new Set([...pool.gold, ...pool.silver, ...pool.bronze].map((c) => c.id))]
})) as Record<Series, Set<string>>

const SERIES_LEGENDS = Object.fromEntries(SERIES.map((r) =>
  [r, new Set(POOLS[r].mythic.map((c) => c.id))],
)) as Record<Series, Set<string>>

const SERIES_PACK: Record<Series, PackKind> = {
  China: 'cn', Pacific: 'pac', Americas: 'ame', EMEA: 'emea',
}

/**
 * The week's featured region, and what it costs while it is featured.
 *
 * The 限定 half of 「分赛区限定包」. Nothing is ever taken away — all four packs
 * are on the shelf all the time — but one of them is cheaper for seven days,
 * which is a reason to come back on a Monday rather than a reason to hurry.
 * Derived from the date, so it is the same for everybody and needs no state,
 * and cycles through all four before repeating.
 */
export const FEATURE_OFF = 0.2

export function featuredSeries(today: string): Series {
  // whole days since a fixed Monday, floored to weeks; the epoch is a Monday
  // so the discount turns over at the same moment the week does
  const days = Math.floor(Date.parse(`${today}T00:00:00Z`) / 86_400_000)
  const week = Math.floor((days - 4) / 7) // 1970-01-01 was a Thursday
  return SERIES[((week % SERIES.length) + SERIES.length) % SERIES.length]
}

/** What a pack costs today — the featured series is off by a fifth. */
export function packCost(kind: PackKind, today?: string): number {
  const base = PACKS[kind].cost
  if (!today) return base
  const region = seriesOfPack(kind)
  if (!region || region !== featuredSeries(today)) return base
  return Math.round(base * (1 - FEATURE_OFF))
}

/** How many cards of a series a milestone asks for. */
const milestoneAt = (reward: SeriesReward, total: number) => Math.ceil(reward.at * total)

export function seriesProgress(g: GachaState): SeriesProgress[] {
  const mine = Object.keys(g.cards)
  return SERIES.map((region) => {
    const total = SERIES_CARDS[region].size
    const owned = mine.filter((id) => SERIES_CARDS[region].has(id)).length
    const claimed = g.series?.[region] ?? 0
    const ready = SERIES_REWARDS.filter((r, i) => i >= claimed && owned >= milestoneAt(r, total))
    const nextIdx = SERIES_REWARDS.findIndex((r) => owned < milestoneAt(r, total))
    const next = nextIdx < 0 ? null : {
      ...SERIES_REWARDS[nextIdx],
      need: milestoneAt(SERIES_REWARDS[nextIdx], total) - owned,
    }
    return {
      region, owned, total, pack: SERIES_PACK[region], ready, next,
      legends: mine.filter((id) => SERIES_LEGENDS[region].has(id)).length,
      legendsTotal: SERIES_LEGENDS[region].size,
    }
  })
}

/**
 * Collect everything a series owes.
 *
 * Pays every unclaimed milestone at once rather than one per press: a player
 * who comes back after a long absence has no interest in pressing a button
 * four times to be told four things.
 */
export function claimSeries(g: GachaState, region: Series): string | null {
  const prog = seriesProgress(g).find((p) => p.region === region)
  if (!prog || !prog.ready.length) return null
  let coins = 0
  const packs: string[] = []
  for (const r of prog.ready) {
    coins += r.coins
    if (r.pack) {
      const kind = r.pack === 'self' ? prog.pack : r.pack
      const n = r.count ?? 1
      g.packs[kind] = (g.packs[kind] ?? 0) + n
      packs.push(`${PACKS[kind].name} ×${n}`)
    }
  }
  g.coins += coins
  g.series = { ...(g.series ?? {}) }
  g.series[region] = (g.series[region] ?? 0) + prog.ready.length
  const parts = [packs.join('、'), coins ? `+${coins} 金币` : '']
    .filter(Boolean)
  note(g, `${REGION_CN[region]}系列进度奖励：${parts.join('，')}`)
  return parts.join('，')
}

// ---------------------------------------------------------------- ladder

/**
 * Who the ladder puts in front of you.
 *
 * The 78 real clubs, sorted by strength and sliced by division, so climbing
 * actually means meeting better opponents — bronze is Challengers clubs and
 * 大师 is the teams that win Masters.
 */
export function ladderPool(div: number): string[] {
  const sorted = WORLD_TEAMS.slice().sort((a, b) => a.rating - b.rating)
  const span = sorted.length / DIVISIONS.length
  const lo = Math.floor(div * span)
  const hi = Math.min(sorted.length, Math.ceil((div + 1) * span) + 4)
  return sorted.slice(lo, hi).map((t) => t.id)
}

export function ladderOpponent(g: GachaState): string {
  const pool = ladderPool(g.ladder.div)
  return new Rng((g.seed ^ hashStr(`lad${g.ladder.wins}${g.ladder.losses}`)) >>> 0).pick(pool)
}

export interface LadderOutcome {
  win: boolean
  starsBefore: number
  divBefore: number
  promoted: boolean
  demoted: boolean
  coins: number
  pack?: PackKind
  /** 大师 only: how the score moved, and what it is called now */
  points?: number
  pointsDelta?: number
  title?: string
}

/**
 * What a 大师 result is worth in points.
 *
 * Above 大师 there are no more stars to collect, so the ladder switches to a
 * score with no ceiling — the complaint was that the climb simply ended, and
 * 「大师」 with a number after it is a climb that cannot. Beating a stronger
 * club pays more, a run pays a little more, and a loss costs a flat amount so
 * that a bad night is a setback rather than a wipe.
 *
 * Positive at anything above a 43% win rate, which is deliberate: at this
 * level the ladder is a leaderboard, and a leaderboard people fall off is a
 * leaderboard nobody plays.
 */
export const MASTER_WIN = 20
export const MASTER_LOSS = 15
export function masterPoints(win: boolean, oppRating: number, streak: number): number {
  if (!win) return -MASTER_LOSS
  return MASTER_WIN + Math.max(0, Math.round(oppRating) - 84) * 3 + (streak >= 3 ? 8 : 0)
}

/**
 * How much stronger the opposition gets past 大师.
 *
 * The 78 real clubs top out at 89, so a points ladder with no ceiling would
 * run out of opponents about a week in. Until the arena can put another
 * player's saved five in front of you, the top clubs are simply sharpened:
 * +1 to every attribute per 250 points, capped, which keeps a 辐能 run
 * genuinely hard without inventing a club that does not exist.
 */
export const oppBumpFor = (points: number): number =>
  clamp(Math.floor(Math.max(0, points) / 250), 0, 10)

/**
 * Apply a ladder result.
 *
 * A star a win, two on a hot streak, one back on a loss. The bottom three
 * divisions have a floor — losing your way out of 青铜 teaches nothing — and
 * above that you can genuinely fall.
 */
export function recordLadder(g: GachaState, win: boolean, oppRating = 80): LadderOutcome {
  const L = g.ladder
  // 大师 is where the stars run out and the score takes over
  const master = L.div >= MASTER_DIV
  const pointsBefore = L.points ?? 0
  const out: LadderOutcome = {
    win, starsBefore: L.stars, divBefore: L.div, promoted: false, demoted: false, coins: 0,
  }
  if (win) {
    L.wins++
    L.streak = Math.max(1, L.streak + 1)
    // Lowered with the daily budget. The shop's two-a-day cap was binding on
    // 55 days out of 60, which means coins were never a decision — you always
    // had enough for both. Now a day's play buys two 试训包 or most of a
    // 选拔包, and which one is the question.
    out.coins = 110 + L.div * 45
    if (master) {
      L.points = Math.max(0, pointsBefore + masterPoints(true, oppRating, L.streak))
    } else {
      // a streak is worth an extra star, but only while there is still a
      // ladder above you to climb
      L.stars += L.streak >= 3 && L.div < MASTER_DIV - 1 ? 2 : 1
      while (L.stars >= starsFor(L.div) && L.div < MASTER_DIV) {
        L.stars -= starsFor(L.div)
        L.div++
        out.promoted = true
        // arriving in 大师 is where stars stop and the score starts
        if (L.div === MASTER_DIV) { L.stars = 0; L.points ??= 0 }
      }
    }
    if (L.div > L.best) {
      L.best = L.div
      // a promotion is the moment to hand over something worth opening
      out.pack = L.div >= 4 ? 'ten' : L.div >= 2 ? 'elite' : 'scout'
      g.packs[out.pack] = (g.packs[out.pack] ?? 0) + 1
    }
    bumpQuest(g, 'win2', 1)
  } else {
    L.losses++
    L.streak = Math.min(0, L.streak - 1)
    out.coins = 30
    if (master) {
      // A 大师 never falls out of it. Points can go all the way back to zero,
      // which is punishment enough for a bad run — dropping somebody back to
      // 钻石 after the climb they made to get here is how a ladder loses the
      // people who play it most.
      L.points = Math.max(0, pointsBefore + masterPoints(false, oppRating, 0))
    } else {
      L.stars -= 1
      if (L.stars < 0) {
        if (L.div >= 3) {
          L.div--
          L.stars = Math.max(0, starsFor(L.div) - 2)
          out.demoted = true
        } else {
          L.stars = 0
        }
      }
    }
  }

  if (L.div >= MASTER_DIV) {
    out.points = L.points ?? 0
    out.pointsDelta = (L.points ?? 0) - pointsBefore
    out.title = masterTitle(L.points ?? 0)
    // A new title is the 大师 ladder's version of a promotion, and gets the
    // same thing a promotion gets — once, the first time it is reached.
    const wasTitle = masterTitle(L.bestPoints ?? 0)
    L.bestPoints = Math.max(L.bestPoints ?? 0, L.points ?? 0)
    if (out.title !== wasTitle && (L.points ?? 0) > (pointsBefore)) {
      out.pack = 'ten'
      g.packs.ten = (g.packs.ten ?? 0) + 1
      out.promoted = true
    }
  }

  g.coins += out.coins
  bumpQuest(g, 'play3', 1)
  note(g, `天梯 ${rankName(out.divBefore, out.starsBefore, pointsBefore)}：`
    + `${win ? '胜' : '负'}，${win ? '+' : ''}${out.coins} 金币`
    + (out.pointsDelta != null
      ? `，${out.pointsDelta >= 0 ? '+' : ''}${out.pointsDelta} 分（${out.title} ${out.points}）`
      : out.promoted ? ` — 升到${rankName(L.div, L.stars, L.points ?? 0)}`
        : out.demoted ? ` — 掉到${rankName(L.div, L.stars, 0)}` : ''))
  return out
}

// ---------------------------------------------------------------- cup

/**
 * What a cup run is worth.
 *
 * The first pass paid 9000 for a title and charged 600 to enter, which a
 * finished collection converted into 550,000 coins across a hundred runs.
 * Cutting that left it still paying 231 coins per point of 体力 against the
 * ladder's 94 — two and a half times the rate, which makes the ladder
 * pointless for anyone counting. Halved again, so a cup leg is worth a little
 * more than a ladder match and no more; the reason to enter is the trophy and
 * the pack it comes with.
 */
export const CUP_ENTRY = 800
export const CUP_PRIZE = [150, 400, 900] // out in QF / SF / lost the final
export const CUP_WIN = 1800

/**
 * Draw a cup: three clubs, each harder than the last.
 *
 * Seeded off the account and the number of cups already played, so refreshing
 * the page cannot re-draw an easier bracket.
 */
export function enterCup(g: GachaState, squadRating: number): CupState {
  if (g.cup && !g.cup.done) return g.cup
  if (g.coins < CUP_ENTRY) throw new Error('金币不够')
  g.coins -= CUP_ENTRY
  const { rng, done } = roll(g)
  const sorted = WORLD_TEAMS.slice().sort((a, b) => a.rating - b.rating)
  const path: string[] = []
  for (let round = 0; round < 3; round++) {
    // Each round is a step up from where YOU are, not a step up the world
    // rankings. Pinned to the absolute table instead, the final was the best
    // club on earth whoever entered, so a new account went 0 for 100 and the
    // cup was a tax on not having a finished collection.
    const target = squadRating - 8 + round * 4
    const band = sorted.filter((t) => Math.abs(t.rating - target) <= 5)
    const pick = rng.pick(band.length ? band : sorted)
    path.push(pick.id)
  }
  g.cup = { path, round: 0, legs: [], done: false, won: false, entry: CUP_ENTRY }
  done()
  note(g, '报名了一场杯赛')
  return g.cup
}

export interface CupOutcome {
  coins: number
  pack?: PackKind
  done: boolean
  won: boolean
}

export function recordCup(g: GachaState, leg: CupLeg): CupOutcome {
  const cup = g.cup
  if (!cup || cup.done) return { coins: 0, done: true, won: false }
  cup.legs.push(leg)
  bumpQuest(g, 'cup1', 1)
  if (!leg.win) {
    cup.done = true
    const coins = CUP_PRIZE[cup.round] ?? 0
    g.coins += coins
    note(g, `杯赛止步${['八强', '四强', '决赛'][cup.round] ?? ''}，奖金 ${coins}`)
    return { coins, done: true, won: false }
  }
  cup.round++
  if (cup.round >= cup.path.length) {
    cup.done = true
    cup.won = true
    g.coins += CUP_WIN
    g.packs.elite = (g.packs.elite ?? 0) + 1
    note(g, `杯赛冠军！奖金 ${CUP_WIN} + 一个选拔包`)
    return { coins: CUP_WIN, pack: 'elite', done: true, won: true }
  }
  return { coins: 0, done: false, won: false }
}

export const cupOpponent = (g: GachaState): string | null =>
  g.cup && !g.cup.done ? g.cup.path[g.cup.round] ?? null : null

// ---------------------------------------------------------------- daily

const QUEST_KEYS = Object.keys(QUESTS) as QuestKey[]

/** Three quests a day, drawn from the day itself so everyone gets the same set. */
export function questsFor(day: string, id: string): QuestKey[] {
  const rng = new Rng(hashStr(day + id) >>> 0)
  return rng.shuffle(QUEST_KEYS.slice()).slice(0, 3)
}

/**
 * Roll the day over: new quests, full 体力, shop counter back to zero.
 *
 * `today` is the server's date, never the device's — the whole point of the
 * account is that this line cannot be moved by changing a clock.
 */
export function refreshDaily(g: GachaState, today: string): void {
  if (g.daily.questDay === today) return
  g.daily.questDay = today
  g.daily.picked = questsFor(today, g.id)
  g.daily.progress = {}
  g.daily.taken = []
  // 体力 is NOT touched here — it accrues by the clock, so the day rolling
  // over is about the quest board and nothing else
}

/**
 * When the meter was last counted from.
 *
 * A save with no anchor — one written before 体力 accrued on a clock — used to
 * be read as `staminaAt || now`, which is a trap: zero is falsy, so the anchor
 * was "now" on every single read and not one second ever accumulated. An
 * account that hit zero stayed at zero permanently. There is no honest way to
 * date an unanchored save, so it is anchored the first time anybody asks, and
 * `primeStamina` writes that back.
 */
const anchorOf = (g: GachaState, now: number): number => g.daily.staminaAt || now

/**
 * Give an unanchored save a starting point, once.
 *
 * Called when the mode opens. Separate from the readers because reading should
 * not mutate, and because this is the one place that can also persist it.
 */
export function primeStamina(g: GachaState, now: number): boolean {
  if (g.daily.staminaAt) return false
  g.daily.staminaAt = now
  return true
}

/**
 * 体力 right now: what was banked, plus whatever the clock has added since.
 *
 * `now` is the server's clock carried over by engine/account.ts, never the
 * device's — for the same reason the check-in date is the server's.
 */
export function staminaNow(g: GachaState, now: number): number {
  const at = anchorOf(g, now)
  const banked = Math.max(0, Math.min(STAMINA_MAX, g.daily.stamina ?? STAMINA_MAX))
  const gained = Math.floor(Math.max(0, now - at) / STAMINA_REGEN_MS)
  return Math.min(STAMINA_MAX, banked + gained)
}

/** ms until the next point lands, or 0 when the meter is already full. */
export function staminaIn(g: GachaState, now: number): number {
  if (staminaNow(g, now) >= STAMINA_MAX) return 0
  const at = anchorOf(g, now)
  const since = Math.max(0, now - at)
  return STAMINA_REGEN_MS - (since % STAMINA_REGEN_MS)
}

/**
 * Fold the accrued points into the bank.
 *
 * The clock is advanced to the last whole tick rather than to `now`, so the
 * part-hour already served is not thrown away every time anything reads the
 * meter — otherwise a player who checks the screen often would never regen.
 */
function settle(g: GachaState, now: number): void {
  const at = anchorOf(g, now)
  const ticks = Math.floor(Math.max(0, now - at) / STAMINA_REGEN_MS)
  const banked = Math.max(0, Math.min(STAMINA_MAX, g.daily.stamina ?? STAMINA_MAX))
  const next = Math.min(STAMINA_MAX, banked + ticks)
  g.daily.stamina = next
  g.daily.staminaAt = next >= STAMINA_MAX ? now : at + ticks * STAMINA_REGEN_MS
}

export const canPlay = (g: GachaState, kind: PlayKind, now: number): boolean =>
  staminaNow(g, now) >= STAMINA_COST[kind]

/** Pay for a match. Returns false — and spends nothing — when there is not enough. */
export function spendPlay(g: GachaState, kind: PlayKind, now: number): boolean {
  settle(g, now)
  if (g.daily.stamina < STAMINA_COST[kind]) return false
  // the meter was full, so the clock starts from this moment
  if (g.daily.stamina >= STAMINA_MAX) g.daily.staminaAt = now
  g.daily.stamina -= STAMINA_COST[kind]
  return true
}



function bumpQuest(g: GachaState, key: QuestKey, by: number): void {
  if (!g.daily.picked.includes(key)) return
  g.daily.progress[key] = (g.daily.progress[key] ?? 0) + by
}

export function claimQuest(g: GachaState, key: QuestKey): number {
  const q = QUESTS[key]
  if (!g.daily.picked.includes(key) || g.daily.taken.includes(key)) return 0
  if ((g.daily.progress[key] ?? 0) < q.target) return 0
  g.daily.taken.push(key)
  g.coins += q.reward
  // clearing the board is worth a pack on its own
  if (g.daily.taken.length === g.daily.picked.length) {
    g.packs.scout = (g.packs.scout ?? 0) + 1
    note(g, '日常全部完成，+1 试训包')
  }
  return q.reward
}

export interface CheckIn {
  coins: number
  packs: Partial<Record<PackKind, number>>
  streak: number
  /** already claimed today */
  already: boolean
}

/**
 * The daily check-in.
 *
 * `today` comes from the server, never from the device clock — otherwise
 * changing the date in system settings is an unlimited supply of packs. The
 * offline fallback in engine/account.ts is explicit about being unverified.
 */
export function checkIn(g: GachaState, today: string): CheckIn {
  if (g.daily.claimed === today) {
    return { coins: 0, packs: {}, streak: g.daily.streak, already: true }
  }
  const yesterday = new Date(`${today}T00:00:00Z`)
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)
  const consecutive = g.daily.claimed === yesterday.toISOString().slice(0, 10)
  g.daily.streak = consecutive ? g.daily.streak + 1 : 1
  g.daily.claimed = today

  const coins = 300
  const packs: Partial<Record<PackKind, number>> = { scout: 1 }
  // the seventh day in a row is the one worth coming back for
  if (g.daily.streak % 7 === 0) packs.ten = 1
  else if (g.daily.streak % 3 === 0) packs.elite = 1

  g.coins += coins
  for (const [k, n] of Object.entries(packs)) {
    g.packs[k as PackKind] = (g.packs[k as PackKind] ?? 0) + (n ?? 0)
  }
  refreshDaily(g, today)
  note(g, `签到第 ${g.daily.streak} 天：+${coins} 金币${packs.ten ? ' + 十连包' : packs.elite ? ' + 选拔包' : ' + 试训包'}`)
  return { coins, packs, streak: g.daily.streak, already: false }
}

// ---------------------------------------------------------------- squad

/**
 * Put a card in a slot.
 *
 * Two rules. The same CARD moving in from another slot swaps with whatever was
 * there. The same PERSON already on the squad under a different card — the
 * ordinary Derke and the 2023 FNATIC Derke — is removed instead of swapped:
 * you cannot field a man twice, and silently letting it happen would be the
 * strongest squad in the game.
 */
export function setSlot(g: GachaState, index: number, cardId: string | null): void {
  if (index < 0 || index >= g.squad.slots.length) return
  if (cardId) {
    const at = g.squad.slots.indexOf(cardId)
    if (at >= 0) {
      g.squad.slots[at] = g.squad.slots[index]
    } else {
      const who = cardById(cardId)
      if (who) {
        g.squad.slots.forEach((other, i) => {
          if (i === index || !other) return
          const c = cardById(other)
          if (c && personOf(c) === personOf(who)) g.squad.slots[i] = null
        })
      }
    }
  }
  g.squad.slots[index] = cardId
}

/** True when this card's person is already on the squad in another slot. */
export function personTaken(g: GachaState, cardId: string, exceptSlot = -1): boolean {
  const who = cardById(cardId)
  if (!who) return false
  return g.squad.slots.some((other, i) => {
    if (i === exceptSlot || !other || other === cardId) return false
    const c = cardById(other)
    return !!c && personOf(c) === personOf(who)
  })
}

/**
 * Best available five, for the 自动组队 button.
 *
 * Greedy by rating first, then hill-climbing on the squad number itself —
 * which includes chemistry, so the pass will happily drop a 90 for an 86 who
 * shares a club with three of the others. That is the same trade the mode asks
 * the player to make by hand, so the button should not be making the naive one.
 */
export function autoSquad(g: GachaState): Squad {
  const level = (id: string) => g.cards[id]?.level ?? 0
  const mine = collection(g).filter((c) => isPlayerCard(c.card))
  const squad = emptySquad()
  // keyed on the person, not the card: the legend and the ordinary card are
  // the same man and only one of them can be on the server
  const used = new Set<string>()
  SQUAD_SLOTS.forEach((role, i) => {
    const free = (c: { card: Card }) => !used.has(personOf(c.card))
    const fit = mine.find((c) => free(c) && isPlayerCard(c.card) && c.card.roles.includes(role))
    const pick = fit ?? mine.find(free)
    if (pick) {
      used.add(personOf(pick.card))
      squad.slots[i] = pick.card.id
    }
  })

  // only the plausible spares are worth trying: a bronze 55 will never improve
  // a five that already has a gold in every seat
  const bench = mine.slice(0, 60).map((c) => c.card.id)
  let best = squadRating(squad, level)
  for (let pass = 0; pass < 3; pass++) {
    let moved = false
    for (let i = 0; i < squad.slots.length; i++) {
      // `cur` has to track the slot's CURRENT occupant, not the one it started
      // the pass with: restoring the original after every rejected candidate
      // threw away improvements the same pass had just accepted, which is why
      // the button once seated a 62 next to four golds.
      let cur = squad.slots[i]
      for (const id of bench) {
        if (id === cur || squad.slots.includes(id)) continue
        if (personTaken(g, id, i)) continue
        squad.slots[i] = id
        const score = squadRating(squad, level)
        if (score > best) { best = score; cur = id; moved = true } else squad.slots[i] = cur
      }
    }
    if (!moved) break
  }

  // the coach that fits this five, not simply the highest rated one
  const coaches = collection(g).filter((c) => c.card.kind === 'coach')
  let bestCoach: string | null = null
  let bestWith = best
  for (const c of coaches) {
    squad.coach = c.card.id
    const score = squadRating(squad, level)
    if (bestCoach === null || score > bestWith) { bestCoach = c.card.id; bestWith = score }
  }
  squad.coach = bestCoach
  return squad
}

export const clampState = (g: GachaState): GachaState => {
  g.coins = Math.max(0, Math.round(g.coins))
  g.ladder.div = clamp(Math.round(g.ladder.div), 0, DIVISIONS.length - 1)
  g.ladder.stars = clamp(Math.round(g.ladder.stars), 0, starsFor(g.ladder.div))
  // no ceiling on purpose — this is the part of the ladder that never ends
  g.ladder.points = Math.max(0, Math.round(g.ladder.points ?? 0))
  g.ladder.bestPoints = Math.max(g.ladder.bestPoints ?? 0, g.ladder.points)
  return g
}
