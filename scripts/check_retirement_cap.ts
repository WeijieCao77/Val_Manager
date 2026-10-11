/**
 * Two retired players at most in ordinary play (owner, 2026-10-09).
 *
 *   npx tsx scripts/check_retirement_cap.ts
 *
 * With real retired cards: two seat, three are refused by squadForPlay (the
 * cups, 全服杯, 组队杯, 国家队杯 all take their five from it) and by every
 * ladder's entry, with the reason in words; the ladder's paper score still
 * reads a five of any make-up (传奇联赛 will want five retired).
 */
import { BASE_PLAYER_CARDS, RETIRED_CARDS } from '../src/engine/cards'
import { newGacha, leagueEntry, LEAGUES } from '../src/engine/gacha'
import { runAction, squadForPlay, ladderScore } from '../src/engine/cardActions'
import { retiredStarters } from '../src/engine/retirementRules'

const store = new Map<string, string>()
;(globalThis as never as { localStorage: unknown }) = {
  getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) }, key: () => null, clear: () => store.clear(), get length() { return store.size },
}
let bad = 0
const check = (ok: boolean, what: string, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `  ${detail}` : ''}`)
  if (!ok) bad++
}
const live = BASE_PLAYER_CARDS.filter((c) => c.rarity !== 'mythic').slice(0, 5).map((c) => c.id)
const ret = RETIRED_CARDS.filter((c) => c.rarity !== 'mythic').slice(0, 5).map((c) => c.id)
const env = { now: Date.parse('2026-10-10T12:00:00+08:00'), today: '2026-10-10', seed: 3 }

function account(slots: string[]) {
  const g = newGacha('CAP', '审计', '2026-10-10')
  for (const id of [...live, ...ret]) g.cards[id] = { id, level: 0, dupes: 0, seen: 1 }
  g.squad = { slots: [...slots], coach: null }
  return g
}
const two = account([ret[0], ret[1], live[0], live[1], live[2]])
const three = account([ret[0], ret[1], ret[2], live[0], live[1]])
const five = account(ret)

check(retiredStarters(three.squad.slots) === 3, '数得出首发里的退役选手')
check(squadForPlay(two).ok, '两名退役选手可以上场')
const r3 = squadForPlay(three)
check(!r3.ok && /最多上 2 名退役选手/.test((r3 as { why: string }).why), '三名被拒，并说明原因', r3.ok ? '' : (r3 as { why: string }).why)
for (const league of LEAGUES) {
  const e = leagueEntry({ slots: three.squad.slots, coach: null }, league)
  check(!e.ok, `天梯「${league}」也拒绝三名退役选手`)
}
const lad = runAction(three, 'ladder', { league: 'open' }, env) as { ok: boolean; why?: string }
check(!lad.ok && /退役/.test(lad.why ?? ''), '天梯实际开打时同样拒绝', lad.why ?? '')
check(ladderScore(five) !== null, '天梯阵容分对五名退役选手照常计算（传奇联赛用）')
check((runAction(two, 'ladder', { league: 'open' }, env) as { ok: boolean }).ok, '两名退役选手能实际打一场天梯')

// the same man on two series cards is one man: 首尔 TenZ (historic:vlr:9) and 退役 TenZ (Hv9)
{
  const { personOf: who, cardById: byId, SEOUL_CARDS } = await import('../src/engine/cards')
  const seoulTenz = SEOUL_CARDS.find((c) => c.ign === 'TenZ')!
  check(who(seoulTenz) === who(byId('r:9')!), '首尔 TenZ 和退役 TenZ 是同一个人', `${who(seoulTenz)} / ${who(byId('r:9')!)}`)
  const g = account([seoulTenz.id, 'r:9', live[0], live[1], live[2]])
  g.cards[seoulTenz.id] = { id: seoulTenz.id, level: 0, dupes: 0, seen: 1 }
  check(!squadForPlay(g).ok, '同一个人不能在一套首发里出现两次')
}
// a retired man and his last club still know each other, a little less than two men on it now
{
  const { chemistry, cardById: byId, RETIRED_CARDS: RC, PLAYER_CARDS: PC, isPlayerCard: isP } = await import('../src/engine/cards')
  const s0m = RC.find((c) => isP(c) && c.ign === 's0m' && c.rarity !== 'mythic')!
  const brawk = PC.find((c) => c.ign === 'brawk' && !c.event && c.rarity !== 'mythic')!
  const l = chemistry({ slots: [s0m.id, brawk.id, null, null, null], coach: null }).links[0]
  check(l?.why === 'former' && l.value === 2, '退役 s0m 和现役 brawk（都是 NRG）有默契，比现役同队少一点', JSON.stringify(l))
  const sen = chemistry({ slots: ['r:9', 'r:659', null, null, null], coach: null }).links[0]
  check(byId('r:9')?.clubTag === 'SEN' && sen?.why === 'club' && sen.value === 3, '两名退役 SEN 选手仍是同队', JSON.stringify(sen))
  // a retired 彩卡 gets what a live 彩卡 gets: Sacy's LOUD 2022 is 同队 with today's LOUD, like aspas' LOUD 2022
  const sacy = RC.find((c) => c.ign === 'Sacy' && c.rarity === 'mythic')!
  const aspas = PC.find((c) => c.ign === 'aspas' && c.rarity === 'mythic')!
  const loud = PC.filter((c) => c.clubTag === 'LOUD' && !c.event && c.rarity !== 'mythic' && c.ign !== 'Sacy').slice(0, 4)
  const five = (m: string) => chemistry({ slots: [m, ...loud.map((c) => c.id)], coach: null })
  check(loud.length === 4 && five(sacy.id).score === five(aspas.id).score, '退役彩卡和普通彩卡跟现役同队默契一样', `${five(sacy.id).score} / ${five(aspas.id).score}`)
  check(five(sacy.id).links.filter((l) => l.a === 0).every((l) => l.why === 'club' && l.value === 3), '退役彩卡和现役同队算「同队」，不是「同队（退役）」')
  const { COACH_CARDS: CC } = await import('../src/engine/cards')
  const coach = CC.find((c) => c.clubTag === 'LOUD' && !c.legend)
  const withCoach = (m: string) => chemistry({ slots: [m, null, null, null, null], coach: coach?.id ?? null })
  check(!!coach && withCoach(sacy.id).coachBonus === withCoach(aspas.id).coachBonus && withCoach(sacy.id).coachLinks[0]?.why === 'club',
    '退役彩卡和老东家现任教练也算同队', `${coach?.name} ${withCoach(sacy.id).coachBonus} / ${withCoach(aspas.id).coachBonus}`)
  const s0mCoach = chemistry({ slots: [s0m.id, null, null, null, null], coach: CC.find((c) => c.clubTag === 'NRG' && !c.legend)?.id ?? null })
  check(s0mCoach.coachLinks[0]?.why !== 'club', '退役普卡和老东家教练不变（不算同队）')
}
// a retired NRG man with four of today's NRG and their coach still wears the NRG board
{
  const { RETIRED_CARDS: RC, PLAYER_CARDS: PC, COACH_CARDS: CC } = await import('../src/engine/cards')
  const { squadTeamIdentity } = await import('../src/engine/teamIdentity')
  const s0m = RC.find((c) => c.ign === 's0m' && c.rarity !== 'mythic')!
  const coach = CC.find((c) => c.clubTag === 'NRG' && !c.legend)!
  const four = PC.filter((c) => c.clubId === coach.clubId && !c.event && c.rarity !== 'mythic').slice(0, 4)
  const team = squadTeamIdentity({ slots: [s0m.id, ...four.map((c) => c.id)], coach: coach.id })
  check(four.length === 4 && team?.tag === 'NRG', '退役 s0m 加四名现役 NRG 和 NRG 教练有 NRG 队标背景', JSON.stringify(team && { tag: team.tag, id: team.id }))
  const sen = RC.find((c) => c.ign === 'TenZ' && c.rarity !== 'mythic')!
  check(!squadTeamIdentity({ slots: [sen.id, ...four.map((c) => c.id)], coach: coach.id }), '别队的退役选手不算（TenZ 是 SEN）')
}
// positions come from the agents he played over his career, like a live card's (2026-10-11)
{
  const { RETIRED_CARDS: RC } = await import('../src/engine/cards')
  const n = (ign: string) => RC.find((c) => c.ign === ign && c.rarity !== 'mythic')!
  const m = (ign: string) => RC.find((c) => c.ign === ign && c.rarity === 'mythic')!
  check(n('s0m').role === '控场' && n('s0m').roles.includes('决斗者'), 's0m 以控场为主，也能打决斗', n('s0m').roles.join('/'))
  check(n('FNS').role === '哨卫' && m('BONECOLD').role === '先锋' && n('BONECOLD').role === '控场', 'FNS 哨卫，BONECOLD 生涯控场、那一届先锋')
  const multi = RC.filter((c) => c.roles.length > 1).length
  check(multi > RC.length / 2, '退役卡大多不止一个位置', `${multi}/${RC.length}`)
}
if (bad) { console.log(`${bad} failed`); process.exit(1) }
console.log('全部通过')
