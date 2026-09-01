/** Proactive commercial must be a gamble, not free money. */
import { createNewGame } from '../src/engine/world'
import { squadOf } from '../src/engine/roster'
import { WORLD_TEAMS } from '../src/engine/teams'
import { createManager } from '../src/engine/manager'
import { advanceDay, setupSeason } from '../src/engine/season'
import { pitchSponsor, signStream, startVenture, streamOffer, ventureInfo } from '../src/engine/commercial'
import type { VentureKind } from '../src/engine/types'

// club events: is the payout actually uncertain?
for (const k of ['openday', 'bootcamp', 'watchparty', 'merch'] as VentureKind[]) {
  const v = ventureInfo(k)
  let net = 0, wins = 0, n = 0
  for (let seed = 0; seed < 24; seed++) {
    const g = createNewGame(WORLD_TEAMS[6].id, 'x', seed, createManager('t', 24, 'grassroots'))
    setupSeason(g)
    const who = squadOf(g, g.myTeam).slice(0, Math.min(v.heads, 5)).map((p) => p.id)
    if (!startVenture(g, k, who).includes('筹备')) continue
    for (let d = 0; d < 20; d++) advanceDay(g, {})
    // only this venture's own lines, not three weeks of sponsorship and wages
    const take = g.finances.log
      .filter((l) => l.label.includes('收入') && !l.label.includes('赞助'))
      .reduce((s, l) => s + l.amount, 0)
    const delta = take - v.cost
    net += delta; wins += delta > 0 ? 1 : 0; n++
  }
  console.log(`${v.label.padEnd(12)} 垫付 ${String(Math.round(v.cost / 1000)).padStart(3)}K  ` +
    `平均净收益 ${(net / Math.max(1, n) / 1000).toFixed(0).padStart(5)}K  盈利率 ${wins}/${n}`)
}

// sponsor pitching: does it ever fail?
let ok = 0
for (let seed = 0; seed < 30; seed++) {
  const g = createNewGame(WORLD_TEAMS[6].id, 'x', seed, createManager('t', 24, 'grassroots'))
  setupSeason(g)
  if (pitchSponsor(g).startsWith('谈成了')) ok++
}
console.log(`\n拜访赞助商 30 次，谈成 ${ok} 次`)

// streaming: money in, condition out
const g = createNewGame(WORLD_TEAMS[6].id, 'x', 3, createManager('t', 24, 'grassroots'))
setupSeason(g)
const star = squadOf(g, g.myTeam).sort((a, b) => b.overall - a.overall)[0]
const offer = streamOffer(g, star.id)
console.log(`\n${star.ign}（OVR${star.overall}）收到 ${offer?.platform} 报价 ` +
  `${Math.round((offer?.fee ?? 0) / 1000)}K/年，每周 ${offer?.nights} 晚`)
// rest everyone so the streaming cost is not buried under training fatigue
for (const p of squadOf(g, g.myTeam)) { p.fatigue = 20; g.training[p.id] = 'rest' }
signStream(g, star.id)
const cash0 = g.finances.balance
for (let d = 0; d < 56; d++) advanceDay(g, {})
const after = g.players[star.id]
const peer = squadOf(g, g.myTeam).find((p) => !p.stream)!
console.log(`8 周后：直播收入合计 ${Math.round(g.finances.log.filter((l) => l.label.includes('直播')).reduce((s, l) => s + l.amount, 0) / 1000)}K`)
console.log(`  ${after.ign} 体能 ${Math.round(100 - after.fatigue)}  vs  未签约的 ${peer.ign} 体能 ${Math.round(100 - peer.fatigue)}`)
