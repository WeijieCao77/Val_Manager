/**
 * 教练的旧部：在教练所在俱乐部待过的人，默契比路人高，比现役低。
 *
 *   npx tsx scripts/check_coach_history.ts
 *
 * 「教练过去带过的选手没有默契值，比如 bail 和 JDG、BLG 的人都不显示带过。
 * 过去带过的选手应该也有默契值，但是没有现在队伍里的多。」
 *
 * 数据只够回答一半：选手的履历在 records.json 里（build_past_clubs.py 摘成了
 * pastClubs.json），教练自己的履历仓库里没有任何来源——所以这里测的是「在
 * bail 现在的 JDG 待过的人」，不是「bail 以前带过的 BLG」。
 *
 * 比的是 coachBonus 本身而不是总默契：换一个人也会换掉选手之间的同队、同国籍
 * 连线，那一部分跟教练无关。
 */
import { ALL_CARDS, chemistry, emptySquad, isCoachCard, isPlayerCard } from '../src/engine/cards'
import type { PlayerCard } from '../src/engine/cards'
import PAST from '../src/data/pastClubs.json'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const past = PAST as Record<string, string[]>

const bail = ALL_CARDS.find((c) => isCoachCard(c) && c.name === 'bail')
check('bail 是 JDG 的教练卡', isCoachCard(bail) && bail.clubTag === 'JDG', bail ? `${bail.clubTag}` : '没找到')
if (!isCoachCard(bail) || !bail.clubId) process.exit(1)
const jdg = bail.clubId

const ordinary = ALL_CARDS.filter((c): c is PlayerCard => isPlayerCard(c) && c.rarity !== 'mythic' && !c.event)
const cn = ordinary.filter((c) => c.region === bail.region)
const current = cn.find((c) => c.clubId === jdg)!
const alumnus = cn.find((c) => c.clubId !== jdg && (past[c.playerId] ?? []).includes(jdg))!
const stranger = cn.find((c) => c.clubId !== jdg && !(past[c.playerId] ?? []).includes(jdg))!
check('找得到一个现役 JDG、一个 JDG 旧部、一个没去过 JDG 的同赛区选手',
  !!current && !!alumnus && !!stranger,
  `${current?.ign} / ${alumnus?.ign}（现在 ${alumnus?.clubTag}）/ ${stranger?.ign}`)

/** bail's bonus with this one man in the first seat and nobody else on the sheet */
const bonusWith = (p: PlayerCard) => {
  const sq = emptySquad()
  sq.slots[0] = p.id
  sq.coach = bail.id
  return chemistry(sq)
}
const cur = bonusWith(current), old = bonusWith(alumnus), none = bonusWith(stranger)
check('旧部比路人多默契', old.coachBonus > none.coachBonus, `旧部 ${old.coachBonus} vs 路人 ${none.coachBonus}`)
check('但比现役少', old.coachBonus < cur.coachBonus, `旧部 ${old.coachBonus} vs 现役 ${cur.coachBonus}`)
check('旧部多的正好一格：现役两格，旧部一格', old.coachBonus - none.coachBonus === 1 && cur.coachBonus - none.coachBonus === 2,
  `+${old.coachBonus - none.coachBonus} / +${cur.coachBonus - none.coachBonus}`)
check('默契说明里写了谁在 JDG 待过', old.notes.some((n) => n.includes('JDG 待过')), old.notes.join(' | '))
check('路人那边不会写', !none.notes.some((n) => n.includes('待过')))

// a full five of JDG is still the ceiling: nothing about the former-club link
// can push a coach past what his own club's five already gets
{
  const five = ordinary.filter((c) => c.clubId === jdg).slice(0, 5)
  const sq = emptySquad()
  five.forEach((c, i) => { sq.slots[i] = c.id })
  sq.coach = bail.id
  const full = chemistry(sq).coachBonus
  check('五个现役 JDG 仍然是教练加成的上限', full === five.length * 3, `${full}`)
}

console.log(bad ? `\n${bad} 条不过` : '\n全部通过')
process.exit(bad ? 1 : 0)
