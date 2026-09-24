/**
 * A club cup's bracket cannot be worked out from the save before paying.
 *
 *   npx tsx scripts/check_cup_seed.ts
 *
 * enterCup draws the rounds (three to five) and the opponents from the
 * account's seed, and the account goes to the client with every reply. Run
 * as it was, a player holding their own state knew the bracket before
 * entering (found 2026-09-24). cup_enter folds in the server's number first,
 * the way a pack opening does; this plays the client's guess against the
 * server's draw on a dozen accounts.
 */
import { runAction, squadForPlay } from '../src/engine/cardActions'
import { newGacha, migrateGacha, enterCup, levelOf } from '../src/engine/gacha'
import { ALL_CARDS, squadRating } from '../src/engine/cards'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}

const TRIES = 12
let hits = 0, entered = 0
for (let i = 0; i < TRIES; i++) {
  const id = `VM-CUPS-CUPS-CUPS-CUPS-CU${String.fromCharCode(65 + i)}${i % 10}`
  const g = newGacha(id, 'cup', '2026-09-24')
  g.daily.staminaAt = 1
  const seen = new Set<string>(), pick: string[] = []
  for (const c of ALL_CARDS as any[]) {
    if (c.kind !== 'player' || c.rarity !== 'gold') continue
    const who = c.person ?? c.ign
    if (seen.has(who)) continue
    seen.add(who)
    pick.push(c.id)
    g.cards[c.id] = { id: c.id, level: 0, dupes: 0, seen: 1, got: '' } as never
    if (pick.length === 5) break
  }
  g.squad = { slots: pick, coach: null }
  const five = squadForPlay(g) as { ok: true; squad: any }
  const rating = squadRating(five.squad, (x: string) => levelOf(g, x))
  // what the client could compute from the copy it was sent
  const copy = migrateGacha(JSON.parse(JSON.stringify(g)), id)
  const guess = enterCup(copy, rating, 10_000_000).path.join(',')
  const real = runAction(g, 'cup_enter', {}, { now: 10_000_000, today: '2026-09-24', seed: 424242 + i * 7919 }) as any
  if (!real.ok) continue
  entered++
  if (real.result.cup.path.join(',') === guess) hits++
}
check('杯赛都报上名了', entered === TRIES, `${entered}/${TRIES}`)
check('拿着自己的存档也算不出杯赛对手', hits <= 1, `${hits}/${entered} 猜中`)
console.log(bad ? `\n${bad} 处不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
