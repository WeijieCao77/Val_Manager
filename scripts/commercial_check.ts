/** Commercial work must pay real money and cost real training. */
import { createNewGame, WORLD_TEAMS, squadOf } from '../src/engine/world'
import { createManager } from '../src/engine/manager'
import { advanceDay, setupSeason } from '../src/engine/season'
import { bookGig, openGigs } from '../src/engine/commercial'

function run(label: string, takeEverything: boolean) {
  const g = createNewGame(WORLD_TEAMS[0].id, 'x', 4, createManager('t', 24, 'grassroots'))
  setupSeason(g)
  const squad = squadOf(g, g.myTeam)
  for (const p of squad) g.training[p.id] = 'aim'
  g.drill = { kind: 'review' }
  const before = { cash: g.finances.balance, aim: squad.reduce((s, p) => s + p.attrs.aim, 0) }

  let booked = 0
  for (let d = 0; d < 84; d++) {
    if (takeEverything) {
      for (const gig of openGigs(g)) {
        if (gig.accepted) continue
        const who = squadOf(g, g.myTeam).slice(0, gig.heads).map((p) => p.id)
        if (bookGig(g, gig.id, who).startsWith('已确认')) booked++
      }
    }
    advanceDay(g, {})
  }
  const now = squadOf(g, g.myTeam)
  console.log(
    `${label.padEnd(10)} 接了 ${String(booked).padStart(2)} 场  ` +
    `资金 ${(before.cash / 1e6).toFixed(2)}M→${(g.finances.balance / 1e6).toFixed(2)}M  ` +
    `枪法合计 ${before.aim}→${now.reduce((s, p) => s + p.attrs.aim, 0)}  ` +
    `平均体能 ${Math.round(100 - now.reduce((s, p) => s + p.fatigue, 0) / now.length)}`,
  )
}

run('全不接', false)
run('来者不拒', true)

// isolate the training cost: identical squads, one of them pulled away for gigs
import { weeklyTick } from '../src/engine/training'
import { Rng } from '../src/engine/rng'

function xpAfterOneWeek(daysOnCommercial: number): number {
  const g = createNewGame(WORLD_TEAMS[0].id, 'x', 4, createManager('t', 24, 'grassroots'))
  setupSeason(g)
  const squad = squadOf(g, g.myTeam)
  for (const p of squad) { g.training[p.id] = 'aim'; p.fatigue = 20 }
  if (daysOnCommercial) {
    g.commercialDays = Object.fromEntries(squad.map((p) => [p.id, daysOnCommercial]))
  }
  weeklyTick(g, new Rng(99))
  return Math.round(squadOf(g, g.myTeam).reduce((s, p) => s + (p.xp.aim ?? 0), 0))
}

console.log('\n一周训练收益（枪法 xp 合计，体能统一 20）：')
for (const d of [0, 1, 2, 3, 4]) {
  const xp = xpAfterOneWeek(d)
  console.log(`  商务占用 ${d} 天 → ${String(xp).padStart(3)} xp`)
}
