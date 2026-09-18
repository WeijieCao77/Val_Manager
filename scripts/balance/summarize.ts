/**
 * The confirmation, as tables.
 *
 *   npx tsx scripts/balance/summarize.ts <dir with confirm_*.json> [out.md]
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'

const DIR = process.argv[2] ?? 'analysis/balance_v2/raw'
const OUT = process.argv[3]
interface Rec {
  section: string; name: string; bo: number; rule: number; pairs: number; n: number; wins: number
  rate: number; lo: number; hi: number; gapMean: number; chemGap: number; meanGap: number; seatA: number; mapsPerSeries: number
}
const recs: Rec[] = readdirSync(DIR).filter((f) => /^confirm_\d+\.json$/.test(f))
  .flatMap((f) => JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8')) as Rec[])
const RULE: Record<number, string> = { 1: '现行 v1', 801: '旧推荐', 2: '新 v2' }
const TARGET: Record<string, number> = { '+0': 0.5, '+2': 0.545, '+3': 0.58, '+5': 0.71, '+10': 0.93 }
const p = (x: number) => `${(x * 100).toFixed(1)}%`
const find = (section: string, name: string, bo: number, rule: number) =>
  recs.find((r) => r.section === section && r.name === name && r.bo === bo && r.rule === rule)
const names = (section: string, bo: number) => [...new Set(recs.filter((r) => r.section === section && r.bo === bo).map((r) => r.name))]
  .sort((a, b) => (parseFloat(a.slice(1)) || 0) - (parseFloat(b.slice(1)) || 0))
const lines: string[] = []
const say = (s = '') => { lines.push(s) }

const curve = (title: string, sections: string[], bo: number, withTarget: boolean) => {
  say(`### ${title}`); say()
  say(`| 领先 | 场数 | 现行 v1 | 旧推荐 | 新 v2 | v2 95% 区间 |${withTarget ? ' 目标 | 偏差 |' : ''}`)
  say(`|---:|---:|---:|---:|---:|---:|${withTarget ? '---:|---:|' : ''}`)
  const all = sections.flatMap((s) => names(s, bo).map((n) => [s, n] as const))
    .sort((a, b) => parseFloat(a[1].slice(1)) - parseFloat(b[1].slice(1)))
  for (const [s, n] of all) {
    const v2 = find(s, n, bo, 2); if (!v2) continue
    const v1 = find(s, n, bo, 1), old = find(s, n, bo, 801)
    const t = TARGET[n]
    say(`| ${n} | ${v2.n} | ${v1 ? p(v1.rate) : '—'} | ${old ? p(old.rate) : '—'} | **${p(v2.rate)}** | ${p(v2.lo)}–${p(v2.hi)} |`
      + (withTarget ? ` ${t ? p(t) : ''} | ${t ? `${((v2.rate - t) * 100).toFixed(1)}pp` : ''} |` : ''))
  }
  say()
}
curve('BO5（天梯、全服杯 playoff）', ['bo5-key', 'bo5-rest'], 5, true)
curve('BO3（全服杯瑞士轮、俱乐部杯、好友房）——同一条曲线，单独测量', ['bo3'], 3, false)

say('### 边界两侧（BO5，v2）'); say()
say('| 领先 | 场数 | 胜率 | 95% 区间 |'); say('|---:|---:|---:|---:|')
for (const n of names('edges', 5)) { const r = find('edges', n, 5, 2)!; say(`| ${n} | ${r.n} | ${p(r.rate)} | ${p(r.lo)}–${p(r.hi)} |`) }
say()

say('### 定向案例'); say()
say('| 场景 | 实际分差 | 赛制 | 场数 | 现行 v1 | 旧推荐 | 新 v2 | v2 区间 | 先手座位胜率 |'); say('|---|---:|---|---:|---:|---:|---:|---:|---:|')
for (const bo of [3, 5]) for (const n of [...new Set(recs.filter((r) => r.section === 'cases').map((r) => r.name))]) {
  const v2 = find('cases', n, bo, 2); if (!v2) continue
  const v1 = find('cases', n, bo, 1), old = find('cases', n, bo, 801)
  say(`| ${n} | ${v2.gapMean.toFixed(2)} | BO${bo} | ${v2.n} | ${v1 ? p(v1.rate) : '—'} | ${old ? p(old.rate) : '—'} | **${p(v2.rate)}** | ${p(v2.lo)}–${p(v2.hi)} | ${p(v2.seatA)} |`)
}
say()

for (const [section, title] of [
  ['chem-ability-alike', '默契专项一：基础能力相近（均分差 ≤ 0.3），整编队默契领先 ≥ 20'],
  ['chem-score-alike', '默契专项二：最终综合分相近（≤ 0.15），混搭卡更好、默契更差'],
] as const) {
  say(`### ${title}`); say()
  say('胜率是整编队一方的。无教练、全 +0、无错位、双方都有指挥。'); say()
  say('| 对阵 | 赛制 | 组合数 | 场数 | 均分差 | 默契差 | 综合分差 | 现行 v1 | 新 v2 | v2 区间 |'); say('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|')
  for (const n of [...new Set(recs.filter((r) => r.section === section).map((r) => r.name))]) for (const bo of [3, 5]) {
    const v2 = find(section, n, bo, 2); if (!v2) continue
    const v1 = find(section, n, bo, 1)
    say(`| ${n} | BO${bo} | ${v2.pairs} | ${v2.n} | ${v2.meanGap.toFixed(2)} | ${v2.chemGap.toFixed(0)} | ${v2.gapMean.toFixed(2)} | ${v1 ? p(v1.rate) : '—'} | **${p(v2.rate)}** | ${p(v2.lo)}–${p(v2.hi)} |`)
  }
  say()
}
const total = recs.reduce((s, r) => s + r.n, 0)
say(`共 ${recs.length} 组、${total.toLocaleString()} 场系列赛。规则：${Object.entries(RULE).map(([k, v]) => `${k}=${v}`).join('，')}。`)
const text = lines.join('\n')
console.log(text)
if (OUT) writeFileSync(OUT, text + '\n')
