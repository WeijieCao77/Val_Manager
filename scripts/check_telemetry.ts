/**
 * How many rows a sitting actually costs.
 *
 *   npx tsx scripts/check_telemetry.ts
 *
 * Measured on a week of live traffic: 341 rows per visitor, of which `screen`
 * was 52% and the two turn events another 23% — three quarters of the table
 * spent on events nothing ever reads one at a time. At 2400 visitors a day the
 * four-million row ceiling held about five days of history.
 *
 * They are counters now, reported as running totals. This drives the real
 * module through a fake browser and counts what leaves, because the saving is
 * the entire point of the change and an unmeasured saving is a hope.
 *
 * The properties that have to hold:
 *
 *   - a screen visited a hundred times costs one row, not a hundred
 *   - a re-report carries only what moved since the last one
 *   - a running total is never re-sent unchanged, and when it is re-delivered
 *     anyway the dashboard reads it as a max (see check_stats_sql.ts)
 *   - a new sitting starts its counters at zero
 */
interface Sent { name: string; props?: Record<string, unknown> }

const sent: Sent[] = []
let visible = 'visible'
const listeners: Record<string, (() => void)[]> = {}

const store = new Map<string, string>()
const g = globalThis as unknown as Record<string, unknown>
g.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
  key: () => null, clear: () => store.clear(), get length() { return store.size },
}
g.location = { protocol: 'https:', hostname: 'vctgames.com' }
// Node defines navigator as a getter-only global, so it has to be replaced
// rather than assigned. Deliberately WITHOUT sendBeacon: the real send() takes
// the beacon path whenever the method exists and ignores what it returns, so
// leaving it out is the only way every batch comes down the fetch path where
// this file can read it.
Object.defineProperty(globalThis, 'navigator', {
  value: {}, configurable: true, writable: true,
})
g.document = {
  get visibilityState() { return visible },
  referrer: '',
  addEventListener: (ev: string, fn: () => void) => { (listeners[ev] ??= []).push(fn) },
}
g.window = {
  innerWidth: 390, innerHeight: 844,
  addEventListener: (ev: string, fn: () => void) => { (listeners[ev] ??= []).push(fn) },
  setTimeout: (fn: () => void) => setTimeout(fn, 0),
}
// every batch is captured here rather than posted
g.fetch = async (_url: string, opts: { body: string }) => {
  const body = JSON.parse(opts.body) as { events: Sent[] }
  sent.push(...body.events)
  return { ok: true, json: async () => ({}) }
}
const { startTelemetry, track, countScreen, countTurn, countTurnDone, _stopTelemetry, _rollupState } =
  await import('../src/engine/telemetry')

let bad = 0
const check = (ok: boolean, what: string, detail = '') => {
  if (!ok) { bad++; console.log(`FAIL ${what}${detail ? `  ${detail}` : ''}`) }
}
const settle = () => new Promise((r) => setTimeout(r, 30))
const fire = (ev: string) => { for (const fn of listeners[ev] ?? []) fn() }

// ---- one sitting, played the way people play -------------------------
startTelemetry()
const SCREENS = ['dashboard', 'squad', 'transfers', 'training', 'tactics', 'finances']
const TURNS = 60
let clicks = 0
for (let i = 0; i < 180; i++) { countScreen(SCREENS[i % SCREENS.length]); clicks++ }
for (let i = 0; i < TURNS; i++) {
  countTurn(i * 3, 2026 + Math.floor(i / 100), i % 4 === 0)
  countTurnDone(120 + (i % 30) * 10, i % 3 === 0)
}
track('career_start', { club: 'EDG', tier: 'VCT', region: 'China' })

// leaving the tab is where a phone reports
visible = 'hidden'
fire('visibilitychange')
await settle()

const rollupRows = sent.filter((e) => e.name === 'screens' || e.name === 'turns').length
const oldWay = clicks + TURNS * 2
console.log(`一次 ${clicks} 次切页 + ${TURNS} 回合的游戏：`)
console.log(`  旧格式 ${oldWay} 行 → 新格式 ${rollupRows} 行`
  + `（省 ${Math.round((1 - rollupRows / oldWay) * 100)}%）`)
check(sent.filter((e) => e.name === 'screens').length === SCREENS.length,
  '每个页面一行，不是每次点击一行',
  String(sent.filter((e) => e.name === 'screens').length))
check(sent.filter((e) => e.name === 'turns').length === 1, '整局回合数一行')
check(rollupRows < oldWay / 10, '整体降一个数量级', `${rollupRows} vs ${oldWay}`)

const squad = sent.find((e) => e.name === 'screens' && e.props?.to === 'squad')
check(squad?.hits === undefined && squad?.props?.hits === 30, '次数是累计值', JSON.stringify(squad?.props))
const turns = sent.find((e) => e.name === 'turns')
check(turns?.props?.turns === TURNS, '回合总数对', JSON.stringify(turns?.props))
check(turns?.props?.day === (TURNS - 1) * 3, '最深的一天是最大值，不是最后一个',
  JSON.stringify(turns?.props?.day))
check(turns?.props?.sim_ms === 410, '模拟耗时留的是最慢的那次', String(turns?.props?.sim_ms))
check((turns?.props?.fast as number) === 15 && (turns?.props?.quiet as number) === 20,
  '快进和平静的回合分开数', JSON.stringify(turns?.props))

// ---- reporting again only carries what moved -------------------------
const before = sent.length
visible = 'visible'; fire('visibilitychange')
visible = 'hidden'; fire('visibilitychange')
await settle()
check(sent.length === before, '什么都没变时，再上报一次不产生任何行',
  `多了 ${sent.length - before} 行`)

countScreen('squad')
visible = 'visible'; fire('visibilitychange')
visible = 'hidden'; fire('visibilitychange')
await settle()
const added = sent.slice(before)
check(added.length === 1 && added[0].props?.to === 'squad',
  '只有动过的那个页面会再上报', JSON.stringify(added.map((e) => e.props)))
check(added[0].props?.hits === 31, '再上报的是新的累计值', JSON.stringify(added[0].props))

// ---- the counters belong to the sitting ------------------------------
const st = _rollupState()
check(st.turnCount === TURNS && st.screenHits.squad === 31, '计数器和上报的是同一份',
  JSON.stringify({ turns: st.turnCount, squad: st.screenHits.squad }))

_stopTelemetry()

// ---- what it means at scale ------------------------------------------
// 341 rows a visitor, screen 52% and the turn pair 23%. The rollup replaces
// those three with (screens visited + 1) rows.
const OLD_PER_VISITOR = 341
const saved = OLD_PER_VISITOR * 0.75 - (SCREENS.length + 1)
const now = OLD_PER_VISITOR - saved
for (const daily of [800, 2400]) {
  const days = 4_000_000 / (daily * now)
  console.log(`  ${daily} 日活：一人 ${Math.round(now)} 行，400 万行能存 ${days.toFixed(0)} 天`
    + `（原来 ${(4_000_000 / (daily * OLD_PER_VISITOR)).toFixed(0)} 天）`)
}

console.log(bad ? `\n${bad} 项不通过` : '\n全部通过')
process.exit(bad ? 1 : 0)
