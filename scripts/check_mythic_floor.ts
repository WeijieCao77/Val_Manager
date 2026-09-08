/**
 * The 彩卡 floor fires at exactly MYTHIC_FLOOR, every time, on any pack that
 * can hold one — and on nothing else.
 *
 *   npx tsx scripts/check_mythic_floor.ts
 *
 * Asked for by the owner before the pity bars went up (2026-09-06): 「确保
 * 1200 抽真的会触发保底」. Scout packs carry the smallest natural 彩卡 rate
 * (one in ten thousand), so thousands of them across several accounts reach
 * the floor again and again; the account's own rolling seed decides the rest.
 * Every pull is watched: the dry count never passes the floor, a pull made
 * with the count at the floor is a 彩卡, a 彩卡 resets both counters, and a
 * coach pack — which cannot hold one — leaves the count where it was.
 */
import { MYTHIC_FLOOR, newGacha, openPack, migrateGacha, PACKS } from '../src/engine/gacha'
import type { GachaState } from '../src/engine/gacha'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}

const PULLS = 4000
let floorHits = 0
let naturals = 0
let maxDry = 0
let owedButNot = 0
let notResetAfter = 0
let counterMoved = 0
for (const seed of ['VM-FLOR-0000-0000-0000-0001', 'VM-FLOR-0000-0000-0000-0002', 'VM-FLOR-0000-0000-0000-0003']) {
  const g: GachaState = newGacha(seed, '保底', '2026-09-06')
  g.coins = 1e9
  for (let i = 0; i < PULLS; i++) {
    const dryBefore = g.mythicDry
    const owed = dryBefore >= MYTHIC_FLOOR
    g.packs.scout = 1
    const [card] = openPack(g, 'scout', 'pack')
    const mythic = card.card.rarity === 'mythic'
    if (owed) { floorHits++; if (!mythic) owedButNot++ }
    else if (mythic) naturals++
    if (mythic && (g.mythicDry !== 0 || g.pity !== 0)) notResetAfter++
    if (!mythic && g.mythicDry !== dryBefore + 1) counterMoved++
    maxDry = Math.max(maxDry, g.mythicDry)
  }
}
check(`${PULLS * 3} 个试训包里，干抽计数从没超过 ${MYTHIC_FLOOR}`, maxDry <= MYTHIC_FLOOR, `最高 ${maxDry}`)
check(`计数到 ${MYTHIC_FLOOR} 之后的那一抽必是彩卡（触发 ${floorHits} 次，自然出 ${naturals} 张）`, floorHits >= 3 && owedButNot === 0, `没兑现 ${owedButNot} 次`)
check('出彩卡后两个计数都归零', notResetAfter === 0, `${notResetAfter} 次没归零`)
check('没出的每一抽都把计数加一', counterMoved === 0, `${counterMoved} 次不对`)

// The guarantee is paid from any pack that can hold a 彩卡 and only from those.
// The coach pack used to be the example of a pack that could not: 彩卡 were
// nights somebody PLAYED. Muggle coached EDG to Champions 2024 without playing
// a map of it, so the booth has one now and the pack counts like the rest
// (2026-09-08). A pack with no 彩卡 in its pool still must not touch the
// counter, or the guarantee could be spent where it can never be paid.
{
  const g = newGacha('VM-FLOR-0000-0000-0000-0004', '保底', '2026-09-06')
  g.coins = 1e9
  g.mythicDry = MYTHIC_FLOOR
  g.packs.coach = 1
  const coach = openPack(g, 'coach', 'pack')
  check('教练包也能兑现保底（里面有教练彩卡了）',
    PACKS.coach.mythic > 0 && coach.some((c) => c.card.rarity === 'mythic') && g.mythicDry < MYTHIC_FLOOR,
    `计数 → ${g.mythicDry}`)
  {
    // 位置包 still has none, and still must not move the counter
    const h = newGacha('VM-FLOR-0000-0000-0000-0005', '保底', '2026-09-06')
    h.coins = 1e9
    h.mythicDry = MYTHIC_FLOOR
    h.packs.duelist = 1
    openPack(h, 'duelist', 'pack')
    check('没有彩卡的包不动计数', h.mythicDry === MYTHIC_FLOOR && PACKS.duelist.mythic === 0, `计数 ${h.mythicDry}`)
  }
  for (const kind of ['elite', 'ten', 'cn'] as const) {
    const h = newGacha(`VM-FLOR-0000-0000-0000-000${kind.length}`, '保底', '2026-09-06')
    h.coins = 1e9
    h.mythicDry = MYTHIC_FLOOR
    h.packs[kind] = 1
    const cards = openPack(h, kind, 'pack')
    check(`${PACKS[kind].name}在计数到 ${MYTHIC_FLOOR} 时兑现保底`, cards.some((c) => c.card.rarity === 'mythic') && h.mythicDry < MYTHIC_FLOOR, `计数 → ${h.mythicDry}`)
  }
}

// the counter survives a save: it is one of the stored keys and the migration keeps it
{
  const g = newGacha('VM-FLOR-0000-0000-0000-0009', '保底', '2026-09-06')
  g.mythicDry = 777
  const back = migrateGacha(JSON.parse(JSON.stringify(g)), 'VM-FLOR-0000-0000-0000-0009')
  check('计数存进账号再读出来还是那个数', back.mythicDry === 777, `${back.mythicDry}`)
}

console.log(bad ? `\n${bad} failed` : '\nall held')
process.exit(bad ? 1 : 0)
