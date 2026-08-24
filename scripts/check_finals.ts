/**
 * Finals are BO5; everything else in a bracket stays BO3.
 *
 * And the market speaks: every move between AI clubs lands in the news feed,
 * so a target who joined a rival is old news by the time you go looking. Both
 * were silent before — a title decided in forty minutes, a shopping list gone
 * stale without a word.
 */
import { createNewGame, WORLD_TEAMS } from '../src/engine/world'
import { advanceDay, setupSeason } from '../src/engine/season'
import { Rng } from '../src/engine/rng'

const me = WORLD_TEAMS.find(t => t.tag === 'TYL')!
const g = createNewGame(me.id, '审计经理', 20260824)
setupSeason(g)
const rng = new Rng(31)
let guard = 0
// count market news right after the preseason window shuts — the feed holds
// 400 entries and a season writes more, so by the offseason these are gone
let windowMoves = -1
while (!g.gameOver && guard++ < 400 && g.stage !== 'offseason') {
  advanceDay(g, rng)
  if (g.day >= 25 && windowMoves < 0) {
    windowMoves = g.news.filter(n => n.kind === 'transfer').length
  }
}

let bad = 0
const finals = g.fixtures.filter(f => f.label.endsWith(':决赛'))
const semis = g.fixtures.filter(f => f.label.endsWith(':半决赛'))
console.log(`决赛 ${finals.length} 场 · 半决赛 ${semis.length} 场\n`)
for (const f of finals) {
  const ok = f.bo === 5
  if (!ok) bad++
  const r = f.result ? ` ${f.result.mapsWonA}:${f.result.mapsWonB}` : ''
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${(g.comps[f.comp]?.name ?? f.comp).padEnd(22)} BO${f.bo}${r}`)
}
const wrongSemi = semis.filter(f => f.bo !== 3)
if (wrongSemi.length) { bad++; console.log(`FAIL 半决赛出现非 BO3: ${wrongSemi.length} 场`) }
else console.log(`ok   半决赛全部 BO3`)
const long = finals.filter(f => f.result && f.result.maps.length > 3)
console.log(`打满 4+ 图的决赛：${long.length} 场（证明 BO5 真在打，不是标签）`)
if (finals.length && !long.length) console.log('     （本季恰好全是横扫，换个种子会出现长局）')

console.log(`\n季前窗口关闭时的转会新闻：${windowMoves} 条`)
const moves = g.news.filter(n => n.kind === 'transfer')
for (const n of moves.slice(-4)) console.log('  ', n.text)
if (windowMoves < 3) { bad++; console.log('FAIL 窗口期几乎没有转会新闻') }
process.exit(bad ? 1 : 0)
