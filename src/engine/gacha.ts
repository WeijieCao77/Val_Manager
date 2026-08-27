/**
 * The card mode: pull real professionals, build a five, and take it out.
 *
 * Kept entirely separate from the career save. A career is a club you manage
 * over seasons; this is a collection you own across sessions, tied to an
 * account id rather than to one browser — see engine/account.ts. The two never
 * share state, and nothing here writes into a career.
 */
import { Rng, clamp, hashStr } from './rng'
import { WORLD_TEAMS } from './world'
import {
  ALL_CARDS, COACH_CARDS, COINS_FOR, DUPES_FOR, MAX_LEVEL, PLAYER_CARDS, SALVAGE,
  SQUAD_SLOTS, cardById, emptySquad, isPlayerCard, ratingAt, squadRating,
} from './cards'
import type { Card, Rarity, Squad } from './cards'

export const GACHA_VERSION = 1

// ---------------------------------------------------------------- packs

export type PackKind = 'scout' | 'elite' | 'ten' | 'coach'

export interface PackDef {
  kind: PackKind
  name: string
  blurb: string
  cost: number
  draws: number
  /** chance of a gold on each individual draw */
  gold: number
  silver: number
  /** the pack promises at least one card of this metal */
  floor?: Rarity
  /** coach packs deal from a different deck */
  pool: 'player' | 'coach'
}

export const PACKS: Record<PackKind, PackDef> = {
  scout: {
    kind: 'scout', name: '试训包', pool: 'player',
    blurb: '一张选手卡。大部分是铜卡，但金卡就是从这里出的。',
    cost: 500, draws: 1, gold: 0.04, silver: 0.26,
  },
  elite: {
    kind: 'elite', name: '选拔包', pool: 'player',
    blurb: '三张选手卡，至少一张银卡起。',
    cost: 1800, draws: 3, gold: 0.10, silver: 0.38, floor: 'silver',
  },
  ten: {
    kind: 'ten', name: '十连包', pool: 'player',
    blurb: '十张选手卡，必出金卡。',
    cost: 5000, draws: 10, gold: 0.08, silver: 0.34, floor: 'gold',
  },
  coach: {
    kind: 'coach', name: '教练包', pool: 'coach',
    blurb: '一名真实教练。带过你阵容里的人，默契还会更高。',
    cost: 900, draws: 1, gold: 0.15, silver: 0.42,
  },
}

export const PACK_ORDER: PackKind[] = ['scout', 'elite', 'ten', 'coach']

/**
 * How long a dry run is allowed to get.
 *
 * Pure 4% means one player in fifty opens twenty-five packs without a gold and
 * concludes the game is broken — which, from where they are sitting, it is.
 * Odds climb from the 25th pull and the 45th is a certainty.
 */
export const SOFT_PITY = 25
export const HARD_PITY = 45

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
 * How many stars each division is worth.
 *
 * Flat at five, a 56%-win account reached 大师 in about two months of daily
 * play and then had nowhere to go. The bottom rungs stay quick — nobody should
 * be stuck in 青铜 learning the game — and the top two are where the climb
 * actually is.
 */
export const STARS_PER_DIV = [3, 4, 5, 6, 8, 8] as const
export const starsFor = (div: number): number =>
  STARS_PER_DIV[clamp(div, 0, STARS_PER_DIV.length - 1)]

export interface LadderState {
  div: number
  stars: number
  best: number
  wins: number
  losses: number
  streak: number
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
  pulls: number
  ladder: LadderState
  cup: CupState | null
  daily: DailyState
  log: LogEntry[]
  /** rolling seed, so a reload cannot reroll the same pack */
  seed: number
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
    pulls: 0,
    ladder: { div: 0, stars: 0, best: 0, wins: 0, losses: 0, streak: 0 },
    cup: null,
    daily: { claimed: null, streak: 0, questDay: null, picked: [], progress: {}, taken: [] },
    log: [],
    seed: hashStr(id + today) >>> 0,
  }
}

/** Advance and return the account's own rng, so nothing is re-rollable. */
function roll(g: GachaState): Rng {
  const rng = new Rng(g.seed)
  // burn one draw into the stored seed before the caller uses it
  rng.next()
  g.seed = rng.state
  return rng
}

const note = (g: GachaState, text: string) => {
  g.log.unshift({ at: new Date().toISOString(), text })
  if (g.log.length > 60) g.log.length = 60
}

export const levelOf = (g: GachaState, cardId: string): number => g.cards[cardId]?.level ?? 0
export const owns = (g: GachaState, cardId: string): boolean => !!g.cards[cardId]

// ---------------------------------------------------------------- pulling

const POOLS = {
  player: {
    gold: PLAYER_CARDS.filter((c) => c.rarity === 'gold'),
    silver: PLAYER_CARDS.filter((c) => c.rarity === 'silver'),
    bronze: PLAYER_CARDS.filter((c) => c.rarity === 'bronze'),
  },
  coach: {
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
export function openPack(g: GachaState, kind: PackKind, payWith: 'pack' | 'coins'): Pulled[] {
  const def = PACKS[kind]
  if (payWith === 'pack') {
    if ((g.packs[kind] ?? 0) < 1) throw new Error('没有这种卡包')
    g.packs[kind] = (g.packs[kind] ?? 0) - 1
  } else {
    if (g.coins < def.cost) throw new Error('金币不够')
    g.coins -= def.cost
  }

  const rng = roll(g)
  const pool = POOLS[def.pool]
  const metals: Rarity[] = []
  for (let i = 0; i < def.draws; i++) {
    const gc = goldChance(def.gold, g.pity)
    const r = rng.next()
    let metal: Rarity
    if (r < gc) metal = 'gold'
    else if (r < gc + def.silver) metal = 'silver'
    else metal = 'bronze'
    if (metal === 'gold') g.pity = 0
    else g.pity++
    metals.push(metal)
  }
  // honour the pack's promise on the last card, which is the one being watched
  if (def.floor) {
    const rank = { bronze: 0, silver: 1, gold: 2 }
    const bestAt = metals.reduce((b, m, i) => (rank[m] > rank[metals[b]] ? i : b), 0)
    if (rank[metals[bestAt]] < rank[def.floor]) {
      metals[bestAt] = def.floor
      if (def.floor === 'gold') g.pity = 0
    }
  }
  metals.sort((a, b) => ({ bronze: 0, silver: 1, gold: 2 })[a] - ({ bronze: 0, silver: 1, gold: 2 })[b])

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

  const golds = out.filter((p) => p.card.rarity === 'gold')
  note(g, golds.length
    ? `${def.name}：抽到 ${golds.map((p) => (p.card.kind === 'player' ? p.card.ign : p.card.name)).join('、')}（金卡）`
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
}

/**
 * Apply a ladder result.
 *
 * A star a win, two on a hot streak, one back on a loss. The bottom three
 * divisions have a floor — losing your way out of 青铜 teaches nothing — and
 * above that you can genuinely fall.
 */
export function recordLadder(g: GachaState, win: boolean): LadderOutcome {
  const L = g.ladder
  const out: LadderOutcome = {
    win, starsBefore: L.stars, divBefore: L.div, promoted: false, demoted: false, coins: 0,
  }
  if (win) {
    L.wins++
    L.streak = Math.max(1, L.streak + 1)
    // a streak is worth an extra star, but only while there is still a ladder
    // above you to climb
    L.stars += L.streak >= 3 && L.div < 4 ? 2 : 1
    out.coins = 140 + L.div * 70
    while (L.stars >= starsFor(L.div) && L.div < DIVISIONS.length - 1) {
      L.stars -= starsFor(L.div)
      L.div++
      out.promoted = true
    }
    if (L.div === DIVISIONS.length - 1) L.stars = Math.min(L.stars, starsFor(L.div))
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
    L.stars -= 1
    out.coins = 40
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
  g.coins += out.coins
  bumpQuest(g, 'play3', 1)
  note(g, `天梯 ${DIVISIONS[out.divBefore]}：${win ? '胜' : '负'}，${win ? '+' : ''}${out.coins} 金币`
    + (out.promoted ? ` — 升到${DIVISIONS[L.div]}` : out.demoted ? ` — 掉到${DIVISIONS[L.div]}` : ''))
  return out
}

// ---------------------------------------------------------------- cup

/**
 * What a cup run is worth.
 *
 * The first pass paid 9000 for a title and charged 600 to enter, which a
 * finished collection converted into 550,000 coins across a hundred runs —
 * every other part of the mode became irrelevant. The numbers below are set so
 * that a strong squad earns roughly what the same three matches would have
 * earned on the ladder, and the reason to play a cup is the trophy and the
 * pack, not the coins.
 */
export const CUP_ENTRY = 1000
export const CUP_PRIZE = [350, 850, 1900] // out in QF / SF / lost the final
export const CUP_WIN = 3600

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
  const rng = roll(g)
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

export function refreshDaily(g: GachaState, today: string): void {
  if (g.daily.questDay === today) return
  g.daily.questDay = today
  g.daily.picked = questsFor(today, g.id)
  g.daily.progress = {}
  g.daily.taken = []
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

/** Put a card in a slot, taking it out of whatever slot it was already in. */
export function setSlot(g: GachaState, index: number, cardId: string | null): void {
  if (index < 0 || index >= g.squad.slots.length) return
  if (cardId) {
    const at = g.squad.slots.indexOf(cardId)
    if (at >= 0) g.squad.slots[at] = g.squad.slots[index]
  }
  g.squad.slots[index] = cardId
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
  const used = new Set<string>()
  SQUAD_SLOTS.forEach((role, i) => {
    const fit = mine.find((c) => !used.has(c.card.id)
      && isPlayerCard(c.card) && c.card.roles.includes(role))
    const pick = fit ?? mine.find((c) => !used.has(c.card.id))
    if (pick) {
      used.add(pick.card.id)
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
  return g
}
