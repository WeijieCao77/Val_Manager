/**
 * 每日挑战 at the hour each account picks.
 *
 *   npx tsx scripts/check_challenge_hour.ts
 *
 * Midnight was everybody at once (2026-10-03), so the puzzle turns over at an
 * hour the account chooses, starting the next Beijing date. Walked hour by hour
 * over every switch between two hours, the puzzle label must never go
 * backwards (no replay) and never skip (no lost day), today's puzzle must not
 * move when the hour is changed, and the new hour must hold from tomorrow on.
 */
import { beijingDay, challengeDay, challengeSig, newChallenge, nextTurnover, setChallengeHour } from '../src/engine/challenge'
import { runAction } from '../src/engine/cardActions'
import { newGacha } from '../src/engine/gacha'

const store = new Map<string, string>()
;(globalThis as never as { localStorage: unknown }) = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
  key: () => null, clear: () => store.clear(), get length() { return store.size },
}

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok || process.env.VERBOSE) console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}

const H = 3_600_000
/** epoch ms of a Beijing wall-clock moment */
const bj = (date: string, hour: number, min = 0) => Date.parse(`${date}T00:00:00Z`) - 8 * H + hour * H + min * 60_000
const dayAdd = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10)
}

// no choice made = midnight, exactly the old serverDay()
check('没选过就是 0 点', challengeDay(undefined, bj('2026-10-03', 23, 59)) === '2026-10-03' && challengeDay(newChallenge(), bj('2026-10-04', 0)) === '2026-10-04')
check('beijingDay = 北京日期', beijingDay(bj('2026-10-03', 0)) === '2026-10-03' && beijingDay(bj('2026-10-03', 0) - 1) === '2026-10-02')

let switches = 0
for (let from = 0; from < 24; from++) {
  for (let to = 0; to < 24; to++) {
    for (const changeAt of [0, 7, 15, 23]) {
      const c = newChallenge()
      const D = '2026-10-03'
      if (from) { c.hour = from }
      const t0 = bj(D, changeAt, 30)
      const before = challengeDay(c, t0)
      const g = { challenge: c } as never
      setChallengeHour(g, to, beijingDay(t0))
      check(`${from}→${to} at ${changeAt}:30 今天的题不变`, challengeDay(c, t0) === before)
      // walk minute-ish steps from the change for three days
      let last = before
      const seen = [before]
      for (let t = t0; t < bj(dayAdd(D, 3), 0); t += 10 * 60_000) {
        const d = challengeDay(c, t)
        if (d !== last) {
          check(`${from}→${to}@${changeAt} 只前进一天`, d === dayAdd(last, 1), `${last} → ${d} at ${new Date(t).toISOString()}`)
          // the turnover happens at the hour in force, and from tomorrow it is the new one
          const date = beijingDay(t)
          const hourNow = new Date(t + 8 * H).getUTCHours()
          check(`${from}→${to}@${changeAt} 换题的钟点对`, date === D ? hourNow === from : hourNow === to, `${date} ${hourNow}`)
          seen.push(d); last = d
        }
      }
      // from tomorrow, the label at the chosen hour is the date itself
      check(`${from}→${to}@${changeAt} 明天 ${to} 点是明天的题`, challengeDay(c, bj(dayAdd(D, 1), to)) === dayAdd(D, 1))
      check(`${from}→${to}@${changeAt} 没有多出一道`, new Set(seen).size === seen.length)
      switches++
    }
  }
}

// nextTurnover agrees with challengeDay changing
{
  const c = newChallenge()
  c.hour = 20
  const t = bj('2026-10-03', 10)
  const n = nextTurnover(c, t)
  check('下一题时间：今天 20 点', n === bj('2026-10-03', 20) && challengeDay(c, n - 1) !== challengeDay(c, n))
  setChallengeHour({ challenge: c } as never, 6, '2026-10-03')
  const n2 = nextTurnover(c, bj('2026-10-03', 21))
  check('改到 6 点后：今晚 20 点过了，下一题明天 6 点', n2 === bj('2026-10-04', 6), new Date(n2).toISOString())
}

// through the action the server runs
{
  const g = newGacha()
  g.coins = 10_000
  const today = '2026-10-03'
  const env = (now: number) => ({ now, today: beijingDay(now), seed: 1 })
  let r = runAction(g, 'challenge_hour', { hour: 25 }, env(bj(today, 9)))
  check('25 点不收', !r.ok)
  r = runAction(g, 'challenge_hour', { hour: 1.5 }, env(bj(today, 9)))
  check('小数不收', !r.ok)
  r = runAction(g, 'challenge_hour', { hour: 20 }, env(bj(today, 9)))
  check('20 点收下，明天生效', r.ok && g.challenge?.hour === 20 && g.challenge?.hourFrom === '2026-10-04' && g.challenge?.prevHour === 0)
  // guess today's (midnight) puzzle: it is still the 3rd's
  r = runAction(g, 'challenge', { guessId: 'nope', sig: challengeSig() }, env(bj(today, 9)))
  check('今天照旧在做 10-03 的题', r.ok && g.challenge?.day === '2026-10-03')
  runAction(g, 'challenge', { guessId: 'nope', sig: challengeSig() }, env(bj('2026-10-04', 10)))
  check('明天 10 点还是 10-03 的题（20 点才换）', g.challenge?.day === '2026-10-03' && g.challenge.guesses.length === 2)
  runAction(g, 'challenge', { guessId: 'nope', sig: challengeSig() }, env(bj('2026-10-04', 20, 1)))
  check('明天 20 点换成 10-04 的题', g.challenge?.day === '2026-10-04' && g.challenge.guesses.length === 1)
}

console.log(`${switches} hour switches walked; ${bad ? `${bad} FAILED` : 'all ok'}`)
process.exit(bad ? 1 : 0)
