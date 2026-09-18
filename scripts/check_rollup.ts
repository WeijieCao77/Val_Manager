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
import { makeSql } from '../pglite-sql.js'
import { SCHEMA } from '../analytics.js'
import { ROLLUP_SCHEMA, foldedUpTo, history, pruneFolded, rollup } from '../rollup.js'
import { prune } from '../stats.js'

const db = new PGlite()
const sql = makeSql(db)
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

const NOW = { lagSec: 0 }
const first = await rollup(sql as never, NOW)
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
// Since 2026-09-18 the rollup folds each event once behind a watermark, so a
// second run has nothing to do — it used to recompute both days and say 2.
// What the assertion was for is unchanged and checked on the next lines too:
// running it again must not add anything.
const second = await rollup(sql as never, NOW)
check(second.days === 0 && second.events === 0, '再跑一次什么都不追加', JSON.stringify(second))
const same = await history(sql as never, 30)
check(JSON.stringify(same.days.map((d: Record<string, unknown>) => ({ ...d, built: 0 })))
  === JSON.stringify(h1.days.map((d: Record<string, unknown>) => ({ ...d, built: 0 }))), '两天的数字和第一次一模一样')
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
await rollup(sql as never, NOW)
const h3 = await history(sql as never, 30)
check(h3.totals.players === 3, '老玩家回来不会让累计人数变多', String(h3.totals.players))
const today = h3.days[0] as Record<string, number>
check(today.new_visitors === 0, '也不算作当天的新玩家', String(today.new_visitors))

// ---- 2026-09-18: a prune INSIDE the window must not take a day back ------
// Four visitors today, all folded. The row ceiling then deletes half of
// today's events — and the old rollup, recomputing today from what was left,
// wrote 2 over the 4.
{
  for (const v of ['w1', 'w2', 'w3', 'w4']) await ev(v, `sw-${v}`, 'card_start', '0 days', {})
  await rollup(sql as never, NOW)
  const day = async () => ((await history(sql as never, 30)).days[0]) as Record<string, number>
  const before = await day()
  await sql`delete from events where id in (select id from events order by id desc limit 2)`
  await rollup(sql as never, NOW)
  const after = await day()
  check(after.visitors === before.visitors && after.card_starts === before.card_starts && after.events === before.events,
    '窗口内的事件被清掉一半后再汇总，当天的数不回退', `${before.visitors}/${before.card_starts}/${before.events} → ${after.visitors}/${after.card_starts}/${after.events}`)

  // an event not folded yet is not the pruner's to delete, however low the ceiling
  await ev('w5', 'sw-w5', 'card_start', '0 days', {})
  const mark = await foldedUpTo(sql as never)
  await pruneFolded(sql as never, prune as never, 0, 0)
  const kept = await sql`select count(*)::int as n, min(id) as lo from events`
  check(kept[0].n === 1 && Number(kept[0].lo) > mark, '还没汇总的事件，清理不碰', JSON.stringify(kept[0]))
  await rollup(sql as never, NOW)
  const folded = await day()
  check(folded.visitors === before.visitors + 1 && folded.card_starts === before.card_starts + 1, '它下一次汇总照常计入', `${folded.visitors} 人`)

  // a fold that dies half way leaves nothing behind: watermark and figures move together
  await ev('w6', 'sw-w6', 'card_start', '0 days', {})
  const markBefore = await foldedUpTo(sql as never)
  const broken = ((strings: TemplateStringsArray, ...vals: unknown[]) => {
    if (/update rollup_state set last_id/.test(strings.join('?'))) throw new Error('断电')
    return (sql as any)(strings, ...vals)
  }) as any
  Object.assign(broken, { json: (sql as any).json, begin: (fn: any) => (sql as any).begin((tx: any) => {
    const wrapped = ((st: TemplateStringsArray, ...v: unknown[]) => {
      if (/update rollup_state set last_id/.test(st.join('?'))) throw new Error('断电')
      return tx(st, ...v)
    }) as any
    Object.assign(wrapped, { json: tx.json ?? (sql as any).json })
    return fn(wrapped)
  }) })
  let threw = false
  try { await rollup(broken, NOW) } catch { threw = true }
  const mid = await day()
  check(threw && (await foldedUpTo(sql as never)) === markBefore && mid.visitors === folded.visitors,
    '汇总中途失败：水位和数字一起回滚', `${mid.visitors} 人`)
  await rollup(sql as never, NOW)
  const healed = await day()
  check(healed.visitors === folded.visitors + 1 && healed.card_starts === folded.card_starts + 1, '恢复后补上，不多不少', `${healed.visitors} 人 / ${healed.card_starts} 次`)

  // history written by the old method, whose events are partly gone, is only ever raised on the first fold
  const db2 = new PGlite(), sql2 = makeSql(db2)
  await db2.exec(SCHEMA.replace(/^-- .*$/gm, ''))
  await db2.exec(ROLLUP_SCHEMA)
  await db2.query(`insert into daily_stats (day, visitors, sessions, card_starts, events) values (current_date - 1, 40, 55, 30, 900)`)
  await db2.query(`insert into events (ts, n, visitor_id, session_id, seq, device, name, props)
                   values (now() - interval '1 day', 1, 'old1', 'os1', 1, 'phone', 'card_start', '{}')`)
  await rollup(sql2 as never, NOW)
  const y = (await sql2`select visitors, sessions, card_starts, events from daily_stats where day = current_date - 1`)[0]
  check(y.visitors === 40 && y.sessions === 55 && y.card_starts === 30 && y.events === 900,
    '迁移：旧方法写下的历史日，首次汇总只升不降', JSON.stringify(y))
  await db2.close()

  // small batches walk the same road to the same place
  const db3 = new PGlite(), sql3 = makeSql(db3)
  await db3.exec(SCHEMA.replace(/^-- .*$/gm, ''))
  await db3.exec(ROLLUP_SCHEMA)
  for (let i = 0; i < 25; i++) {
    await db3.query(`insert into events (ts, n, visitor_id, session_id, seq, device, name, props)
                     values (now(), $1, $2, $3, 1, 'phone', $4, $5)`,
      [i + 1, `b${i % 7}`, `bs${i % 9}`, i % 3 ? 'session_ping' : 'card_pull', JSON.stringify({ active_s: 60 * (i + 1) })])
  }
  const walked = await rollup(sql3 as never, { lagSec: 0, batch: 4 })
  const d3 = (await sql3`select visitors, sessions, card_pulls, events, active_min from daily_stats`)[0]
  check(walked.events === 25 && d3.visitors === 7 && d3.sessions === 9 && d3.card_pulls === 9 && d3.events === 25,
    '分批汇总（每批 4 条）与一次汇总同数', JSON.stringify({ walked, d3 }))
  await db3.close()
}

// Old day membership must survive multiple runs and late arrivals.
await ev('late-a', 'late-sa', 'card_start', '-40 days')
await rollup(sql as never, NOW)
await ev('late-b', 'late-sb', 'card_start', '-40 days')
await rollup(sql as never, NOW)
const late = (await sql`select visitors, sessions, card_starts from daily_stats where day = current_date - 40`)[0]
check(late.visitors === 2 && late.sessions === 2 && late.card_starts === 2, '40天前迟到事件保留完整访客集合', JSON.stringify(late))

console.log(bad ? `\n${bad} FAILED` : '\nall good')
process.exit(bad ? 1 : 0)
