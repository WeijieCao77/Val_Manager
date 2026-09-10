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

// 「AfteR以前带过ZmjjKK、nobody、CHICHOO、Smoggy，为什么没显示以前带过4人？」
// vlr 只写了他 2020 年 6 月到 EDG，没写离开；他 2024 年 10 月去了 TEC，那就是
// EDG 那段的结束。四个人都在这四年里。
{
  const after = coachCard('AfteR')!
  const inAfter = new Set((coached.AfteR ?? []).map(([pid]) => pid))
  const four = ['ZmjjKK', 'nobody', 'CHICHOO', 'Smoggy'].map((n) => card(n)!)
  check('AfteR 是 TEC 的教练卡', !!after && after.clubTag === 'TEC', after?.clubTag ?? '没找到')
  check('AfteR 带过 EDG 的 ZmjjKK、nobody、CHICHOO、Smoggy', four.every((c) => c && inAfter.has(c.playerId)),
    four.map((c) => `${c?.ign}:${c && inAfter.has(c.playerId) ? '算' : '不算'}`).join(' '))
  const sq = emptySquad()
  four.forEach((c, i) => { sq.slots[i] = c.id })
  sq.coach = after.id
  const notes = chemistry(sq).notes
  check('卡组说明写着以前带过 4 人', notes.some((n) => n.includes('AfteR 以前还带过其中 4 人')), notes.join(' | '))
}

// 「vlr没有准确记录就去haojiao看，haojiao没有可以去thespike看，还有液体百科，
// 为什么单vlr没有就放弃了？」 Sunshine has no vlr page and no Liquipedia page;
// 号角 has him as EDG 战术教练 in 2025 and TYLOO head coach in 2024.
{
  const sunshine = coachCard('Sunshine')!
  const inSun = new Set((coached.Sunshine ?? []).map(([pid]) => pid))
  check('Sunshine 是 AQ 的教练卡', !!sunshine && sunshine.clubTag === 'AQ', sunshine?.clubTag ?? '没找到')
  check('号角补上的：Sunshine 带过 EDG 的 ZmjjKK 和 TYLOO 的 LuoK1ng',
    inSun.has(card('ZmjjKK')!.playerId) && inSun.has(card('LuoK1ng')!.playerId))
  const york = coachCard('York')!
  const inYork = new Set((coached.York ?? []).map(([pid]) => pid))
  check('号角补上的：York 在 FPX 当助教时带过 Setrod', !!york && inYork.has(card('Setrod')!.playerId))
  // Liquipedia, where vlr had no page: potter at EG, TK9_주 at SLT before VL
  const potter = coachCard('potter')!
  const inPotter = new Set((coached.potter ?? []).map(([pid]) => pid))
  check('Liquipedia 补上的：potter 带过 EG 的 Demon1', !!potter && inPotter.has(card('Demon1')!.playerId))
  // a first-time coach has nobody, and that is the truth rather than a missing lookup
  check('742 第一次执教，没有前队可配', !(coached['742'] ?? []).length)
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
