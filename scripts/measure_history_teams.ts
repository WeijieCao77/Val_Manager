/**
 * 历代强队: how often typical retired fives (bronze/silver/gold, +0) beat each
 * opponent in a BO3 — the measurement the chapters are ordered by.
 *
 *   npx tsx scripts/measure_history_teams.ts [matches]
 */
import { playRivalMatch } from '../src/engine/arena'
import { RETIRED_CARDS, SQUAD_SLOTS, HISTORY_OPP_CARDS, personOf, squadPaper, isPlayerCard } from '../src/engine/cards'
import type { PlayerCard, Squad } from '../src/engine/cards'
import HT from '../src/data/history_teams.json'
const five = (pool: readonly PlayerCard[]) => { const used = new Set<string>(); return SQUAD_SLOTS.map((slot) => { const p = pool.find((c) => !used.has(personOf(c)) && (slot === '自由人' || c.roles.includes(slot))); if (!p) return null; used.add(personOf(p)); return p.id }) }
const ret = (RETIRED_CARDS.filter(isPlayerCard) as PlayerCard[]).filter(c => c.rarity !== 'mythic').sort((a, b) => b.rating - a.rating)
const pick = (r: string) => ret.filter(c => c.rarity === r)
const q = (l: PlayerCard[], at: number) => l.slice(Math.floor(l.length * at))
const fives: [string, Squad][] = [
  ['bronze mid', { slots: five(q(pick('bronze'), .4)), coach: null }],
  ['silver mid', { slots: five(q(pick('silver'), .4)), coach: null }],
  ['silver top', { slots: five(pick('silver')), coach: null }],
  ['gold mid', { slots: five(q(pick('gold'), .4)), coach: null }],
  ['gold top', { slots: five(pick('gold')), coach: null }],
]
for (const [n, s] of fives) console.log(n.padEnd(11), squadPaper(s).score.toFixed(1), s.slots.map(id => RETIRED_CARDS.find(c => c.id === id)?.rating).join(','))
const N = Number(process.argv[2] ?? 60)
for (const st of (HT as any).stages) {
  const opp = { slots: st.players.map((p: any) => `ht:${st.id}:${p.vlrId}`), coach: null, name: st.team, tag: st.tag, levels: {}, div: 0, points: 0 }
  const paper = squadPaper(opp).score
  const line = fives.map(([n, s]) => { let w = 0; for (let i = 0; i < N; i++) if (playRivalMatch(s, () => 0, opp, 3, 900 + i).win) w++; return `${(w / N * 100).toFixed(0).padStart(3)}%` })
  console.log(`${st.short.padEnd(8)} ${st.team.padEnd(16)} paper ${paper.toFixed(1)}  ${line.join(' ')}`)
}
