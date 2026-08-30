/**
 * Reproduce the "经理声望82却只有5个赞助席位" report: slots gate on CLUB
 * reputation, but the refusal copy just said "声望", so a manager whose own
 * reputation cleared 65/70/80 read it as a bug. Verify the gate, then verify
 * the message now names the club and its current number.
 */
import { createNewGame, WORLD_TEAMS } from '../src/engine/world'
import { createManager } from '../src/engine/manager'
import { pitchSponsor, sponsorSlots, SPONSOR_MAX } from '../src/engine/commercial'

const me = WORLD_TEAMS.find((t) => t.tag === 'EDG')!
const m = createManager('测试', 40, 'expro')
const g = createNewGame(me.id, m.name, 7, m)
const team = g.teams[g.myTeam]!

// the reported situation: famous manager, mid club
g.manager.reputation = 82
team.reputation = 58

const slots = sponsorSlots(team)
console.log(`经理声望 ${g.manager.reputation}，俱乐部声望 ${team.reputation} → 席位 ${slots}`)
if (slots !== SPONSOR_MAX) throw new Error(`俱乐部声望 58 应为 ${SPONSOR_MAX} 席，实得 ${slots}`)

// fill every slot so the pitch refuses, then read the refusal copy
while (team.sponsors.length < slots) {
  team.sponsors.push({ name: `占位${team.sponsors.length}`, perSeason: 100000, seasonsLeft: 2 } as never)
}
const msg = pitchSponsor(g)
console.log('拒绝提示:', msg)
if (!msg.includes('俱乐部声望')) throw new Error('提示语必须写明是「俱乐部声望」解锁栏位')
if (!msg.includes('58')) throw new Error('提示语必须带上当前俱乐部声望，玩家才知道差多少')

// and the gate itself still climbs with the club, not the manager
team.reputation = 82
console.log(`俱乐部声望 82 → 席位 ${sponsorSlots(team)}`)
if (sponsorSlots(team) !== SPONSOR_MAX + 3) throw new Error('俱乐部声望 82 应为 8 席')

console.log('✅ 席位随俱乐部声望走，提示语已写明是哪个声望、现在多少')
