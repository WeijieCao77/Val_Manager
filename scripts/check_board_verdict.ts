/**
 * The board never says two things about one stage. (2026-09-06)
 *
 *   npx tsx scripts/check_board_verdict.ts [seasons]
 *
 * 「达到了董事会目标也会提示不满意扣信任」: the stage brief was judged at
 * the stage's end and the same competition was judged again, by raw table
 * share, the day it finished. A weak side manages a season here — the one
 * that gets low briefs and low finishes — and every board line is printed;
 * a「目标达成」and a「不满」about the same league in one season is the bug.
 */
import { createNewGame } from '../src/engine/world'
import { WORLD_TEAMS } from '../src/engine/teams'
import { createManager } from '../src/engine/manager'
import { advanceDay, setupSeason, SEASON_DAYS } from '../src/engine/season'

const SEASONS = Number(process.argv[2] ?? 2)
// the weakest VCT club by default: low briefs, bottom-third finishes, the case
// that broke; pass a tag (EDG) to see the international verdicts instead
const weakest = WORLD_TEAMS.filter((t) => t.tier === 1).sort((a, b) => a.rating - b.rating)[0]
const club = WORLD_TEAMS.find((t) => t.tag === process.argv[3]) ?? weakest
const g = createNewGame(club.id, 'x', 11, createManager('t', 30, 'grassroots'))
setupSeason(g)
console.log(`managing ${g.teams[g.myTeam].name} (rating ${g.teams[g.myTeam].rating})`)

let fails = 0
for (let s = 0; s < SEASONS; s++) {
  const year = g.year
  const lines: { day: number; text: string }[] = []
  while (g.year === year) {
    const r = advanceDay(g)
    for (const n of r.notes) if (/董事会|赛段目标/.test(n)) lines.push({ day: g.day, text: n })
    if (g.gameOver) break
    if (g.day > SEASON_DAYS + 5) throw new Error('season did not roll over')
  }
  console.log(`\n=== ${year} ===`)
  for (const l of lines) console.log(`  第${String(l.day).padStart(3)}天 ${l.text}`)
  // the regional league is named in the brief's verdict and in the finish line;
  // one league, one season, one verdict
  const met = lines.filter((l) => l.text.includes('赛段目标达成'))
  const unhappy = lines.filter((l) => l.text.includes('董事会不满'))
  for (const u of unhappy) {
    const league = u.text.match(/^📉 (.+?) 第 \d+ 名/)?.[1] ?? ''
    if (!league) continue
    const sameDayMet = met.some((m) => Math.abs(m.day - u.day) <= 1)
    if (sameDayMet) { console.log(`  ❌ 同一赛段既「达成」又「不满」：${u.text}`); fails++ }
  }
  const generic = lines.filter((l) => /^📉 .+，董事会不满（信任 -7）。$/.test(l.text))
  if (generic.length) { console.log(`  ❌ 旧的笼统「不满」还在：${generic[0].text}`); fails++ }
  if (g.gameOver) { console.log(`  （${g.gameOver}）`); break }
}
console.log(fails ? `\n${fails} 处矛盾` : '\n没有矛盾')
process.exit(fails ? 1 : 0)
