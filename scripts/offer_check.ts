/** A starting place must never be the reason a player refuses. */
import { createNewGame } from '../src/engine/world'
import { WORLD_TEAMS } from '../src/engine/teams'
import { setupSeason } from '../src/engine/season'
import { playerAcceptsTerms, deservedRole } from '../src/engine/transfer'
import { expectedSalary } from '../src/engine/player'
import { defaultContract, SQUAD_ROLE_CN } from '../src/engine/types'
import type { SquadRole } from '../src/engine/types'
import { Rng } from '../src/engine/rng'

const me = WORLD_TEAMS.find((t) => t.tag === 'KBG')!  // a weak club, worst case
const g = createNewGame(me.id, 'T', 3); setupSeason(g)
const club = g.teams[g.myTeam]

const targets = Object.values(g.players)
  .filter((p) => p.teamId && p.teamId !== g.myTeam)
  .sort((a, b) => b.overall - a.overall).slice(0, 6)

let roleBlamed = 0, starterBlamed = 0
for (const p of targets) {
  const want = expectedSalary(p, club.tier)
  const dv = deservedRole(g, p, club)
  const line: string[] = []
  for (const role of ['star', 'starter', 'rotation', 'bench'] as SquadRole[]) {
    let refusedForRole = 0
    for (let i = 0; i < 200; i++) {
      // generous terms, so role is the only thing that can be at fault
      const terms = { ...defaultContract(Math.round(want * 1.6), 2), promisedRole: role, signingBonus: want }
      const v = playerAcceptsTerms(g, p, club, terms, new Rng(1000 + i))
      if (!v.ok && v.reason?.includes('定位')) refusedForRole++
    }
    if (refusedForRole) { roleBlamed++; if (role === 'starter' || role === 'star') starterBlamed++ }
    line.push(`${SQUAD_ROLE_CN[role]}:${String(refusedForRole).padStart(3)}`)
  }
  console.log(`${p.ign.padEnd(11)} OVR${p.overall} 自认${SQUAD_ROLE_CN[dv].padEnd(2)}  因定位被拒 ${line.join('  ')}`)
}
console.log(`\n因「核心/首发」定位被拒的情况: ${starterBlamed} ${starterBlamed === 0 ? '✅ 不存在' : '❌ 仍然存在'}`)
