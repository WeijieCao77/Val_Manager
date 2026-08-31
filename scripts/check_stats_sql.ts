/**
 * Every dashboard query, run against a real Postgres.
 *
 * Three of these were invalid SQL when they shipped — `date > integer`,
 * round() on a double, an outer select reaching for a column that only existed
 * inside its own subquery — and none of it showed up until an adversarial
 * review ran them. A query nobody has executed is a guess.
 *
 * Uses an in-process Postgres so this runs anywhere, including CI, with no
 * database to provision.
 */
import { PGlite } from '@electric-sql/pglite'
import { EVENTS, SCHEMA } from '../analytics.js'
import { CARD_SCHEMA } from '../cards-api.js'
import { overview, prune } from '../stats.js'

const db = new PGlite()

/** The tagged-template shape stats.js expects, backed by a real engine. */
const sql = Object.assign(
  async (strings: TemplateStringsArray, ...vals: unknown[]) => {
    const text = strings.reduce((q, part, i) => q + part + (i < vals.length ? `$${i + 1}` : ''), '')
    const r = await db.query(text, vals as never[])
    return Object.assign(r.rows as never[], { count: r.affectedRows ?? 0 })
  },
  { unsafe: async (q: string) => (await db.exec(q), []) },
)

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}

await db.exec(SCHEMA.replace(/^-- .*$/gm, ''))
// The card panels read the card mode's own saves, which live in a table this
// file used to know nothing about — a query against a table PGlite has never
// heard of fails the same way a syntax error does.
await db.exec(CARD_SCHEMA.replace(/^-- .*$/gm, ''))

// a small but realistic population: two people over three days, one of whom
// came back, plus the hostile row that used to poison every numeric cast
const rows: [string, string, number, string, string, unknown][] = [
  ['v1', 's1', 1, 'session_start', '-2 days', { new_id: true, had_save: false }],
  ['v1', 's1', 2, 'career_start', '-2 days', { club: 'TYL', tier: 'VCT', region: 'China' }],
  ['v1', 's1', 3, 'turn', '-2 days', { day: 7 }],
  ['v1', 's1', 4, 'screen', '-2 days', { to: 'squad' }],
  ['v1', 's1', 5, 'session_end', '-2 days', { active_s: 640, reason: 'pagehide' }],
  ['v1', 's2', 1, 'session_start', '-1 days', { new_id: false, had_save: true }],
  ['v1', 's2', 2, 'turn', '-1 days', { day: 34 }],
  ['v1', 's2', 3, 'match_watched', '-1 days', { day: 34, bo: 3, won: true }],
  ['v1', 's2', 4, 'stage_done', '-1 days', { place: 3 }],
  ['v1', 's2', 5, 'session_ping', '-1 days', { active_s: 900 }],
  ['v2', 's3', 1, 'session_start', '-1 days', { new_id: true, had_save: false }],
  ['v2', 's3', 2, 'session_end', '-1 days', { active_s: 12, reason: 'hidden' }],
  // Every shape an anonymous POST can take that used to kill the dashboard.
  // A type check alone did not stop the last two: 1.5 is a number and
  // '1.5'::bigint throws; 1e20 is a number and overflows bigint.
  ['v3', 's4', 1, 'session_ping', '0 days', { active_s: 'nope' }],
  ['v3', 's4', 2, 'turn', '0 days', { day: 'nope' }],
  ['v3', 's4', 3, 'turn', '0 days', { day: 1.5 }],
  ['v3', 's4', 4, 'turn', '0 days', { day: 1e20 }],
  ['v3', 's4', 5, 'session_ping', '0 days', { active_s: 1e308 }],
  ['v3', 's4', 6, 'session_ping', '0 days', { active_s: -900 }],
  ['v3', 's4', 9, 'error', '0 days', { msg: 'autosave: QuotaExceededError' }],
  // ---- the front page and the things it now leads to
  ['v1', 's2', 6, 'home_go', '-1 days', { go: 'career' }],
  ['v1', 's2', 7, 'home_go', '-1 days', { go: 'cards' }],
  ['v2', 's3', 3, 'home_go', '-1 days', { go: 'cards' }],
  ['v1', 's2', 8, 'game_over', '-1 days',
    { finished: 1, seasons: 11, honours: 20, dynasty: 'golden', story: 'homegrown' }],
  ['v2', 's3', 4, 'game_over', '-1 days',
    { finished: 0, seasons: 4, honours: 2, dynasty: 'nothing', story: 'shortStay' }],
  ['v1', 's2', 9, 'unlock', '-1 days', { kind: 'end', key: 'golden', name: '黄金之路' }],
  ['v1', 's2', 10, 'unlock', '-1 days', { kind: 'ach', key: 'firstTitle', name: '开张' }],
  ['v2', 's3', 5, 'unlock', '-1 days', { kind: 'ach', key: 'firstTitle', name: '开张' }],
  ['v1', 's2', 11, 'account', '-1 days', { act: 'new' }],
  ['v2', 's3', 6, 'account', '-1 days', { act: 'restore' }],
  // ---- the five-year settlement, whose answers were dropped at the door
  // until 'mid_review' was added to the allowlist
  ['v1', 's2', 12, 'mid_review', '-1 days', { settle: 0, honours: 12 }],
  ['v2', 's3', 7, 'mid_review', '-1 days', { settle: 1, honours: 3 }],
  // ---- 开瓦包. v1 goes all the way through and comes back the next day; v2
  // taps it on the front page and never opens a thing, which is the whole
  // point of counting the first step separately from the second.
  ['v1', 's1', 6, 'card_start', '-2 days', { fresh: true, cloud: true, owned: 0 }],
  ['v1', 's1', 7, 'card_pull', '-2 days', { kind: 'scout', paid: 'coins', gold: 1, dupes: 0 }],
  ['v1', 's1', 8, 'card_pull', '-2 days', { kind: 'elite', paid: 'pack', gold: 0, dupes: 2 }],
  ['v1', 's2', 13, 'card_match', '-1 days', { mode: 'ladder', won: true, div: 2, rating: 71 }],
  ['v1', 's2', 14, 'card_match', '-1 days', { mode: 'cup', won: false, round: 1, rating: 71 }],
  ['v1', 's2', 15, 'card_signin', '-1 days', { streak: 2 }],
  // and the hostile shapes, for the casts the card panels now do
  ['v3', 's4', 10, 'card_pull', '0 days', { kind: 'scout', paid: 'coins', gold: 'nope', dupes: 1e20 }],
]
for (const [vid, sid, n, name, ago, props] of rows) {
  await db.query(
    `insert into events (ts, n, visitor_id, session_id, seq, device, name, props)
     values (now() + $1::interval, $2, $3, $4, 1, 'phone', $5, $6)`,
    [ago, n, vid, sid, name, JSON.stringify(props)],
  )
}

// The card mode's saves, which the collection panel reads directly. The third
// is deliberately malformed in every way a hand-edited or half-written row
// could be: it must be skipped, not throw.
for (const [idh, ago, state] of [
  ['h1', '-60 days', { cards: { a: 1, b: 1, c: 1 }, pulls: 12, ladder: { div: 3 }, daily: { streak: 4 } }],
  ['h2', '-1 days', { cards: { a: 1 }, pulls: 2, ladder: { div: 0 }, daily: { streak: 1 } }],
  ['h3', '-1 days', { cards: 'nope', pulls: 'lots', ladder: 7, daily: null }],
] as [string, string, unknown][]) {
  await db.query(
    `insert into card_accounts (id_hash, created, seen, saved, state)
     values ($1, now() + $2::interval, now(), now(), $3)`,
    [idh, ago, JSON.stringify(state)],
  )
}

// A fixture may only contain events the app can actually produce. The
// 看过比赛 funnel step passed review for weeks on the strength of a
// match_watched row that no call site emitted — the test was the only thing
// keeping the column alive.
{
  const emitted = new Set(rows.map((r) => r[3]))
  // Scan the source for every whitelisted name that appears in quotes. A regex
  // over `track('x')` misses the ternary in MatchLive — track(watched ?
  // 'match_watched' : 'match_skipped') — which is exactly the shape that hid
  // the missing instrumentation in the first place.
  const { execSync } = await import('node:child_process')
  const cwd = new URL('..', import.meta.url).pathname
  const source = execSync("find src -name '*.ts' -o -name '*.tsx' | xargs cat",
    { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  const known = new Set(
    [...EVENTS].filter((e) => source.includes(`'${e}'`)),
  )
  const invented = [...emitted].filter((e) => !known.has(e as string))
  check('the fixture only contains events the game actually emits',
    invented.length === 0, invented.join(' '))
}

let out: Awaited<ReturnType<typeof overview>> | null = null
try {
  out = await overview(sql as never, 30)
  check('all eleven dashboard queries execute', true)
} catch (err) {
  check('all eleven dashboard queries execute', false, (err as Error).message)
}

if (out) {
  check('the headline counts people, not rows',
    out.headline.visitors === 3, `visitors=${out.headline.visitors}`)
  check('a returning visitor is recognised',
    out.headline.returned === 1 && out.headline.return_pct === 33,
    `returned=${out.headline.returned} pct=${out.headline.return_pct}`)
  check('playtime takes the largest figure a session reported, not its last',
    Number(out.sessions.median_min) > 0 && out.sessions.n === 3,
    `n=${out.sessions.n} median=${out.sessions.median_min}min`)
  check('a poisoned numeric prop is ignored, not fatal',
    out.sessions.n === 3, 'the active_s:"nope" row must not appear or throw')
  check('the funnel is monotonically non-increasing',
    out.funnel.arrived >= out.funnel.started &&
    out.funnel.started >= out.funnel.advanced,
    JSON.stringify(out.funnel))
  check('game depth ignores the non-numeric day',
    out.depth.max_game_day === 34, `max=${out.depth.max_game_day}`)
  check('the daily series has a row per active day', out.daily.length >= 2, `${out.daily.length} days`)
  check('cohorts come back', Array.isArray(out.retention), `${out.retention.length} cohorts`)
  check('errors surface', out.errors.length === 1, JSON.stringify(out.errors[0]?.msg))
  check('clubs are counted', out.clubs.length === 1, JSON.stringify(out.clubs))

  // ---- the panels added for the two-game front page
  check('首页去向按人算，不按点击算',
    out.home.career === 1 && out.home.cards === 2 && out.home.both === 1,
    JSON.stringify(out.home))
  check('没点进任何一个游戏的人也被算进来',
    out.home.neither === (out.home.visitors - 2), JSON.stringify(out.home))
  check('走完十年和中途下课分得开',
    out.careers.finished === 1 && out.careers.sacked === 1, JSON.stringify(out.careers))
  check('生涯长度和冠军数是平均值，不是总和',
    out.careers.avg_seasons === 8 && out.careers.avg_honours === 11,
    JSON.stringify(out.careers))
  check('解锁按人去重，同一条被两个人拿到算 2',
    out.unlocks.find((r) => r.key === 'firstTitle')?.visitors === 2,
    JSON.stringify(out.unlocks))
  check('解锁带着游戏里的名字，面板不用自己维护一份',
    out.unlocks.find((r) => r.key === 'golden')?.name === '黄金之路',
    JSON.stringify(out.unlocks.find((r) => r.key === 'golden')))
  check('账号的创建与找回分开统计',
    out.accounts.made === 1 && out.accounts.restored === 1, JSON.stringify(out.accounts))

  // ---- 域名：只有这次改动之后写下的行才带 host
  check('没有 host 的老行有自己的名字，不会消失',
    out.hosts.some((r) => r.host === '(这次改动之前)'), JSON.stringify(out.hosts))

  // ---- 五年之约
  check('五年之约的两种答复分得开',
    out.midReview.continued === 1 && out.midReview.settled === 1, JSON.stringify(out.midReview))

  // ---- 开瓦包
  const c = out.cards
  check('开瓦包漏斗每一步都包含后面的步骤',
    c.funnel.touched >= c.funnel.entered && c.funnel.entered >= c.funnel.pulled
    && c.funnel.pulled >= c.funnel.fought, JSON.stringify(c.funnel))
  check('点了首页但没进去的人算在第一步里',
    c.funnel.touched === 3 && c.funnel.entered === 2, JSON.stringify(c.funnel))
  check('隔天还开包的人被认出来', c.funnel.came_back === 1, JSON.stringify(c.funnel))
  check('卡包按种类分开算', (c.packs.find((r) => r.kind === 'scout')?.opens ?? 0) === 2,
    JSON.stringify(c.packs))
  check('金卡数不会被一个坏值毁掉',
    Number(c.packs.find((r) => r.kind === 'scout')?.gold) === 1, JSON.stringify(c.packs))
  check('用金币买的和用卡包开的分得开',
    Number(c.packs.find((r) => r.kind === 'elite')?.bought) === 0, JSON.stringify(c.packs))
  check('天梯和杯赛分开，胜负分开',
    (c.matches.find((r) => r.mode === 'ladder')?.wins ?? 0) === 1
    && (c.matches.find((r) => r.mode === 'cup')?.wins ?? 0) === 0, JSON.stringify(c.matches))
  check('收藏统计跳过坏掉的存档而不是崩掉',
    c.accounts.accounts === 2 && c.accounts.avg_owned === 2, JSON.stringify(c.accounts))
  check('最高段位和最长连签读的是存档本身',
    c.accounts.max_div === 3 && c.accounts.max_streak === 4, JSON.stringify(c.accounts))
  check('窗口外建的账号仍然计入总数，但不算新增',
    c.accounts.accounts === 2 && c.accounts.fresh === 1, JSON.stringify(c.accounts))
}

// every window the dashboard offers must work, not just the default
for (const d of [7, 30, 90, 365]) {
  try {
    await overview(sql as never, d)
    check(`the ${d}-day window runs`, true)
  } catch (err) {
    check(`the ${d}-day window runs`, false, (err as Error).message)
  }
}

try {
  await prune(sql as never, 180)
  check('pruning runs', true)
} catch (err) {
  check('pruning runs', false, (err as Error).message)
}

await db.close()
process.exit(bad ? 1 : 0)
