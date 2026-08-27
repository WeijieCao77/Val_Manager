/**
 * Does the card mode actually work, and is it worth playing?
 *
 * Three questions this answers with numbers rather than with confidence:
 *   1. do the packs deal what they advertise, and does the pity net catch?
 *   2. does the coin economy pay for itself, or does the ladder dry up?
 *   3. does chemistry beat raw rating — the design claim the whole mode rests
 *      on — or is "pick the five biggest numbers" still the right answer?
 *
 *   npx tsx scripts/card_check.ts
 */
import { PLAYER_CARDS, COACH_CARDS, chemistry, squadRating, emptySquad } from '../src/engine/cards'
import type { Squad } from '../src/engine/cards'
import {
  DIVISIONS, PACKS, newGacha, openPack, recordLadder, ladderOpponent, checkIn,
  collectionProgress, autoSquad, enterCup, recordCup, cupOpponent, CUP_ENTRY, starsFor,
} from '../src/engine/gacha'
import type { GachaState, PackKind } from '../src/engine/gacha'
import { playArenaMatch } from '../src/engine/arena'
import { WORLD_TEAMS } from '../src/engine/world'

const pct = (n: number, d: number) => `${((100 * n) / Math.max(1, d)).toFixed(1)}%`

// ---------------------------------------------------------------- 1. pools

console.log('=== 卡池 ===')
for (const metal of ['gold', 'silver', 'bronze'] as const) {
  const p = PLAYER_CARDS.filter((c) => c.rarity === metal)
  const c = COACH_CARDS.filter((x) => x.rarity === metal)
  console.log(`  ${metal.padEnd(6)} 选手 ${String(p.length).padStart(3)} (${pct(p.length, PLAYER_CARDS.length)})`
    + `  教练 ${String(c.length).padStart(2)}`
    + `  评分 ${p.length ? Math.min(...p.map((x) => x.rating)) : '-'}–${p.length ? Math.max(...p.map((x) => x.rating)) : '-'}`)
}
const withFace = PLAYER_CARDS.filter((c) => c.face).length
const withNat = PLAYER_CARDS.filter((c) => c.nat).length
console.log(`  照片 ${withFace}/${PLAYER_CARDS.length} (${pct(withFace, PLAYER_CARDS.length)})`
  + `   国籍 ${withNat}/${PLAYER_CARDS.length} (${pct(withNat, PLAYER_CARDS.length)})`)

// ---------------------------------------------------------------- 2. pulls

console.log('\n=== 抽卡 1000 次「试训包」 ===')
{
  const g = newGacha('VM-TEST-TEST-TEST-TEST-TEST', 'check', '2026-08-27')
  g.coins = 1e9
  const got = { gold: 0, silver: 0, bronze: 0 }
  let worstDry = 0
  let dry = 0
  for (let i = 0; i < 1000; i++) {
    for (const p of openPack(g, 'scout', 'coins')) {
      got[p.card.rarity]++
      if (p.card.rarity === 'gold') { worstDry = Math.max(worstDry, dry); dry = 0 } else dry++
    }
  }
  console.log(`  金 ${got.gold} (${pct(got.gold, 1000)})  银 ${got.silver} (${pct(got.silver, 1000)})`
    + `  铜 ${got.bronze} (${pct(got.bronze, 1000)})`)
  console.log(`  最长连续不出金：${worstDry} 抽（保底上限 45）`)
  console.log(`  收集进度 ${collectionProgress(g).owned}/${collectionProgress(g).total}`)
}

console.log('\n=== 各卡包保底 ===')
for (const kind of Object.keys(PACKS) as PackKind[]) {
  const g = newGacha('VM-TEST-TEST-TEST-TEST-TES2', 'check', '2026-08-27')
  g.coins = 1e9
  let floorHeld = 0
  const runs = 200
  for (let i = 0; i < runs; i++) {
    const out = openPack(g, kind, 'coins')
    const best = out.reduce((b, p) => Math.max(b, { bronze: 0, silver: 1, gold: 2 }[p.card.rarity]), 0)
    const need = { bronze: 0, silver: 1, gold: 2 }[PACKS[kind].floor ?? 'bronze']
    if (best >= need) floorHeld++
  }
  console.log(`  ${PACKS[kind].name.padEnd(5)} 保底「${PACKS[kind].floor ?? '无'}」兑现 ${floorHeld}/${runs}`)
}

// ---------------------------------------------------------------- 3. chemistry beats rating

console.log('\n=== 默契 vs 纯数值 ===')
{
  const level = () => 0
  // the best five from one real club, versus the five highest-rated cards in
  // the game regardless of who they play for
  const byClub = new Map<string, typeof PLAYER_CARDS>()
  for (const c of PLAYER_CARDS) {
    if (!c.clubId) continue
    const list = byClub.get(c.clubId) ?? []
    list.push(c)
    byClub.set(c.clubId, list)
  }
  const bestClub = [...byClub.entries()]
    .filter(([, l]) => l.length >= 5)
    .sort((a, b) => sum(b[1]) - sum(a[1]))[3]     // a good club, not the very best
  function sum(l: typeof PLAYER_CARDS) {
    return l.slice(0, 5).reduce((s, c) => s + c.rating, 0)
  }
  const clubSquad: Squad = { slots: bestClub[1].slice(0, 5).map((c) => c.id), coach: null }
  const stars = PLAYER_CARDS.slice().sort((a, b) => b.rating - a.rating)
  const picked: string[] = []
  const seenRegion = new Set<string>()
  for (const c of stars) {
    // deliberately scattered: no two from the same club, spread across regions
    if (picked.length >= 5) break
    if (seenRegion.has(c.clubId ?? '')) continue
    seenRegion.add(c.clubId ?? '')
    picked.push(c.id)
  }
  const starSquad: Squad = { slots: picked, coach: null }

  // the same all-star idea, but with one card per role, so the comparison is
  // about links and not about five duelists sharing a server
  const SLOTS = ['决斗者', '先锋', '控场', '哨卫', '自由人'] as const
  const usedIds = new Set<string>()
  const tidy: (string | null)[] = SLOTS.map((role) => {
    const c = stars.find((x) => !usedIds.has(x.id)
      && !seenRegion.has(`${x.clubId}#`) && x.roles.includes(role as never))
      ?? stars.find((x) => !usedIds.has(x.id))
    if (c) { usedIds.add(c.id); return c.id }
    return null
  })
  const tidySquad: Squad = { slots: tidy, coach: null }
  const tidyAvg = tidy.filter(Boolean).length
    ? tidy.map((id) => PLAYER_CARDS.find((c) => c.id === id)!.rating).reduce((s, v) => s + v, 0) / 5
    : 0

  const clubAvg = bestClub[1].slice(0, 5).reduce((s, c) => s + c.rating, 0) / 5
  const starAvg = stars.slice(0, 5).reduce((s, c) => s + c.rating, 0) / 5
  console.log(`  同队五人 (${WORLD_TEAMS.find((t) => t.id === bestClub[0])?.tag}) `
    + `均分 ${clubAvg.toFixed(1)}  默契 ${chemistry(clubSquad).score}  阵容分 ${squadRating(clubSquad)}`)
  console.log(`  全明星五人           均分 ${starAvg.toFixed(1)}  默契 ${chemistry(starSquad).score}  阵容分 ${squadRating(starSquad)}`)
  console.log(`  全明星（按位置补齐） 均分 ${tidyAvg.toFixed(1)}  默契 ${chemistry(tidySquad).score}  阵容分 ${squadRating(tidySquad)}`)

  let clubWins = 0
  let tidyDelta = 0
  for (let i = 0; i < 300; i++) {
    // both play the same opponent with the same seed, so the only difference
    // between the two runs is the five people on the server
    const opp = WORLD_TEAMS[i % WORLD_TEAMS.length].id
    const a = playArenaMatch(clubSquad, level, opp, 3, 1000 + i)
    const b = playArenaMatch(starSquad, level, opp, 3, 1000 + i)
    const c = playArenaMatch(tidySquad, level, opp, 3, 1000 + i)
    if (a.win && !b.win) clubWins++
    else if (b.win && !a.win) clubWins--
    if (a.win && !c.win) tidyDelta++
    else if (c.win && !a.win) tidyDelta--
  }
  console.log(`  300 组同对手同种子对照：`)
  console.log(`    同队五人 vs 乱选全明星      净胜 ${clubWins > 0 ? '+' : ''}${clubWins} 场（均分低 ${(starAvg - clubAvg).toFixed(1)}）`)
  console.log(`    同队五人 vs 按位置补齐全明星 净胜 ${tidyDelta > 0 ? '+' : ''}${tidyDelta} 场（均分低 ${(tidyAvg - clubAvg).toFixed(1)}）`)
}

// ---------------------------------------------------------------- 4. economy

console.log('\n=== 天梯经济：只签到、不氪，打 60 天 ===')
{
  const g: GachaState = newGacha('VM-ECON-ECON-ECON-ECON-ECON', '穷鬼', '2026-08-27')
  // open what a new account starts with
  for (const [k, n] of Object.entries(g.packs)) {
    for (let i = 0; i < (n ?? 0); i++) openPack(g, k as PackKind, 'pack')
  }
  g.squad = autoSquad(g)
  let matches = 0
  let hitTop = 0
  const date = new Date('2026-08-27T00:00:00Z')
  for (let day = 0; day < 60; day++) {
    checkIn(g, date.toISOString().slice(0, 10))
    date.setUTCDate(date.getUTCDate() + 1)
    // five ladder matches a day, and every pack that is affordable
    for (let m = 0; m < 5; m++) {
      const opp = ladderOpponent(g)
      const r = playArenaMatch(g.squad, (id) => g.cards[id]?.level ?? 0, opp, 3, (day * 7 + m) >>> 0)
      recordLadder(g, r.win)
      matches++
      if (!hitTop && g.ladder.div === DIVISIONS.length - 1) hitTop = day + 1
    }
    for (const k of ['ten', 'elite', 'scout'] as PackKind[]) {
      while ((g.packs[k] ?? 0) > 0) openPack(g, k, 'pack')
      while (g.coins >= PACKS[k].cost * 2) openPack(g, k, 'coins')
    }
    g.squad = autoSquad(g)
  }
  const prog = collectionProgress(g)
  console.log(`  ${matches} 场天梯 · 战绩 ${g.ladder.wins}-${g.ladder.losses} (${pct(g.ladder.wins, matches)})`)
  console.log(`  段位 ${DIVISIONS[g.ladder.div]} ${g.ladder.stars}/${starsFor(g.ladder.div)}★`
    + `（最高 ${DIVISIONS[g.ladder.best]}${hitTop ? `，第 ${hitTop} 天登顶` : '，未登顶'}）`)
  console.log(`  收集 ${prog.owned}/${prog.total} (${pct(prog.owned, prog.total)})  余额 ${g.coins} 金币  抽卡 ${g.pulls} 次`)
  console.log(`  阵容分 ${squadRating(g.squad, (id) => g.cards[id]?.level ?? 0)}  默契 ${chemistry(g.squad).score}`)
}

// ---------------------------------------------------------------- 5. cup

for (const [label, tens] of [['新号（3 个十连）', 3], ['大佬（30 个十连）', 30]] as const) {
console.log(`\n=== 杯赛 100 次 · ${label} ===`)
{
  const g = newGacha('VM-CUPS-CUPS-CUPS-CUPS-CUPS', 'cup', '2026-08-27')
  g.coins = 1e6
  for (let i = 0; i < tens; i++) openPack(g, 'ten', 'coins')
  openPack(g, 'coach', 'coins')
  g.squad = autoSquad(g)
  const level = (id: string) => g.cards[id]?.level ?? 0
  const rating = squadRating(g.squad, level)
  let titles = 0
  const exits = [0, 0, 0, 0]
  const before = g.coins
  let spent = 0
  for (let i = 0; i < 100; i++) {
    enterCup(g, rating)
    spent += CUP_ENTRY
    let round = 0
    while (g.cup && !g.cup.done) {
      const opp = cupOpponent(g)!
      const r = playArenaMatch(g.squad, level, opp, 3, (i * 31 + round) >>> 0)
      recordCup(g, { opponent: opp, win: r.win, mapsWon: r.mapsWon, mapsLost: r.mapsLost })
      if (!r.win) break
      round++
    }
    if (g.cup?.won) { titles++; exits[3]++ } else exits[g.cup?.legs.length ? g.cup.legs.length - 1 : 0]++
    g.cup = null
  }
  console.log(`  阵容分 ${rating}  夺冠 ${titles}/100`)
  console.log(`  八强出局 ${exits[0]} · 四强出局 ${exits[1]} · 决赛负 ${exits[2]} · 冠军 ${exits[3]}`)
  const legs = 100 * (1 + (exits[1] + exits[2] + exits[3]) / 100 + (exits[2] + exits[3]) / 100)
  console.log(`  报名费共 ${spent}，余额变化 ${g.coins - before > 0 ? '+' : ''}${g.coins - before}`
    + `  → 每场约 ${Math.round((g.coins - before) / legs)} 金币（天梯大师约 240）`)
}
}

console.log('\n=== 自动组队 ===')
{
  const g = newGacha('VM-AUTO-AUTO-AUTO-AUTO-AUTO', 'auto', '2026-08-27')
  g.coins = 1e6
  for (let i = 0; i < 6; i++) openPack(g, 'ten', 'coins')
  openPack(g, 'coach', 'coins')
  const level = (id: string) => g.cards[id]?.level ?? 0
  const auto = autoSquad(g)
  const rating = squadRating(auto, level)

  // greedy-by-rating, which is what the button used to do
  const mine = PLAYER_CARDS.filter((c) => g.cards[c.id]).sort((a, b) => b.rating - a.rating)
  const SLOTS = ['决斗者', '先锋', '控场', '哨卫', '自由人'] as const
  const used = new Set<string>()
  const greedy: Squad = { slots: SLOTS.map((r) => {
    const c = mine.find((x) => !used.has(x.id) && x.roles.includes(r as never))
      ?? mine.find((x) => !used.has(x.id))
    if (c) { used.add(c.id); return c.id }
    return null
  }), coach: auto.coach }
  const greedyRating = squadRating(greedy, level)

  const worst = auto.slots.map((id) => (id ? PLAYER_CARDS.find((c) => c.id === id)?.rating ?? 0 : 0))
  console.log(`  自动组队 阵容分 ${rating}  默契 ${chemistry(auto).score}  五人评分 ${worst.join('/')}`)
  console.log(`  纯按评分 阵容分 ${greedyRating}  默契 ${chemistry(greedy).score}`)
  console.log(`  ${rating >= greedyRating ? 'ok' : 'FAIL'} 自动组队不该比纯按评分差`)
  const benched = PLAYER_CARDS.filter((c) => g.cards[c.id] && !auto.slots.includes(c.id))
    .sort((a, b) => b.rating - a.rating)[0]
  const lowest = Math.min(...worst.filter((x) => x > 0))
  console.log(`  首发最低 ${lowest}，板凳最高 ${benched?.rating ?? '-'}`
    + `${benched && benched.rating - lowest > 12 ? '  ← 差距过大，检查爬山逻辑' : ''}`)
}

console.log('\n=== 阵容检查 ===')
{
  const g = newGacha('VM-EMPT-EMPT-EMPT-EMPT-EMPT', 'e', '2026-08-27')
  console.log(`  空阵容分 ${squadRating(emptySquad())}（应为 0）`)
  console.log(`  空阵容默契 ${chemistry(emptySquad()).score}，提示：${chemistry(emptySquad()).notes.join('；') || '无'}`)
  openPack(g, 'scout', 'pack')
  const one: Squad = { slots: [Object.keys(g.cards)[0], null, null, null, null], coach: null }
  console.log(`  一人阵容分 ${squadRating(one)}（缺 4 人应大幅扣分）`)
}
