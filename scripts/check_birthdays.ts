/**
 * A birthday is on the right day and is a decision.
 *
 *   npx tsx scripts/check_birthdays.ts
 *
 * 2026-09-13. The old match was `dayOfYear(birth) === day % 365` on a
 * non-leap 2001: a day early from March in leap years, Feb 29 on Mar 1,
 * Dec 31 never in a leap year. Now the game date is the real calendar and
 * each birthday is a record with a week to answer it, once per player per
 * season, closed when he leaves, paid from the right pocket or not at all.
 */
const mem: Record<string, string> = {}
;(globalThis as never as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => mem[k] ?? null,
  setItem: (k: string, v: string) => { mem[k] = v },
  removeItem: (k: string) => { delete mem[k] },
  key: (i: number) => Object.keys(mem)[i] ?? null,
  get length() { return Object.keys(mem).length },
}
import { createNewGame } from '../src/engine/world'
import { WORLD_TEAMS } from '../src/engine/teams'
import { advanceDay, finishDraw, setupSeason, continuePastFive, dateLabel } from '../src/engine/season'
import { exportSave, importSave } from '../src/engine/save'
import { createManager } from '../src/engine/manager'
import { squadOf } from '../src/engine/roster'
import { releasePlayer } from '../src/engine/transfer'
import { agendaFor } from '../src/engine/agenda'
import { spendAction } from '../src/engine/actions'
import {
  BIRTHDAY, ageOn, birthdayBlock, birthdayFor, gameDate, handleBirthday, isBirthday, pendingBirthdays, tickBirthdays,
} from '../src/engine/birthdays'
import type { GameState } from '../src/engine/types'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const mk = (seed = 20260913): GameState => {
  const g = createNewGame(WORLD_TEAMS.find((t) => t.tag === 'EDG')!.id, '审计', seed, createManager('审计', 30, 'expro'))
  setupSeason(g)
  g.boardConfidence = 100; g.onNotice = false; g.missedStreak = 0
  return g
}
const step = (g: GameState, n: number) => {
  for (let i = 0; i < n; i++) {
    advanceDay(g, { autoResolveDrawDecisions: true })
    if (g.midReview) continuePastFive(g)
    if (g.pendingDrawId) finishDraw(g, g.pendingDrawId)
  }
}
const iso = (d: Date) => d.toISOString().slice(0, 10)

// ---- the calendar
{
  const at = (year: number, day: number) => ({ year, day })
  const firesOn = (birth: string, year: number): string[] => {
    const days: string[] = []
    for (let d = 0; d < 366; d++) if (isBirthday({ birth }, at(year, d))) days.push(iso(gameDate(at(year, d))))
    return days
  }
  check('2026（平年）7 月 11 日就在 7 月 11 日', firesOn('1999-07-11', 2026).join() === '2026-07-11')
  check('2028（闰年）7 月 11 日还是 7 月 11 日，不提前一天', firesOn('1999-07-11', 2028).join() === '2028-07-11')
  check('12 月 31 日闰年也过', firesOn('1999-12-31', 2028).join() === '2028-12-31')
  check('2 月 29 日出生：平年 2 月 28 日过', firesOn('2000-02-29', 2026).join() === '2026-02-28')
  check('2 月 29 日出生：闰年 2 月 29 日过', firesOn('2000-02-29', 2028).join() === '2028-02-29')
  check('3 月 1 日出生的人闰年不会在 2 月 29 日过', firesOn('2000-03-01', 2028).join() === '2028-03-01')
  check('每年只有一天', firesOn('1999-07-11', 2027).length === 1)
  check('年龄按真实日期算：生日前一天还没长', ageOn({ birth: '1999-07-11', age: 0 }, at(2026, 190)) === 26 && ageOn({ birth: '1999-07-11', age: 0 }, at(2026, 191)) === 27)
  check('日期和顶栏一致', dateLabel(at(2028, 191) as GameState) === '2028年7月10日' && iso(gameDate(at(2028, 191))) === '2028-07-10')
  check('没有生日的人永远不触发', !isBirthday({ birth: null }, at(2026, 100)) && !isBirthday({ birth: '1999-??-??' as string }, at(2026, 100)))
}

// ---- the event, day by day and week by week
{
  const g = mk()
  const squad = squadOf(g, g.myTeam)
  const [a, b, c] = squad
  // put three birthdays on known days: a and b together on day 10, c on day 40; d has no birthday
  const on = (day: number) => iso(gameDate({ year: g.year, day }))
  a.birth = `1998-${on(10).slice(5)}`; b.birth = `2001-${on(10).slice(5)}`; c.birth = `1999-${on(40).slice(5)}`
  squad[3].birth = null
  step(g, 10)
  const pend = pendingBirthdays(g)
  check('同一天两个人各有一条记录', pend.length === 2 && pend.some((e) => e.playerId === a.id) && pend.some((e) => e.playerId === b.id), `${pend.length}`)
  check('待办里有他们', agendaFor(g).some((i) => i.key.startsWith('birthday:')))
  const ea = birthdayFor(g, a.id)!
  const m0 = a.morale
  const r = handleBirthday(g, ea.id, 'wish')
  check('送祝福：免费，士气 +2', r.ok && a.morale === Math.min(100, m0 + BIRTHDAY.wish.morale))
  check('处理过的再点不生效', !handleBirthday(g, ea.id, 'wish').ok && !handleBirthday(g, ea.id, 'gift').ok)
  // b: a gift from the wallet, refused when empty
  const eb = birthdayFor(g, b.id)!
  g.life!.wallet = 0
  const w0 = g.finances.balance
  const refused = handleBirthday(g, eb.id, 'gift')
  check('钱包没钱：礼物被拒，什么也不扣', !refused.ok && eb.status === 'pending' && g.finances.balance === w0)
  g.life!.wallet = 1000
  const gift = handleBirthday(g, eb.id, 'gift')
  check('礼物从经理钱包出，不动俱乐部资金', gift.ok && g.life!.wallet === 1000 - BIRTHDAY.gift.price && g.finances.balance === w0)
  // c: a week later, over a week-long advance, the window still catches it
  step(g, 33)
  const ec = birthdayFor(g, c.id)
  check('推进一周跨过生日，记录还在窗口内', !!ec && ec.status === 'pending')
  const bal = g.finances.balance
  const tm = squad[4].morale
  check('庆祝前先看行动力', spendAction(g, 'venture'))
  const party = handleBirthday(g, ec!.id, 'party')
  check('庆祝走俱乐部财务，记在账上，全队士气 +2', party.ok && g.finances.balance === bal - BIRTHDAY.party.cost && g.finances.log.at(-1)?.label.startsWith('生日庆祝') && squad[4].morale === Math.min(100, tm + BIRTHDAY.party.squadMorale))
  check('没有生日的人没有记录', !(g.birthdays ?? []).some((e) => e.playerId === squad[3].id))
  // expiry
  const h = mk()
  const hs = squadOf(h, h.myTeam)
  hs[0].birth = `1998-${iso(gameDate({ year: h.year, day: 5 })).slice(5)}`
  step(h, 5)
  check('生日当天有记录', !!birthdayFor(h, hs[0].id))
  step(h, BIRTHDAY.WINDOW_DAYS + 1)
  check('一周后过期，不能再处理', !birthdayFor(h, hs[0].id) && /过去一周/.test(birthdayBlock(h, `${h.year}:${hs[0].id}`, 'wish') ?? ''))
  check('过期后当年不会再生成', (h.birthdays ?? []).filter((e) => e.playerId === hs[0].id).length === 1)
  // next year: a new one
  step(h, 364)
  check('下一年再过一次', (h.birthdays ?? []).filter((e) => e.playerId === hs[0].id).length === 2)
  // leaving closes it
  const k = mk()
  const ks = squadOf(k, k.myTeam)
  ks[0].birth = `1998-${iso(gameDate({ year: k.year, day: 3 })).slice(5)}`
  step(k, 3)
  const ek = birthdayFor(k, ks[0].id)!
  releasePlayer(k, ks[0])
  tickBirthdays(k, [])
  check('离队后记录关闭，不能再付', ek.status === 'closed' && !handleBirthday(k, ek.id, 'gift').ok)
  // the save keeps it
  const back = importSave(exportSave(g))
  check('存档来回后记录不变', JSON.stringify(back.birthdays) === JSON.stringify(g.birthdays))
}

console.log(bad ? `\n${bad} 处不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
