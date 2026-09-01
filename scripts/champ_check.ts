/** The champion must be whoever won the final, and finish first in the table. */
import { createNewGame } from '../src/engine/world'
import { WORLD_TEAMS } from '../src/engine/teams'
import { advanceDay, setupSeason, commitFixture, fixtureRng } from '../src/engine/season'
import { simulateMatch } from '../src/engine/match'

const me = WORLD_TEAMS.find((t) => t.tag === 'NOVA')!
const g = createNewGame(me.id, 'T', 11, undefined)
setupSeason(g)

// play the whole season, always taking the deferred own-match immediately
// stop before the rollover clears this season's competitions
while (g.day < 320) {
  const r = advanceDay(g, { deferMine: true })
  if (r.pendingMine) {
    const f = r.pendingMine
    commitFixture(g, f, simulateMatch(g, f.teamA, f.teamB, f.bo, fixtureRng(g, f)))
  }
}

console.log('day', g.day, 'year', g.year, 'comps', Object.keys(g.comps).length)
for (const key of Object.keys(g.comps)) {
  const c = g.comps[key]
  const ko = g.fixtures.filter((f) => f.comp === key && f.label.startsWith('KO:'))
  console.log(`  ${key.padEnd(24)} champion=${c.champion ?? '—'} koFixtures=${ko.length} played=${ko.filter(f=>f.played).length}`)
}
// trace our own club through its Stage 1 playoff
const s1 = g.comps['stage1:China']
if (s1) {
  const row = s1.standings[g.myTeam]
  console.log(`\n我方常规赛: ${row.w}胜${row.l}负  最终名次: ${s1.finished.indexOf(g.myTeam) + 1}`)
  for (const f of g.fixtures.filter((f) => f.comp === 'stage1:China' && f.label.startsWith('KO:'))) {
    if (f.teamA !== g.myTeam && f.teamB !== g.myTeam) continue
    const r = f.result!
    const won = (r.mapsWonA > r.mapsWonB) === (f.teamA === g.myTeam)
    console.log(`  ${f.label.split(':')[2]}  vs ${g.teams[f.teamA === g.myTeam ? f.teamB : f.teamA]?.name}  ` +
      `${r.mapsWonA}-${r.mapsWonB}  ${won ? '胜' : '负'}`)
  }
}

for (const key of Object.keys(g.comps)) {
  const c = g.comps[key]
  if (!c.champion) continue
  const ko = g.fixtures.filter((f) => f.comp === key && f.label.startsWith('KO:'))
  if (!ko.length) continue
  const lastRound = Math.max(...ko.map((f) => Number(f.label.split(':')[1] || 0)))
  const final = ko.filter((f) => Number(f.label.split(':')[1] || 0) === lastRound)
  if (final.length !== 1) { console.log(`${key}: 最后一轮有 ${final.length} 场，异常`); continue }
  const f = final[0]
  const winner = f.result!.mapsWonA > f.result!.mapsWonB ? f.teamA : f.teamB
  const ok = winner === c.champion
  const firstListed = c.finished[0]
  console.log(
    `${c.name.padEnd(26)} 决赛胜者=${g.teams[winner]?.name.padEnd(20)} ` +
    `记录冠军=${g.teams[c.champion]?.name.padEnd(20)} 榜首=${g.teams[firstListed ?? '']?.name ?? '-'} ` +
    `${ok ? '✅' : '❌ 不一致'}`)
}
