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

if (bad) { console.log(`${bad} failed`); process.exit(1) }
console.log('全部通过')
