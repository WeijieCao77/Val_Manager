/**
 * A birthday the manager can do something about.
 *
 * life.ts marked birthdays with a note and three points of morale and
 * nothing to decide. It also matched them on a non-leap 2001 and `day %
 * 365`, so from March on every birthday in a leap year fired a day early,
 * Feb 29 was Mar 1 in ordinary years and Dec 31 vanished in leap years.
 *
 * Now the game date is a real calendar date (the same one the top bar
 * prints), a birthday is the month and day of `birth` — Feb 29 falls on
 * Feb 28 when there is no 29th — and each one for the managed squad is a
 * record with a window to answer it in:
 *
 *   wish   送祝福      免费          士气 +2，信任 +1
 *   gift   送小礼物    经理个人 $200  士气 +5，信任 +3
 *   party  组织庆祝    俱乐部 $2,500 + 1 行动力  他士气 +6、信任 +3，全队士气 +2、和他关系 +2
 *   skip   暂不处理    —            什么也不发生
 *
 * The day itself still gives him one point of morale — people are nicer to
 * you on your birthday whether the boss remembers or not — and the rest is
 * the manager's. One record per player per season, closed when he leaves,
 * expired after BIRTHDAY_WINDOW days. Unknown birthdays get nothing: no
 * date is invented (Player.birth is null when the record had none).
 */
import type { GameState, Player } from './types'
import { clamp } from './rng'
import { careerDayOf } from './clock'
import { squadOf } from './roster'
import { trustShift } from './trust'
import { duoBonded } from './bonds'
import { spendWallet } from './managerLife'

export type BirthdayChoice = 'wish' | 'gift' | 'party' | 'skip'
export type BirthdayStatus = 'pending' | 'handled' | 'expired' | 'closed'

export interface BirthdayEvent {
  id: string
  playerId: string
  year: number
  /** the day it fell on this season */
  day: number
  /** how old he turned */
  age: number
  status: BirthdayStatus
  choice?: BirthdayChoice
  handledOn?: number
  text?: string
}

export const BIRTHDAY = {
  WINDOW_DAYS: 7,
  DAY_MORALE: 1,
  wish: { morale: 2, trust: 1 },
  gift: { price: 200, morale: 5, trust: 3 },
  party: { cost: 2500, morale: 6, trust: 3, squadMorale: 2, bond: 2 },
} as const
export const BIRTHDAY_CHOICE_CN: Record<BirthdayChoice, string> = {
  wish: '送祝福', gift: '送小礼物', party: '组织简短庆祝', skip: '暂不处理',
}

/** the real calendar date of a game day */
export function gameDate(state: { year: number; day: number }): Date {
  const d = new Date(Date.UTC(state.year, 0, 1))
  d.setUTCDate(d.getUTCDate() + state.day)
  return d
}

const parse = (iso: string | null | undefined): { y: number; m: number; d: number } | null => {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null
  if (!m) return null
  const r = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) }
  return r.m >= 1 && r.m <= 12 && r.d >= 1 && r.d <= 31 ? r : null
}
const leap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0

/** is this game day his birthday — Feb 29 is kept on Feb 28 in an ordinary year */
export function isBirthday(p: Pick<Player, 'birth'>, state: { year: number; day: number }): boolean {
  const b = parse(p.birth)
  if (!b) return false
  const d = gameDate(state)
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth() + 1
  const dd = d.getUTCDate()
  if (b.m === 2 && b.d === 29 && !leap(y)) return m === 2 && dd === 28
  return m === b.m && dd === b.d
}

/** how old he is on this game day, from the date itself — not the season count */
export function ageOn(p: Pick<Player, 'birth' | 'age'>, state: { year: number; day: number }): number {
  const b = parse(p.birth)
  if (!b) return p.age
  const d = gameDate(state)
  let age = d.getUTCFullYear() - b.y
  const m = d.getUTCMonth() + 1
  const dd = d.getUTCDate()
  if (m < b.m || (m === b.m && dd < b.d)) age--
  return age
}

export const pendingBirthdays = (state: GameState): BirthdayEvent[] =>
  (state.birthdays ?? []).filter((e) => e.status === 'pending')

export const birthdayFor = (state: GameState, pid: string): BirthdayEvent | undefined =>
  pendingBirthdays(state).find((e) => e.playerId === pid)

/** the day's birthdays for the managed squad: the note, the point, the record */
export function tickBirthdays(state: GameState, notes: string[]): void {
  state.birthdays ??= []
  for (const p of squadOf(state, state.myTeam)) {
    if (!isBirthday(p, state)) continue
    const id = `${state.year}:${p.id}`
    if (state.birthdays.some((e) => e.id === id)) continue
    p.morale = clamp(p.morale + BIRTHDAY.DAY_MORALE, 0, 100)
    const age = ageOn(p, state)
    state.birthdays.push({ id, playerId: p.id, year: state.year, day: state.day, age, status: 'pending' })
    notes.push(`🎂 ${p.ign} 今天 ${age} 岁生日，${BIRTHDAY.WINDOW_DAYS} 天内可以在他的页面表示一下。`)
  }
  // windows close, leavers close
  const cd = careerDayOf(state)
  for (const e of state.birthdays) {
    if (e.status !== 'pending') continue
    const p = state.players[e.playerId]
    if (!p || p.teamId !== state.myTeam) { e.status = 'closed'; continue }
    if (cd - (e.year * 364 + e.day) > BIRTHDAY.WINDOW_DAYS) e.status = 'expired'
  }
  if (state.birthdays.length > 60) state.birthdays.splice(0, state.birthdays.length - 60)
}

export function birthdayBlock(state: GameState, id: string, choice: BirthdayChoice): string | null {
  const e = (state.birthdays ?? []).find((x) => x.id === id)
  if (!e) return '没有这条记录。'
  if (e.status !== 'pending') return e.status === 'expired' ? '生日已经过去一周了。' : '这个生日已经处理过了。'
  const p = state.players[e.playerId]
  if (!p || p.teamId !== state.myTeam) return '他已经不在队里。'
  if (choice === 'gift' && (state.life?.wallet ?? 0) < BIRTHDAY.gift.price) return `个人余额不够：礼物要 $${BIRTHDAY.gift.price}，钱包里只有 $${Math.round(state.life?.wallet ?? 0)}。`
  if (choice === 'party' && state.finances.balance < BIRTHDAY.party.cost) return `俱乐部资金不够：庆祝要 $${BIRTHDAY.party.cost.toLocaleString('en-US')}。`
  return null
}

/** the action point for a party is the caller's to spend first — birthdayBlock says whether it will be honoured */
export function handleBirthday(state: GameState, id: string, choice: BirthdayChoice): { ok: boolean; text: string } {
  const why = birthdayBlock(state, id, choice)
  if (why) return { ok: false, text: why }
  const e = state.birthdays!.find((x) => x.id === id)!
  const p = state.players[e.playerId]
  const done = (text: string) => {
    e.status = 'handled'; e.choice = choice; e.handledOn = careerDayOf(state); e.text = text
    return { ok: true, text }
  }
  switch (choice) {
    case 'wish':
      p.morale = clamp(p.morale + BIRTHDAY.wish.morale, 0, 100)
      trustShift(p, BIRTHDAY.wish.trust)
      return done(`给 ${p.ign} 发了生日祝福，他挺高兴。士气 +${BIRTHDAY.wish.morale}，信任 +${BIRTHDAY.wish.trust}。`)
    case 'gift': {
      const refused = spendWallet(state, `生日礼物 · ${p.ign}`, BIRTHDAY.gift.price)
      if (refused) return { ok: false, text: refused }
      p.morale = clamp(p.morale + BIRTHDAY.gift.morale, 0, 100)
      trustShift(p, BIRTHDAY.gift.trust)
      return done(`自己掏 $${BIRTHDAY.gift.price} 给 ${p.ign} 买了份小礼物。士气 +${BIRTHDAY.gift.morale}，信任 +${BIRTHDAY.gift.trust}。`)
    }
    case 'party': {
      const cost = BIRTHDAY.party.cost
      state.finances.balance -= cost
      state.finances.log.push({ day: state.day, label: `生日庆祝 · ${p.ign}`, amount: -cost })
      const team = state.teams[state.myTeam]
      if (team) team.budget -= cost
      p.morale = clamp(p.morale + BIRTHDAY.party.morale, 0, 100)
      trustShift(p, BIRTHDAY.party.trust)
      for (const q of squadOf(state, state.myTeam)) {
        if (q.id === p.id) continue
        q.morale = clamp(q.morale + BIRTHDAY.party.squadMorale, 0, 100)
        duoBonded(state, p.id, q.id, BIRTHDAY.party.bond)
      }
      return done(`训练后给 ${p.ign} 切了个蛋糕，俱乐部出 $${cost.toLocaleString('en-US')}。他士气 +${BIRTHDAY.party.morale}、信任 +${BIRTHDAY.party.trust}，全队士气 +${BIRTHDAY.party.squadMorale}，大家和他更近了。`)
    }
    case 'skip':
      return done(`这次没表示。`)
  }
}
