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
}
if (bad) { console.log(`${bad} failed`); process.exit(1) }
console.log('全部通过')
