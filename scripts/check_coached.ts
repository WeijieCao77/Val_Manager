/**
 * 教练带过的人：只算真的同时期在一起的。
 *
 *   npx tsx scripts/check_coached.ts
 *
 * 「只有真的和那位教练同时期呆过的人才有默契值，而不是在同一个俱乐部过就有。」
 *
 * coached.json 由 build_coached.py 生成：教练在 vlr 上的执教经历（角色 + 月份）
 * 对选手在 Liquipedia 的效力记录（月份），同一家俱乐部、月份有交集才算。
 * 这里盯住用户举的那个例子：bail 2025 年 11 月才去 JDG ——
 *   - stew 在 JDG 待到 2026 年 6 月，跟 bail 重叠 → 算
 *   - S1Mon 在 bail 来之前就离开了 JDG → 不算（旧规则会算他）
 * 比的是 coachBonus 本身，换人会连带换掉选手之间的连线。
 */
import { ALL_CARDS, chemistry, emptySquad, isCoachCard, isPlayerCard } from '../src/engine/cards'
import type { CoachCard, PlayerCard } from '../src/engine/cards'
import COACHED from '../src/data/coached.json'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const coached = COACHED as Record<string, string[][]>
const ordinary = ALL_CARDS.filter((c): c is PlayerCard => isPlayerCard(c) && c.rarity !== 'mythic' && !c.event)
const card = (ign: string) => ordinary.find((c) => c.ign === ign)
const coachCard = (name: string) => ALL_CARDS.find((c): c is CoachCard => isCoachCard(c) && c.name === name && !c.legend)
const bonus = (coach: CoachCard, p: PlayerCard) => {
  const sq = emptySquad()
  sq.slots[0] = p.id
  sq.coach = coach.id
  return chemistry(sq)
}

const bail = coachCard('bail')!
check('bail 是 JDG 的教练卡', !!bail && bail.clubTag === 'JDG', bail?.clubTag ?? '没找到')
const zhe = card('zhe')!, stew = card('stew')!, s1mon = card('S1Mon')!
const inBail = new Set((coached.bail ?? []).map((r) => r[0]))
// a same-region player bail has never coached and who is not at JDG now
const stranger = ordinary.find((c) => c.region === bail.region && c.clubId !== bail.clubId && !inBail.has(c.playerId))!
check('找得到对照用的人', !!zhe && !!stew && !!s1mon && !!stranger, `${zhe?.ign} ${stew?.ign} ${s1mon?.ign} ${stranger?.ign}`)

const cur = bonus(bail, zhe), with_ = bonus(bail, stew), before = bonus(bail, s1mon), none = bonus(bail, stranger)
check('stew 跟 bail 在 JDG 有重叠，算带过：比路人多一格', with_.coachBonus === none.coachBonus + 1, `${with_.coachBonus} vs ${none.coachBonus}`)
check('S1Mon 在 bail 来之前就走了，不算：跟路人一样', !inBail.has(s1mon.playerId) && before.coachBonus === none.coachBonus,
  `${before.coachBonus} vs ${none.coachBonus}`)
check('现在就在 JDG 的 zhe 仍然是两格', cur.coachBonus === none.coachBonus + 2, `${cur.coachBonus} vs ${none.coachBonus}`)
check('带过的人会写进默契说明', with_.notes.some((n) => n.includes('以前还带过')), with_.notes.join(' | '))
check('没带过的人不会写', !before.notes.some((n) => n.includes('以前还带过')))

// the table never lists a coach as his own player
{
  const selfPairs = Object.entries(coached).filter(([coach, rows]) =>
    rows.some(([pid]) => ordinary.find((c) => c.playerId === pid)?.ign.toLowerCase() === coach.toLowerCase()))
  check('没有教练算自己带过自己', selfPairs.length === 0, selfPairs.map(([c]) => c).join('、'))
}

// his own club's five is still the ceiling
{
  const five = ordinary.filter((c) => c.clubId === bail.clubId).slice(0, 5)
  const sq = emptySquad()
  five.forEach((c, i) => { sq.slots[i] = c.id })
  sq.coach = bail.id
  check('五个现役 JDG 仍然是教练加成的上限', chemistry(sq).coachBonus === five.length * 3, `${chemistry(sq).coachBonus}`)
}

console.log(bad ? `\n${bad} 条不过` : '\n全部通过')
process.exit(bad ? 1 : 0)
