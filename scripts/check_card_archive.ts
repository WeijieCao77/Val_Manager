/**
 * A card never vanishes from the hands that hold it.
 *
 *   npx tsx scripts/check_card_archive.ts
 *
 * Cards are built from today's rosters (world.json). A man who retires or
 * leaves the game's leagues used to take every owned copy of his card with
 * him. This check holds the fix (cards.ts former cards, scripts/archive_cards.ts):
 *
 *  1. every card ever dealt (data-raw/card_snapshots.json) is found by cardById;
 *  2. every live 选手卡 and coach card has a current snapshot — fails when a data
 *     update forgot `npm run archive-cards`;
 *  3. a snapshot rebuilds exactly the live card;
 *  4. end to end, in a scratch copy of src/: one real player is taken off the
 *     rosters and archived; his card is still found, marked former, in the
 *     owner's collection, fields in a five, plays a ladder match, and no pack
 *     or 图鉴 total counts it any more.
 */
import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BASE_PLAYER_CARDS, COACH_CARDS, cardById, cardFromSnapshot, snapshotOf } from '../src/engine/cards'
import type { CardSnapshot } from '../src/engine/cards'

let bad = 0
const check = (ok: boolean, what: string, detail = '') => {
  if (!ok) { bad++; console.log(`FAIL ${what}${detail ? `  ${detail}` : ''}`) } else console.log(`ok   ${what}`)
}

const snaps = JSON.parse(readFileSync('data-raw/card_snapshots.json', 'utf8')) as Record<'players' | 'coaches', Record<string, CardSnapshot>>
const ever = [...Object.keys(snaps.players), ...Object.keys(snaps.coaches)]
const lost = ever.filter((id) => !cardById(id))
check(lost.length === 0, `every card ever dealt is still found (${ever.length})`, lost.slice(0, 10).join(', '))

const live = [...BASE_PLAYER_CARDS, ...COACH_CARDS.filter((c) => !c.legend)]
const stale = live.filter((c) => {
  const s = (c.kind === 'player' ? snaps.players : snaps.coaches)[c.id]
  return !s || JSON.stringify(s) !== JSON.stringify(snapshotOf(c))
})
check(stale.length === 0, 'every live card has a current snapshot (else run: npm run archive-cards)', stale.slice(0, 10).map((c) => c.id).join(', '))

// field by field, whatever order the keys come in
const canon = (x: unknown): string => JSON.stringify(x, (_k, v) =>
  v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v)
const drift = live.filter((c) => {
  const back = cardFromSnapshot(snapshotOf(c)) as unknown as Record<string, unknown>
  delete back.former
  return canon(back) !== canon(c)
})
check(drift.length === 0, 'a snapshot rebuilds the live card exactly', drift.slice(0, 5).map((c) => c.id).join(', '))

// ---- 4. end to end in a scratch copy ------------------------------------------
const dir = mkdtempSync(join(tmpdir(), 'card-archive-'))
try {
  cpSync('src', join(dir, 'src'), { recursive: true })
  cpSync('scripts/archive_cards.ts', join(dir, 'scripts/archive_cards.ts'))
  cpSync('data-raw/card_snapshots.json', join(dir, 'data-raw/card_snapshots.json'))
  cpSync('package.json', join(dir, 'package.json'))
  cpSync('tsconfig.json', join(dir, 'tsconfig.json'))
  symlinkSync(join(process.cwd(), 'node_modules'), join(dir, 'node_modules'))
  const world = JSON.parse(readFileSync('src/data/world.json', 'utf8'))
  // a gold from a club with a sixth man, so the club still fields five without him
  // (a real update signs a replacement; cup clubs need five live cards — cupTeams.ts)
  const size = new Map<string, number>()
  for (const p of world.players as { teamId?: string }[]) if (p.teamId) size.set(p.teamId, (size.get(p.teamId) ?? 0) + 1)
  const gone = BASE_PLAYER_CARDS.filter((c) => c.rarity === 'gold' && c.clubId && (size.get(c.clubId) ?? 0) >= 6)[0].playerId
  world.players = world.players.filter((p: { id: string }) => p.id !== gone)
  for (const t of world.teams) if (Array.isArray(t.roster)) t.roster = t.roster.filter((id: string) => id !== gone)
  writeFileSync(join(dir, 'src/data/world.json'), JSON.stringify(world))
  execFileSync('npx', ['tsx', 'scripts/archive_cards.ts'], { cwd: dir, stdio: 'pipe' })
  const probe = `
    const store = new Map(); globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k), key: () => null, clear: () => store.clear(), get length() { return store.size } }
    const { cardById, ALL_CARDS, BASE_PLAYER_CARDS } = await import('./src/engine/cards.ts')
    const G = await import('./src/engine/gacha.ts')
    const { runAction } = await import('./src/engine/cardActions.ts')
    const id = 'p:${gone}'
    const out = {}
    const c = cardById(id)
    out.found = !!c; out.former = !!c?.former; out.inAll = ALL_CARDS.some(x => x.id === id)
    const g = G.newGacha('t', 't', '2026-10-10'); g.coins = 1e9
    const five = BASE_PLAYER_CARDS.filter(x => x.rarity !== 'mythic').slice(0, 4).map(x => x.id)
    for (const k of [id, ...five]) g.cards[k] = { id: k, level: 0, dupes: 0, seen: 1 }
    out.inCollection = G.collection(g).some(x => x.card.id === id)
    g.squad = { slots: [id, ...five], coach: null }
    const r = runAction(g, 'ladder', { league: 'open' }, { now: Date.now(), today: '2026-10-10', seed: 7 })
    out.ladder = r.ok ? 'played' : r.why
    let dealt = false
    for (let i = 0; i < 3000 && !dealt; i++) for (const x of G.openPack(g, 'elite', 'coins')) if (x.card.id === id) dealt = true
    out.dealt = dealt
    console.log(JSON.stringify(out))`
  writeFileSync(join(dir, 'probe.mts'), probe)
  const res = JSON.parse(execFileSync('npx', ['tsx', 'probe.mts'], { cwd: dir, encoding: 'utf8' }).trim().split('\n').pop()!)
  check(res.found, `a player taken off the rosters (${gone}) still has his card`)
  check(res.former, 'his card is marked former')
  check(res.inCollection, "it is in the owner's collection")
  check(res.ladder === 'played', 'it fields in a five and plays a ladder match', String(res.ladder))
  check(!res.inAll, 'it is out of the dealt pool and the 图鉴 total')
  check(!res.dealt, 'no pack deals it (3000 选拔包)')
} finally {
  rmSync(dir, { recursive: true, force: true })
}

if (bad) { console.log(`${bad} failed`); process.exit(1) }
console.log('全部通过')
