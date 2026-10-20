/**
 * 退役教练 (owner, 2026-10-20): 70 retired coaches as cards, carried by rank onto
 * the live coaches' ruler, dealt only by the 退役教练包.
 */
import { COACH_CARDS, RETIRED_COACH_CARDS, cardById, coachRating, isCoachCard } from '../src/engine/cards'
import { FREE_COINS, FULL_SET_CARDS, PACKS, PACK_ORDER, migrateGacha, newGacha, openPack } from '../src/engine/gacha'
import { matchesFilter, EMPTY_FILTER } from '../src/engine/cardFilter'

let bad = 0
const ok = (what: string, cond: boolean, detail = '') => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}${cond ? '' : `  ${detail}`}`); if (!cond) bad++ }

const live = COACH_CARDS.filter((c) => !c.legend && !c.spec).map((c) => c.rating).sort((a, b) => a - b)
const gone = RETIRED_COACH_CARDS.map((c) => c.rating).sort((a, b) => a - b)
ok('70 位退役教练，都查得到，id 不和现役教练撞', RETIRED_COACH_CARDS.length === 70 && RETIRED_COACH_CARDS.every((c) => cardById(c.id) === c && c.id.startsWith('rc:') && c.retired))
ok('总评就是现役同一个公式（战术 45% + 培养 30% + 激励 25%）', RETIRED_COACH_CARDS.every((c) => c.rating === coachRating(c)))
const med = (a: number[]) => a[Math.floor(a.length / 2)]
ok('换算到现役的尺子：中位数、最高最低都和现役主教练差不多', Math.abs(med(gone) - med(live)) <= 3 && Math.abs(gone[0] - live[0]) <= 3 && Math.abs(gone[gone.length - 1] - live[live.length - 1]) <= 3,
  `退役 ${gone[0]}–${med(gone)}–${gone[gone.length - 1]} / 现役 ${live[0]}–${med(live)}–${live[live.length - 1]}`)
ok('不进全图鉴，也不进教练包', RETIRED_COACH_CARDS.every((c) => !FULL_SET_CARDS.has(c.id) && !COACH_CARDS.includes(c)))
ok('筛选「退役选手」系列能找到他们', RETIRED_COACH_CARDS.every((c) => matchesFilter(c, { ...EMPTY_FILTER, series: 'retired' })))
ok('退役教练包在商店里，一张，不出彩卡', PACK_ORDER.includes('retiredCoach') && PACKS.retiredCoach.shop !== false && PACKS.retiredCoach.draws === 1 && PACKS.retiredCoach.mythic === 0)
{
  const id = 'VM-TEST-RCOA-0000-0000'
  FREE_COINS.on = true
  const g = migrateGacha(newGacha(id, '测试', '2026-10-21'), id)
  const got = new Set<string>()
  for (let i = 0; i < 400; i++) for (const p of openPack(g, 'retiredCoach', 'coins', '2026-10-21')) got.add(p.card.id)
  FREE_COINS.on = false
  const dealt = [...got].map((x) => cardById(x))
  ok('退役教练包只出退役教练', dealt.every((c) => isCoachCard(c) && !!c.retired), [...got].filter((x) => !x.startsWith('rc:')).join(','))
  ok('开 400 包能见到大多数人', got.size >= 50, `${got.size}`)
}
if (bad) { console.error(`${bad} 项没过`); process.exit(1) }
console.log('全部通过')
