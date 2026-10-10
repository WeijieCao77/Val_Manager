/**
 * Keep every card ever dealt findable: run after every data update.
 *
 *   npm run archive-cards        (npx tsx scripts/archive_cards.ts)
 *
 * data-raw/card_snapshots.json holds the last snapshot of every 选手卡 and
 * coach card the game has ever built from its rosters (not bundled). A card
 * whose man is no longer on the rosters moves from there into
 * src/data/card_archive.json, which the game reads (cards.ts): his card stays
 * owned, playable and tradable, and no pack deals it. A man who is back on the
 * rosters is dropped from the archive and his live card, same id, takes over.
 * Then every live card's snapshot is refreshed. Nothing is ever deleted.
 *
 * 彩卡, 首尔 and 曼谷 cards are built from their own data and are not
 * snapshotted; they read the archive when their man has left (ANY_BASE).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { BASE_PLAYER_CARDS, COACH_CARDS, snapshotOf, type CardSnapshot } from '../src/engine/cards'

type Book = { players: Record<string, CardSnapshot>; coaches: Record<string, CardSnapshot> }
const SNAP = 'data-raw/card_snapshots.json'
const ARCH = 'src/data/card_archive.json'
const read = (p: string): Book => {
  try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return { players: {}, coaches: {} } }
}

const snaps = read(SNAP)
const arch = read(ARCH)
const livePlayers = BASE_PLAYER_CARDS
const liveCoaches = COACH_CARDS.filter((c) => !c.legend)
const live = new Set([...livePlayers, ...liveCoaches].map((c) => c.id))
const moved: string[] = []
const back: string[] = []

for (const kind of ['players', 'coaches'] as const) {
  // gone from the rosters since the last run: keep his last card
  for (const [id, s] of Object.entries(snaps[kind])) {
    if (!live.has(id) && !arch[kind][id]) { arch[kind][id] = s; moved.push(id) }
  }
  // back on the rosters: the live card takes over
  for (const id of Object.keys(arch[kind])) {
    if (live.has(id)) { delete arch[kind][id]; back.push(id) }
  }
}
for (const c of livePlayers) snaps.players[c.id] = snapshotOf(c)
for (const c of liveCoaches) snaps.coaches[c.id] = snapshotOf(c)

const sorted = (o: Record<string, CardSnapshot>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)))
writeFileSync(SNAP, JSON.stringify({ players: sorted(snaps.players), coaches: sorted(snaps.coaches) }) + '\n')
writeFileSync(ARCH, JSON.stringify({ players: sorted(arch.players), coaches: sorted(arch.coaches) }, null, 1) + '\n')
console.log(`snapshots: ${Object.keys(snaps.players).length} players, ${Object.keys(snaps.coaches).length} coaches`)
console.log(`archive: ${Object.keys(arch.players).length} former players, ${Object.keys(arch.coaches).length} former coaches`)
if (moved.length) console.log(`left the rosters (now former cards): ${moved.join(', ')}`)
if (back.length) console.log(`back on the rosters: ${back.join(', ')}`)
