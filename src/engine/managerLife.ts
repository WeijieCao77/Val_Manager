/**
 * The manager as a person: an age that moves, a wallet of his own, and two
 * numbers about how he is doing.
 *
 * Until now the manager's pay was a counter (`tally.earned`) banked once a
 * season for an achievement and spendable nowhere, and his age was frozen
 * at whatever the new-game screen said. Now:
 *
 *   - age = the age he started with + the seasons since (managerAge); no
 *     birthday is invented for him, and an old save starts counting from
 *     the season it was migrated in rather than back-dating years
 *   - salary is paid MONTHLY into `state.life.wallet`, by the calendar
 *     month of the game date, each month once (paidMonth); the same money
 *     goes on `tally.earned`, which is no longer banked at season's end —
 *     one path, no double count; a manager who is sacked stops being paid
 *   - 饱腹 and 心情 are 0–100, 100 = full / happy, moved once per game
 *     day (tickedOn) and never by the wall clock
 *   - meals, rest and fun are bought here; a refusal costs nothing
 *   - the effect is deliberately small: LIFE_MOD scales the manager's own
 *     work (training gains at his club, the odds of a dressing-room talk)
 *     within ±8%; nobody's aim goes up because the manager had dinner, and
 *     nothing is locked behind being at 100
 *
 * Everything is a career day (clock.ts), so nothing here needs rebasing at
 * the winter rollover.
 */
import type { GameState } from './types'
import { clamp } from './rng'
import { careerDayOf } from './clock'

export interface LifeLedger { cd: number; label: string; amount: number }

export interface ManagerLife {
  /** the season he was created — or, for an old save, migrated — in; age counts from here */
  startYear: number
  wallet: number
  ledger: LifeLedger[]
  /** `${year}-${month}` of the last salary paid */
  paidMonth: string | null
  /** 0 hungry … 100 full */
  hunger: number
  /** 0 miserable … 100 happy */
  mood: number
  /** the career day the daily decay last ran */
  tickedOn: number
  /** buy a meal on his behalf whenever 饱腹 drops under the line, within a monthly budget */
  auto: { meal: 'cheap' | 'good' | null; budget: number; spentMonth: string | null; spent: number }
  /** activity key → career day it can be used again */
  cooldowns: Record<string, number>
  /** career earnings carried into the wallet by the one-shot migration, for the record */
  migratedFrom?: number
}

export const LIFE = {
  HUNGER_PER_DAY: 4,
  /** the daily drift of 心情 — only down to MOOD_FLOOR; a fed manager who never opens the page settles there, he does not bottom out */
  MOOD_PER_DAY: 1,
  MOOD_FLOOR: 40,
  /** extra mood lost per day while hungry */
  HUNGRY_AT: 30,
  HUNGRY_MOOD: 2,
  /** the auto supply buys when 饱腹 falls under this */
  AUTO_AT: 55,
  /** how far the two numbers move the manager's own work: (x − 60) / 100 × k, clamped to ±0.08 together */
  MOD_HUNGER: 0.06,
  MOD_MOOD: 0.08,
  MOD_MAX: 0.08,
  START: { hunger: 85, mood: 70 },
} as const

export type LifeAct = 'cheapMeal' | 'goodMeal' | 'rest' | 'fun'

export const LIFE_ACTS: Record<LifeAct, { label: string; price: number; hunger: number; mood: number; cooldownDays: number; blurb: string }> = {
  cheapMeal: { label: '便饭', price: 30, hunger: 35, mood: 1, cooldownDays: 0, blurb: '楼下随便吃一口' },
  goodMeal: { label: '好好吃一顿', price: 120, hunger: 60, mood: 6, cooldownDays: 1, blurb: '一顿像样的饭，每天一次' },
  rest: { label: '休息一下', price: 0, hunger: 0, mood: 8, cooldownDays: 1, blurb: '免费，每天一次' },
  fun: { label: '娱乐活动', price: 300, hunger: 0, mood: 20, cooldownDays: 3, blurb: '看场比赛、打局游戏，三天一次' },
}

export const newLife = (state: { year: number; day: number }): ManagerLife => ({
  startYear: state.year, wallet: 0, ledger: [], paidMonth: null,
  hunger: LIFE.START.hunger, mood: LIFE.START.mood, tickedOn: careerDayOf(state),
  auto: { meal: null, budget: 600, spentMonth: null, spent: 0 }, cooldowns: {},
})

/** the calendar month of the game date, as `${year}-${month}` */
export function monthKey(state: { year: number; day: number }): string {
  const d = new Date(Date.UTC(state.year, 0, 1))
  d.setUTCDate(d.getUTCDate() + state.day)
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`
}

/** how old the manager is this season */
export const managerAge = (state: GameState): number =>
  (state.manager?.age ?? 0) + Math.max(0, state.year - (state.life?.startYear ?? state.year))

/** the salary a month brings, from the contract as it stands */
export const monthlyPay = (state: GameState): number => Math.round((state.managerContract?.salary ?? 0) / 12)

function book(life: ManagerLife, cd: number, label: string, amount: number): void {
  life.wallet = Math.round(life.wallet + amount)
  life.ledger.push({ cd, label, amount: Math.round(amount) })
  if (life.ledger.length > 60) life.ledger.splice(0, life.ledger.length - 60)
}

/**
 * One-shot: an existing career gets a wallet. What was already banked as
 * earned pay (the seasons that ended before this existed) is real income
 * and moves into the wallet; the season in progress is not back-paid — the
 * first monthly pay is next month's.
 */
export function migrateLife(state: GameState): void {
  if (state.life) return
  const life = newLife(state)
  life.paidMonth = monthKey(state)
  const banked = state.tally?.earned ?? 0
  if (banked > 0) {
    life.migratedFrom = banked
    book(life, careerDayOf(state), '历史工资结转（之前赛季已结算的收入）', banked)
  }
  state.life = life
}

/** the manager's own work, scaled by how he is doing: 0.92 … 1.08 */
export function lifeMod(state: GameState): number {
  const l = state.life
  if (!l) return 1
  const v = ((l.hunger - 60) / 100) * LIFE.MOD_HUNGER + ((l.mood - 60) / 100) * LIFE.MOD_MOOD
  return 1 + clamp(v, -LIFE.MOD_MAX, LIFE.MOD_MAX)
}

/** why this activity cannot be bought now — null when it can */
export function lifeBlock(state: GameState, act: LifeAct): string | null {
  const l = state.life
  if (!l) return '这个存档没有经理生活。'
  const a = LIFE_ACTS[act]
  const cd = careerDayOf(state)
  if ((l.cooldowns[act] ?? 0) > cd) return `${a.label}今天已经用过了，${l.cooldowns[act] - cd} 天后再来。`
  if (a.price > l.wallet) return `个人余额不够：${a.label}要 $${a.price}，钱包里只有 $${Math.round(l.wallet)}。`
  if (a.hunger > 0 && l.hunger >= 100) return '已经吃饱了。'
  if (a.hunger === 0 && a.mood > 0 && l.mood >= 100) return '心情已经满了。'
  return null
}

export function doLifeAct(state: GameState, act: LifeAct): { ok: boolean; text: string } {
  const why = lifeBlock(state, act)
  if (why) return { ok: false, text: why }
  const l = state.life!
  const a = LIFE_ACTS[act]
  const cd = careerDayOf(state)
  if (a.price) book(l, cd, a.label, -a.price)
  l.hunger = clamp(l.hunger + a.hunger, 0, 100)
  l.mood = clamp(l.mood + a.mood, 0, 100)
  if (a.cooldownDays) l.cooldowns[act] = cd + a.cooldownDays
  return {
    ok: true,
    text: `${a.label}${a.price ? `，花了 $${a.price}` : ''}。饱腹 ${Math.round(l.hunger)}，心情 ${Math.round(l.mood)}。`,
  }
}

/** spend from the wallet on something else (a birthday gift); refuses rather than going negative */
export function spendWallet(state: GameState, label: string, amount: number): string | null {
  const l = state.life
  if (!l) return '这个存档没有经理钱包。'
  if (amount > l.wallet) return `个人余额不够：要 $${amount}，钱包里只有 $${Math.round(l.wallet)}。`
  book(l, careerDayOf(state), label, -amount)
  return null
}

/**
 * The day's bookkeeping, run once per game day from advanceDay: pay the
 * month if a new one began, decay the two numbers once, buy the auto meal
 * if it is on and affordable. Opening the page ten times is not ten days.
 */
export function tickLife(state: GameState, notes: string[]): void {
  const l = state.life
  if (!l || !state.manager) return
  const cd = careerDayOf(state)
  if (l.tickedOn >= cd) return
  const days = Math.min(cd - l.tickedOn, 7)
  l.tickedOn = cd

  const month = monthKey(state)
  if (l.paidMonth !== month) {
    l.paidMonth = month
    const pay = monthlyPay(state)
    if (pay > 0) {
      book(l, cd, `工资 · ${month.replace('-', ' 年 ')} 月`, pay)
      state.tally ??= { signed: 0, hired: 0, earned: 0, commercial: 0 }
      state.tally.earned += pay
      notes.push(`💵 这个月的工资到账，$${pay.toLocaleString('en-US')}，个人余额 $${Math.round(l.wallet).toLocaleString('en-US')}。`)
    }
    l.auto.spentMonth = month
    l.auto.spent = 0
  }

  for (let i = 0; i < days; i++) {
    l.hunger = clamp(l.hunger - LIFE.HUNGER_PER_DAY, 0, 100)
    // the drift stops at the floor; only going hungry pushes below it
    const drift = l.mood > LIFE.MOOD_FLOOR ? LIFE.MOOD_PER_DAY : 0
    l.mood = clamp(l.mood - drift - (l.hunger < LIFE.HUNGRY_AT ? LIFE.HUNGRY_MOOD : 0), 0, 100)
    if (l.auto.meal && l.hunger < LIFE.AUTO_AT) {
      const act: LifeAct = l.auto.meal === 'good' ? 'goodMeal' : 'cheapMeal'
      const a = LIFE_ACTS[act]
      if (l.auto.spent + a.price > l.auto.budget) {
        if (i === 0) notes.push(`🍽️ 自动补给停了：这个月的伙食预算 $${l.auto.budget} 用完了。`)
      } else if (a.price > l.wallet) {
        if (i === 0) notes.push(`🍽️ 自动补给停了：个人余额不够买${a.label}。`)
      } else if ((l.cooldowns[act] ?? 0) <= cd) {
        book(l, cd, `${a.label}（自动）`, -a.price)
        l.hunger = clamp(l.hunger + a.hunger, 0, 100)
        l.mood = clamp(l.mood + a.mood, 0, 100)
        l.auto.spent += a.price
        if (a.cooldownDays) l.cooldowns[act] = cd + a.cooldownDays
      }
    }
  }
  if (l.hunger < LIFE.HUNGRY_AT && !l.auto.meal) notes.push(`🍽️ 你已经很久没好好吃饭了（饱腹 ${Math.round(l.hunger)}），去经理页吃点东西。`)
}

export function setAutoMeal(state: GameState, meal: 'cheap' | 'good' | null, budget?: number): void {
  const l = state.life
  if (!l) return
  l.auto.meal = meal
  if (budget != null) l.auto.budget = Math.max(0, Math.round(budget))
}
