/**
 * 全队收藏 counts a man on any of his cards. (2026-09-06)
 *
 *   npx tsx scripts/check_club_sets.ts
 *
 * 「彩卡选手在收藏里没计入全队收藏，比如我有彩卡 ZmjjKK 但是没有金卡 ZmjjKK，
 * EDG 别的选手都有了，但是还是说我缺 ZmjjKK」.
 */
import { clubSets } from '../src/engine/clubSets'
import { ALL_CARDS, isPlayerCard } from '../src/engine/cards'
import type { PlayerCard } from '../src/engine/cards'

const edg = ALL_CARDS.filter((c): c is PlayerCard => isPlayerCard(c) && c.clubTag === 'EDG' && c.rarity !== 'mythic')
const zm = edg.find((c) => c.ign === 'ZmjjKK')!
const legend = ALL_CARDS.find((c): c is PlayerCard => isPlayerCard(c) && c.rarity === 'mythic' && c.playerId === zm.playerId)!
console.log('EDG 普通卡:', edg.map((c) => c.ign).join('、'), '| 彩卡:', legend.id, legend.legend?.title)

const own = (ids: string[]) => ({ cards: Object.fromEntries(ids.map((id) => [id, { id, level: 0, dupes: 0, seen: 1 }])) }) as never
const rest = edg.filter((c) => c.ign !== 'ZmjjKK').map((c) => c.id)
const without = clubSets(own(rest)).find((x) => x.tag === 'EDG')!
const withLegend = clubSets(own([...rest, legend.id])).find((x) => x.tag === 'EDG')!
const withBoth = clubSets(own([...edg.map((c) => c.id), legend.id])).find((x) => x.tag === 'EDG')!
console.log('没有 ZmjjKK      :', `${without.owned}/${without.total}`, without.done ? '集齐' : `缺 ${without.missing.join('、')}`)
console.log('只有彩卡 ZmjjKK  :', `${withLegend.owned}/${withLegend.total}`, withLegend.done ? '集齐' : `缺 ${withLegend.missing.join('、')}`)
console.log('金卡彩卡都有     :', `${withBoth.owned}/${withBoth.total}`, withBoth.done ? '集齐' : '未集齐')

let fails = 0
const check = (label: string, ok: boolean) => { console.log(`${ok ? '✅' : '❌'} ${label}`); if (!ok) fails++ }
check('少一个人就不算集齐', !without.done && without.missing.includes('ZmjjKK'))
check('只有他的彩卡也算有了他', withLegend.done && withLegend.owned === withLegend.total)
check('彩卡不算第二张', withBoth.owned === withBoth.total)
process.exit(fails ? 1 : 0)
