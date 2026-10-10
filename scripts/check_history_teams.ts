/**
 * 历代强队 and the seat every card without a world record needs (2026-10-10).
 *
 *   npx tsx scripts/check_history_teams.ts
 *
 * - every retired card and every 历代强队 opponent takes his seat in a match
 *   (they were dropped before: no 2026 world record, so the five played four);
 * - twelve stages, four chapters of three; opponent cards resolve but are never
 *   dealt, listed, or counted;
 * - the server holds the door: stages in order, five retired starters, no 体力;
 * - a chapter pays one 退役选手包, the board one more, each once;
 * - the record is server-owned and survives a save; junk is cleaned.
 */
import assert from 'node:assert/strict'
import { playRivalMatch } from '../src/engine/arena'
import { runAction } from '../src/engine/cardActions'
import {
  ALL_CARDS, HISTORY_OPP_CARDS, PLAYER_CARDS, ownableCard, RETIRED_CARDS, SQUAD_SLOTS, cardById, isPlayerCard, personOf,
} from '../src/engine/cards'
import type { PlayerCard, Squad } from '../src/engine/cards'
import { SERVER_KEYS, migrateGacha, newGacha, receiveCard, staminaNow } from '../src/engine/gacha'
import { restoreCard } from '../src/engine/inbox'
import { HISTORY_CHAPTERS, HISTORY_STAGES, historyEntry, historyState, recordHistory } from '../src/engine/historyTeams'

const store = new Map<string, string>()
;(globalThis as never as { localStorage: unknown }) = {
  getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) }, key: () => null, clear: () => store.clear(), get length() { return store.size },
}
const DAY = '2026-10-10'
const env = (seed = 7) => ({ today: DAY, now: Date.parse(`${DAY}T12:00:00+08:00`), seed })
const five = (pool: readonly PlayerCard[]) => {
  const used = new Set<string>()
  return SQUAD_SLOTS.map((slot) => {
    const p = pool.find((c) => !used.has(personOf(c)) && (slot === '自由人' || c.roles.includes(slot)))
    if (!p) return null
    used.add(personOf(p))
    return p.id
  })
}
const retired = (RETIRED_CARDS.filter(isPlayerCard) as PlayerCard[]).filter((c) => c.rarity !== 'mythic').sort((a, b) => b.rating - a.rating)
const seated = (mine: Squad, theirs: Squad) => {
  const res = playRivalMatch(mine, () => 0, { ...theirs, name: 'X', tag: 'X', levels: {}, div: 0, points: 0 }, 3, 11)
  return { mine: res.lines.length, theirs: res.opp!.lines.length }
}

// every retired card plays — 169 普卡 and 8 彩卡, in fives
const all = RETIRED_CARDS.filter(isPlayerCard) as PlayerCard[]
const live: Squad = { slots: five(PLAYER_CARDS.filter((c) => !c.event && c.rarity === 'gold')), coach: null }
for (let i = 0; i < all.length; i += 5) {
  const slots = all.slice(i, i + 5).map((c) => c.id)
  const s = seated({ slots, coach: null }, live)
  assert.equal(s.mine, new Set(all.slice(i, i + 5).map(personOf)).size, `retired cards ${slots.join(',')} not all seated`)
}
console.log(`ok   全部 ${all.length} 张退役卡都能上场`)

// the board
assert.equal(HISTORY_STAGES.length, 12)
assert.deepEqual(HISTORY_CHAPTERS, [1, 2, 3, 4])
assert(HISTORY_CHAPTERS.every((c) => HISTORY_STAGES.filter((s) => s.chapter === c).length === 3))
assert.equal(HISTORY_OPP_CARDS.length, 60)
const listed = new Set(ALL_CARDS.map((c) => c.id))
assert(HISTORY_OPP_CARDS.every((c) => cardById(c.id) === c && !listed.has(c.id)), 'opponents resolve, never listed')
for (const st of HISTORY_STAGES) {
  assert.equal(seated({ slots: five(retired), coach: null }, st.five).theirs, 5, `${st.team} plays short`)
}
// never owned: every path that hands a card over refuses them
const opp = HISTORY_OPP_CARDS[0].id
const k = newGacha('HISTOWN', '审计', DAY)
assert.equal(ownableCard(opp), undefined)
assert.equal(receiveCard(k, opp, '审计'), false)
restoreCard(k, opp, 0)
assert(!k.cards[opp], 'mail never delivers an opponent')
assert(ownableCard(retired[0].id), 'ordinary cards are still ownable')
console.log('ok   12 关 4 章，对手 60 人都能上场，不进卡池，送不进、寄不进、挂不上')

// the door
const g = newGacha('HIST', '审计', DAY)
for (const c of [...retired, ...PLAYER_CARDS.filter((c) => !c.event).slice(0, 30)]) g.cards[c.id] = { id: c.id, level: 0, dupes: 0, seen: 1, got: DAY }
g.squad = { slots: five(retired), coach: null }
const stamina = staminaNow(g, env().now)
const [first, second] = HISTORY_STAGES
assert.equal(runAction(g, 'history_play', { stage: second.id }, env()).ok, false, 'stages in order')
assert.equal(runAction(g, 'history_play', { stage: 'h9-9' }, env()).ok, false)
g.squad = { slots: [...five(retired).slice(0, 4), PLAYER_CARDS[0].id], coach: null }
const mixed = runAction(g, 'history_play', { stage: first.id }, env())
assert(!mixed.ok && mixed.why.includes('历代强队'), 'five retired starters')
g.squad = { slots: five(retired), coach: null }
let won = false
for (let seed = 1; seed < 400 && !won; seed++) {
  const r = runAction(g, 'history_play', { stage: first.id }, env(seed))
  assert(r.ok)
  won = (r.result as { out: { win: boolean } }).out.win
}
assert(won, 'the best retired five beats the first stage within 400 tries')
assert.equal(staminaNow(g, env().now), stamina, 'no 体力')
assert(historyState(g).cleared.includes(first.id))
assert(runAction(g, 'history_play', { stage: second.id }, env()).ok, 'the next stage opens')
assert.equal(historyEntry({ slots: [null, null, null, null, null], coach: null }).ok, false, 'an empty five cannot start')
console.log('ok   按顺序开关、只收五名退役首发、不扣体力、空阵容不能点')

// the rewards
const h = newGacha('HISTPAY', '审计', DAY)
let packs = 0
for (const st of HISTORY_STAGES) {
  const out = recordHistory(h, st.id, true)
  packs += out.packs
  if (st === HISTORY_STAGES[2]) assert.equal(out.chapterDone, 1)
  assert.equal(recordHistory(h, st.id, true).packs, 0, 'a stage pays once')
}
assert.equal(packs, 5, 'four chapters and the board')
assert.equal(h.packs.retired, 5)
assert((SERVER_KEYS as readonly string[]).includes('history'))
const saved = migrateGacha(JSON.parse(JSON.stringify(h)), h.id)
assert.equal(historyState(saved).cleared.length, 12)
assert.equal(historyState(saved).full, true)
const junk = newGacha('HISTJUNK', '审计', DAY)
;(junk as { history?: unknown }).history = { cleared: ['h1-1', 'nope', 3], paid: [1, 9], full: 'yes', tries: { 'h1-1': -2, 'h1-2': 4 } }
assert.deepEqual(historyState(junk), { cleared: ['h1-1'], paid: [1], full: false, tries: { 'h1-2': 4 } })
console.log('ok   每章 1 个退役选手包、全通再 1 个，各一次；存档转一圈还在')
console.log('全部通过')
