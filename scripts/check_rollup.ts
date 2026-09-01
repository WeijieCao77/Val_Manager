/**
 * The numbers that have to outlive the pruner.
 *
 *   npx tsx scripts/check_rollup.ts
 *
 * The events table is a rolling window, and at this game's volume the four
 * million row ceiling is about a day of history — everything older is deleted,
 * which on 8/31 took a month of it. So the figures are folded into two tables
 * that are never pruned, BEFORE the deletion runs.
 *
 * The property that matters is exactly that: run the rollup, delete every
 * single event, and the history is still there and still correct. A cumulative
 * player count in particular cannot be recomputed from rows that no longer
 * exist, which is why visitors is a table and not a query.
 */
import { PGlite } from '@electric-sql/pglite'
import { SCHEMA } from '../analytics.js'
import { ROLLUP_SCHEMA, history, rollup } from '../rollup.js'
import { prune } from '../stats.js'

const db = new PGlite()
const sql = Object.assign(
  async (strings: TemplateStringsArray, ...vals: unknown[]) => {
    const text = strings.reduce((q, part, i) => q + part + (i < vals.length ? `$${i + 1}` : ''), '')
    const r = await db.query(text, vals as never[])
    return Object.assign(r.rows as never[], { count: r.affectedRows ?? 0 })
  },
  { unsafe: async (q: string) => (await db.exec(q), []) },
)
await db.exec(SCHEMA.replace(/^-- .*$/gm, ''))
await db.exec(ROLLUP_SCHEMA)

let bad = 0
const check = (ok: boolean, what: string, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}

let seq = 0
const ev = (vid: string, sid: string, name: string, ago: string, props: unknown = {}) =>
  db.query(
    `insert into events (ts, n, visitor_id, session_id, seq, device, name, props)
     values (now() + $1::interval, $2, $3, $4, 1, 'phone', $5, $6)`,
    [ago, ++seq, vid, sid, name, JSON.stringify(props)],
  )

// two days of a small population
await ev('v1', 's1', 'session_start', '-2 days', { host: 'vctgames.com' })
await ev('v1', 's1', 'career_start', '-2 days', { club: 'EDG' })
await ev('v1', 's1', 'turns', '-2 days', { turns: 4, day: 20 })
await ev('v1', 's1', 'turns', '-2 days', { turns: 9, day: 40 })   // a running total
await ev('v1', 's1', 'session_ping', '-2 days', { active_s: 300 })
await ev('v1', 's1', 'session_end', '-2 days', { active_s: 600 }) // ditto
await ev('v2', 's2', 'session_start', '-2 days', {})
await ev('v2', 's2', 'card_start', '-2 days', {})
await ev('v2', 's2', 'card_pull', '-2 days', { kind: 'ten' })
await ev('v1', 's3', 'session_start', '-1 days', {})
await ev('v1', 's3', 'turn', '-1 days', { day: 60 })              // the old shape
await ev('v3', 's4', 'session_start', '-1 days', {})
await ev('v3', 's4', 'error', '-1 days', { msg: 'boom' })

const first = await rollup(sql as never, 5)
console.log('第一次汇总：', JSON.stringify(first))

const h1 = await history(sql as never, 30)
const byDay = Object.fromEntries(h1.days.map((d: Record<string, unknown>) =>
  [String(d.day).slice(0, 10), d]))
const two = Object.values(byDay)[1] as Record<string, number>
const one = Object.values(byDay)[0] as Record<string, number>

check(h1.totals.players === 3, '累计玩家数是 3', String(h1.totals.players))
check(h1.days.length === 2, '两天各一行', String(h1.days.length))
check(two.visitors === 2 && one.visitors === 2, '每天的人数对', `${two.visitors} / ${one.visitors}`)
check(two.active_min === 10, '时长取每个会话报过的最大值，不是把心跳加起来',
  `${two.active_min} 分钟（心跳相加会是 15）`)
check(two.turns === 9, '回合数同理，取运行总数的最大值', String(two.turns))
check(one.turns === 1, '老格式的每回合一行，还是按条数算', String(one.turns))
check(two.career_starts === 1 && two.card_pulls === 1, '事件分类对')
check(one.errors === 1, '报错也记下来')

// ---- the whole point: run it again, then delete everything --------------
const second = await rollup(sql as never, 5)
check(second.days === 2, '再跑一次是覆盖，不是追加', JSON.stringify(second))
const dup = await sql`select count(*)::int as n from daily_stats`
check(dup[0].n === 2, '还是两行', String(dup[0].n))

await prune(sql as never, 0, 0)          // the pruner, at its most brutal
const left = await sql`select count(*)::int as n from events`
check(left[0].n === 0, '明细已经被删光了', String(left[0].n))

const h2 = await history(sql as never, 30)
check(h2.totals.players === 3, '删光之后累计玩家数还在', String(h2.totals.players))
check(h2.days.length === 2, '每天的汇总也还在', String(h2.days.length))
const two2 = Object.values(Object.fromEntries(h2.days.map((d: Record<string, unknown>) =>
  [String(d.day).slice(0, 10), d])))[1] as Record<string, number>
check(two2.visitors === 2 && two2.active_min === 10 && two2.turns === 9,
  '而且数字和删之前一模一样', JSON.stringify(two2))

// a visitor seen again later must not be counted as new again
await ev('v1', 's9', 'session_start', '0 days', {})
await rollup(sql as never, 5)
const h3 = await history(sql as never, 30)
check(h3.totals.players === 3, '老玩家回来不会让累计人数变多', String(h3.totals.players))
const today = h3.days[0] as Record<string, number>
check(today.new_visitors === 0, '也不算作当天的新玩家', String(today.new_visitors))

console.log(bad ? `\n${bad} FAILED` : '\nall good')
process.exit(bad ? 1 : 0)
