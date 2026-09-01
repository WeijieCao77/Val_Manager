/** The window must open onto a real market, and rivals must come for our players. */
import { createNewGame } from '../src/engine/world'
import { squadOf } from '../src/engine/roster'
import { WORLD_TEAMS } from '../src/engine/teams'
import { advanceDay, setupSeason } from '../src/engine/season'
import { incomingOffers } from '../src/engine/transfer'

const me = WORLD_TEAMS.find((t) => t.tag === 'EDG')!
const g = createNewGame(me.id, 'T', 21)
setupSeason(g)

const listedAt = (d: number) => Object.values(g.players).filter((p) => p.teamId && p.listed).length
console.log(`day 0 挂牌: ${listedAt(0)}`)

let bidsSeen = 0, forced = 0
while (g.day < 330) {
  const before = incomingOffers(g).length
  advanceDay(g)
  const now = incomingOffers(g)
  if (now.length > before) bidsSeen += now.length - before
  forced += g.news.filter((n) => n.text.includes('解约金')).length && 0
  if (g.day === 20) console.log(`day 20 挂牌: ${listedAt(20)}  (季前窗口结束)`)
  if (g.day === 194) console.log(`day 194 挂牌: ${listedAt(194)}`)
}
const clauseNews = g.news.filter((n) => n.text.includes('解约金')).length
const bidNews = g.news.filter((n) => n.text.includes('求购')).length
console.log(`\n本赛季收到求购报价 ${bidNews} 次，被解约金强制带走 ${clauseNews} 次`)
console.log(`当前待答复: ${incomingOffers(g).length}`)
console.log(`我方阵容: ${squadOf(g, g.myTeam).length} 人`)
void forced; void bidsSeen
