/**
 * What shapes do manager-mode sides actually take onto maps, against pro play?
 *
 *   npx tsx scripts/measure_comp_shapes.ts [seasons=2] [startYear=2026]
 *
 * Plays careers and, at every day with fixtures, reads each side's sheet for
 * each pool map (the one sheetFor would use). Prints the share of role shapes
 * (决斗/先锋/控场/哨卫 counts) and how many sheets stack 3+ of one role or
 * carry an agent not yet released on that date. A measurement, not a check.
 */
import { createNewGame } from '../src/engine/world'
import { WORLD_TEAMS } from '../src/engine/teams'
import { advanceDay, setupSeason } from '../src/engine/season'
import { sheetFor, poolFor } from '../src/engine/match'
import { AGENT_ROLE } from '../src/engine/content'
import { agentAvailable } from '../src/engine/eras'
import { createManager } from '../src/engine/manager'
import { loadWorld } from '../src/engine/eras'
import { setCurrentRuleset } from '../src/engine/ruleset'

const seasons = Number(process.argv[2] ?? 2)
const startYear = Number(process.argv[3] ?? 2026)
setCurrentRuleset('vct-2026')
const shapes = new Map<string, number>()
let sheets = 0, stacked = 0, unreleased = 0
const examples: string[] = []
const letters: Record<string, string> = { 决斗者: 'D', 先锋: 'I', 控场: 'C', 哨卫: 'S' }
for (const seed of [11, 22]) {
  const world = startYear === 2026 ? undefined : (await loadWorld(startYear))!
  const teams = world?.teams ?? WORLD_TEAMS
  const g = createNewGame(teams.find((t) => t.tier === 1)!.id, '测量', seed, createManager('测量', 30, 'expro'),
    startYear === 2026 ? {} : { world, year: startYear })
  setupSeason(g)
  const until = g.year + seasons
  let guard = 0
  while (g.year < until && guard++ < 2000) {
    g.boardConfidence = 100
    if (g.day % 7 === 0) {
      const pool = poolFor(g)
      for (const t of Object.values(g.teams)) {
        if (t.tier !== 1) continue
        for (const map of pool) {
          const { agents } = sheetFor(g, t.id, map)
          const list = Object.values(agents)
          if (list.length !== 5) continue
          sheets++
          const c: Record<string, number> = { D: 0, I: 0, C: 0, S: 0 }
          for (const a of list) c[letters[AGENT_ROLE[a]] ?? 'D']++
          const key = `${c.D}D${c.I}I${c.C}C${c.S}S`
          shapes.set(key, (shapes.get(key) ?? 0) + 1)
          if (Math.max(...Object.values(c)) >= 3) {
            stacked++
            if (examples.length < 6) examples.push(`${g.year}-d${g.day} ${t.tag} ${map}: ${list.join('/')}`)
          }
          if (list.some((a) => !agentAvailable(g, a))) unreleased++
        }
      }
    }
    advanceDay(g, { autoResolveDrawDecisions: true })
    if (g.gameOver) break
  }
}
const top = [...shapes.entries()].sort((a, b) => b[1] - a[1])
console.log(`${sheets} sheets · 3+ of one role ${stacked} (${(stacked / sheets * 100).toFixed(1)}%) · unreleased agents ${unreleased}`)
console.log(top.slice(0, 10).map(([k, v]) => `${k} ${(v / sheets * 100).toFixed(1)}%`).join('  '))
for (const e of examples) console.log('  ' + e)
