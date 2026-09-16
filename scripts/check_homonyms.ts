/**
 * Two real people behind one handle stay two people. (2026-09-16)
 *
 *   npx tsx scripts/check_homonyms.ts
 *
 * 「zeek是波兰人，游戏里国籍错了」. The 2026 world's zeek is Burair Ali of
 * Canada at Nightblood Gaming; the Acend world champion of 2021 is Aleksander
 * Zygmunt of Poland. Every cache the builders read is keyed by handle, so the
 * Canadian had been given the Pole's photo, birthdate, club history and
 * coaches, the 2021 彩卡 took the Canadian's flag and region, and the 2023
 * world gave the Pole the Canadian's id. data-raw/overrides.json `homonyms`
 * is the table the builders now consult; this checks what they produced.
 *
 * Also here, because it was reported in the same message: the 2023 EG Demon1
 * 彩卡 under Potter showed no 默契 at all, though the coach adds to it — the
 * squad screen listed only player pairs.
 */
import { readFileSync } from 'node:fs'
import { ALL_CARDS, cardById, chemistry, isPlayerCard, personOf } from '../src/engine/cards'
import { ARENA_TEAM, buildArena } from '../src/engine/arena'
import dossier from '../src/data/dossier.json'
import records from '../src/data/records.json'
import coached from '../src/data/coached.json'
import world from '../src/data/world.json'
import world2023 from '../src/data/world_2023.json'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}

const homonyms = JSON.parse(readFileSync('data-raw/overrides.json', 'utf8')).homonyms as
  Record<string, { vlr: string; nat: string; real: string; other: { vlr: string; nat: string; real: string } }>

console.log('=== 同名的两个人 ===')
for (const [ign, h] of Object.entries(homonyms)) {
  const p = (world as any).players.find((x: any) => x.ign.toLowerCase() === ign)
  check(`${ign}：2026 世界里是 ${h.real}`, p?.realName === h.real && p?.nat === h.nat, `${p?.realName} / ${p?.nat}`)
  const d = (dossier as any).players[p.id] ?? {}
  check(`${ign}：档案国籍和 vlr 编号是他本人的`, d.nat === h.nat && d.vlr === h.vlr, `${d.nat} / vlr ${d.vlr}`)
  check(`${ign}：没有用液体百科那个人的照片`, d.src !== 'lp', `src ${d.src}`)
  const th = (records as any).players[p.id]?.th ?? []
  check(`${ign}：没有另一个人的转会履历`, th.length === 0, th.map((r: any) => r[2]).join('、'))
  const coaches = Object.entries(coached as Record<string, string[][]>)
    .filter(([, rows]) => rows.some((r) => r[0] === p.id)).map(([c]) => c)
  check(`${ign}：没有另一个人的教练关系`, coaches.length === 0, coaches.join('、'))
  const birthOk = !p.birth || !(world2023 as any).players.some((x: any) => x.birth === p.birth && x.nat === h.other.nat && x.ign.toLowerCase() === ign)
  check(`${ign}：生日不是另一个人的`, birthOk, p.birth ?? '无')

  const old = (world2023 as any).players.filter((x: any) => x.ign.toLowerCase() === ign)
  for (const x of old) {
    const him = x.nat === h.nat
    check(`${ign}：2023 世界里的 ${x.realName ?? x.ign}（${x.nat}）${him ? '用他 2026 的编号' : '有自己的编号'}`,
      him ? x.id === p.id : x.id !== p.id, x.id)
  }
}

console.log('\n=== 彩卡 zeek ===')
{
  const legend = cardById('L:zeek-champions-2021')
  const everyday = ALL_CARDS.find((c) => isPlayerCard(c) && c.ign === 'zeek' && !c.legend)
  check('彩卡 zeek 是波兰人', isPlayerCard(legend) && legend.nat === 'pl', isPlayerCard(legend) ? String(legend.nat) : '')
  check('彩卡 zeek 在 EMEA', isPlayerCard(legend) && legend.region === 'EMEA', isPlayerCard(legend) ? legend.region : '')
  check('彩卡 zeek 叫 Aleksander Zygmunt', isPlayerCard(legend) && legend.realName === 'Aleksander Zygmunt')
  check('彩卡 zeek 和加拿大的 zeek 是两个人', !!legend && !!everyday && personOf(legend) !== personOf(everyday),
    `${legend && personOf(legend)} vs ${everyday && personOf(everyday)}`)

  // he plays: seated from the card, not from a world record he does not have
  const slots = [legend!.id, ...ALL_CARDS.filter((c) => isPlayerCard(c) && !c.legend && c.rarity === 'gold')
    .slice(0, 4).map((c) => c.id)]
  const { state, cardOf } = buildArena({ slots, coach: null }, () => 0, 7)
  const roster = state.teams[ARENA_TEAM]?.roster ?? []
  const seated = roster.map((id) => cardOf[id])
  check('彩卡 zeek 上场打比赛', seated.includes(legend!.id) && roster.length === 5, `${roster.length} 人：${seated.join(', ')}`)
  const clone = roster.map((id) => state.players[id]).find((p) => cardOf[p.id] === legend!.id)
  check('场上的 zeek 是波兰人', clone?.nat === 'pl', String(clone?.nat))
}

console.log('\n=== 教练的默契看得见 ===')
{
  const demon = ALL_CARDS.find((c) => c.id === 'L:demon1-champions-2023')!
  const potter = ALL_CARDS.find((c) => c.id === 'c:potter')!
  const r = chemistry({ slots: [demon.id, null, null, null, null], coach: potter.id })
  const link = r.coachLinks.find((l) => l.slot === 0)
  check('Potter × 2023 EG Demon1 算同队', link?.why === 'club' && link.value === 3, JSON.stringify(link))
  check('教练的默契加进了分数', r.coachBonus === r.coachLinks.reduce((s, l) => s + l.value, 0),
    `${r.coachBonus} vs ${r.coachLinks.map((l) => l.value).join('+')}`)
  const everyday = ALL_CARDS.find((c) => isPlayerCard(c) && c.ign === 'Demon1' && !c.legend)!
  const r2 = chemistry({ slots: [everyday.id, null, null, null, null], coach: potter.id })
  check('Potter 带过现在 ENVY 的 Demon1', r2.coachLinks[0]?.why === 'coached', JSON.stringify(r2.coachLinks[0]))
}

console.log(bad ? `\n${bad} 处不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
