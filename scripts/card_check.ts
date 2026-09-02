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
import {
  PLAYER_CARDS, COACH_CARDS, LEGEND_CARDS, GOLD_AT, chemistry, squadRating, emptySquad,
  rarityRank,
} from '../src/engine/cards'
import type { Squad } from '../src/engine/cards'
import {
  DIVISIONS, PACKS, newGacha, openPack, recordLadder, ladderOpponent, checkIn,
  collectionProgress, autoSquad, enterCup, recordCup, cupOpponent, cupBo, starsFor,
  MYTHIC_FLOOR, setSlot, refreshDaily, spendPlay, claimQuest, STAMINA_MAX,
  STAMINA_COST, STAMINA_REGEN_MS, staminaEvery,
} from '../src/engine/gacha'
import type { GachaState, PackKind } from '../src/engine/gacha'
import { playArenaMatch } from '../src/engine/arena'
import { WORLD_TEAMS } from '../src/engine/teams'

const pct = (n: number, d: number) => `${((100 * n) / Math.max(1, d)).toFixed(1)}%`

/**
 * Open a pack ignoring the shop's daily limit.
 *
 * The drop-rate sections below open tens of thousands of packs to measure
 * probabilities; they are not measuring the economy and must not be throttled
 * by it. The economy section further down deliberately does NOT use this.
 */
const rawOpen = (g: GachaState, kind: PackKind) => {
  // granted rather than bought: the shop's daily limit and the ten-pull's
  // "not for sale" rule are economy, and these sections measure probability
  g.packs[kind] = (g.packs[kind] ?? 0) + 1
  return openPack(g, kind, 'pack')
}

// ---------------------------------------------------------------- 1. pools

console.log('=== 卡池 ===')
for (const metal of ['mythic', 'gold', 'silver', 'bronze'] as const) {
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
    for (const p of rawOpen(g, 'scout')) {
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
    const out = rawOpen(g, kind)
    // rarityRank, not a local map — a local one silently returned undefined
    // for 彩卡 and NaN'd the comparison, reporting a false floor failure
    const best = out.reduce((b, p) => Math.max(b, rarityRank(p.card.rarity)), 0)
    const need = rarityRank(PACKS[kind].floor ?? 'bronze')
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
  // deliberately scattered: no two from the same club, and never the same man
  // twice — the legend and the ordinary card of one player are one person
  const picked: string[] = []
  const seenClub = new Set<string>()
  const seenPerson = new Set<string>()
  for (const c of stars) {
    if (picked.length >= 5) break
    if (seenClub.has(c.clubId ?? '') || seenPerson.has(c.playerId)) continue
    seenClub.add(c.clubId ?? '')
    seenPerson.add(c.playerId)
    picked.push(c.id)
  }
  const starSquad: Squad = { slots: picked, coach: null }

  // the same all-star idea, but one card per role, so the comparison is about
  // links rather than about five duelists sharing a server
  const SLOTS = ['决斗者', '先锋', '控场', '哨卫', '自由人'] as const
  const tidyPerson = new Set<string>()
  const tidy: (string | null)[] = SLOTS.map((role) => {
    const c = stars.find((x) => !tidyPerson.has(x.playerId) && x.roles.includes(role as never))
      ?? stars.find((x) => !tidyPerson.has(x.playerId))
    if (c) { tidyPerson.add(c.playerId); return c.id }
    return null
  })
  const tidySquad: Squad = { slots: tidy, coach: null }

  // the same all-stars, but one seat given to the best caller available. The
  // no-IGL penalty is a separate rule from chemistry and worth separating out:
  // a彩卡 five that forgot to bring a voice is not the same experiment.
  const iglSquad: Squad = { slots: [...tidy], coach: null }
  if (!tidy.some((id) => PLAYER_CARDS.find((c) => c.id === id)?.isIgl)) {
    const caller = stars.find((c) => c.isIgl && !tidyPerson.has(c.playerId))
    if (caller) iglSquad.slots[4] = caller.id
  }
  const iglAvg = iglSquad.slots.filter(Boolean)
    .map((id) => PLAYER_CARDS.find((c) => c.id === id)!.rating).reduce((s, v) => s + v, 0) / 5
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
  let iglDelta = 0
  for (let i = 0; i < 300; i++) {
    // both play the same opponent with the same seed, so the only difference
    // between the two runs is the five people on the server
    const opp = WORLD_TEAMS[i % WORLD_TEAMS.length].id
    const a = playArenaMatch(clubSquad, level, opp, 3, 1000 + i)
    const b = playArenaMatch(starSquad, level, opp, 3, 1000 + i)
    const c = playArenaMatch(tidySquad, level, opp, 3, 1000 + i)
    const d = playArenaMatch(iglSquad, level, opp, 3, 1000 + i)
    if (a.win && !b.win) clubWins++
    else if (b.win && !a.win) clubWins--
    if (a.win && !c.win) tidyDelta++
    else if (c.win && !a.win) tidyDelta--
    if (a.win && !d.win) iglDelta++
    else if (d.win && !a.win) iglDelta--
  }
  console.log(`  300 组同对手同种子对照：`)
  console.log(`    同队五人 vs 乱选全明星      净胜 ${clubWins > 0 ? '+' : ''}${clubWins} 场（均分低 ${(starAvg - clubAvg).toFixed(1)}）`)
  console.log(`    同队五人 vs 按位置补齐全明星 净胜 ${tidyDelta > 0 ? '+' : ''}${tidyDelta} 场（均分低 ${(tidyAvg - clubAvg).toFixed(1)}，对面无指挥）`)
  console.log(`    同队五人 vs 带指挥的全明星   净胜 ${iglDelta > 0 ? '+' : ''}${iglDelta} 场（均分低 ${(iglAvg - clubAvg).toFixed(1)}，对面有指挥）`)
}

// ---------------------------------------------------------------- 4. economy

console.log('\n=== 体力方案对比：一天上线 N 次能打几场 ===')
{
  const HOUR = 3600_000
  const SCHEMES = [
    { name: `每 ${staminaEvery()} +1，上限 ${STAMINA_MAX}（现行）`,
      regen: STAMINA_REGEN_MS, cap: STAMINA_MAX },
    { name: '每 1 小时 +1，上限 15', regen: HOUR, cap: 15 },
    { name: '每 2 小时 +1，上限 10', regen: 2 * HOUR, cap: 10 },
    { name: '每天零点回满 12', regen: 0, cap: 12 },
  ]
  /**
   * Ladder matches a day, at steady state, for someone who spends the meter
   * dry on every visit.
   *
   * This models `settle`/`spendPlay` rather than dividing the gap by the
   * interval, because the two differ once the interval stops dividing an
   * hour: the engine carries the part-tick forward (the anchor advances by
   * whole ticks, not to `now`), and only discards it when the meter is full.
   * The naive version reads 13 matches for three visits a day where the game
   * actually gives 14. The first day is dropped so the free full meter
   * everyone starts with does not count.
   */
  const perDay = (regen: number, cap: number, visits: number): number => {
    if (regen === 0) return Math.floor(cap / STAMINA_COST.ladder)
    const DAYS = 30
    const gap = (24 / visits) * HOUR
    let bank = cap, at = 0, played = 0
    for (let v = 0; v < (DAYS + 1) * visits; v++) {
      const now = v * gap
      const ticks = Math.floor((now - at) / regen)
      const next = Math.min(cap, bank + ticks)
      at = next >= cap ? now : at + ticks * regen
      bank = next
      while (bank >= STAMINA_COST.ladder) {
        if (bank >= cap) at = now
        bank -= STAMINA_COST.ladder
        if (v >= visits) played++
      }
    }
    return played / DAYS
  }
  // padEnd counts UTF-16 units, and every one of these labels is mostly CJK
  const pad = (s: string, w: number) =>
    s + ' '.repeat(Math.max(1, w - [...s].reduce((n, c) => n + (c.charCodeAt(0) > 0x2e80 ? 2 : 1), 0)))
  const SESSIONS = [1, 2, 3, 6]
  console.log('  ' + pad('上线次数 →', 30) + SESSIONS.map((n) => `${n}次/天`.padStart(8)).join(''))
  for (const sc of SCHEMES) {
    const row = SESSIONS.map((n) => {
      const d = perDay(sc.regen, sc.cap, n)
      return `${Number.isInteger(d) ? d : d.toFixed(1)}场`.padStart(8)
    })
    console.log(`  ${pad(sc.name, 30)}${row.join('')}`)
  }
  console.log(`  （天梯一场 ${STAMINA_COST.ladder} 点。零点回满的方案上线再多次也还是那一份，`
    + '这正是「一口气打完、剩下一整天没得玩」的形状。）')
}

console.log('\n=== 每天分两次上线、打光体力、不氪，连打 60 天 ===')
{
  const HOUR = 3600_000
  const g: GachaState = newGacha('VM-ECON-ECON-ECON-ECON-ECON', '穷鬼', '2026-08-27')
  for (const [k, n] of Object.entries(g.packs)) {
    for (let i = 0; i < (n ?? 0); i++) openPack(g, k as PackKind, 'pack')
  }
  g.squad = autoSquad(g)
  let matches = 0
  let hitTop = 0
  let opens = 0
  const day0 = Date.parse('2026-08-27T00:00:00Z')
  g.daily.stamina = STAMINA_MAX
  g.daily.staminaAt = day0
  const date = new Date(day0)
  for (let day = 0; day < 60; day++) {
    const today = date.toISOString().slice(0, 10)
    refreshDaily(g, today)
    checkIn(g, today)
    date.setUTCDate(date.getUTCDate() + 1)
    for (const hour of [9, 21]) {
      const clock = day0 + day * 24 * HOUR + hour * HOUR
      for (let m = 0; m < 40; m++) {
        if (!spendPlay(g, 'ladder', clock)) break
        const opp = ladderOpponent(g)
        const r = playArenaMatch(g.squad, (id) => g.cards[id]?.level ?? 0, opp, 3, (day * 7 + m) >>> 0)
        recordLadder(g, r.win)
        matches++
        if (!hitTop && g.ladder.div === DIVISIONS.length - 1) hitTop = day + 1
      }
      for (const k of ['ten', 'elite', 'scout', 'coach'] as PackKind[]) {
        while ((g.packs[k] ?? 0) > 0) { openPack(g, k, 'pack'); opens++ }
      }
      // no purchase cap any more: buy until the coins run out, best first
      for (const k of ['elite', 'scout'] as PackKind[]) {
        while (PACKS[k].shop !== false && g.coins >= PACKS[k].cost) {
          openPack(g, k, 'coins')
          opens++
        }
      }
    }
    for (const q of g.daily.picked) claimQuest(g, q)
    g.squad = autoSquad(g)
  }
  const prog = collectionProgress(g)
  console.log(`  ${matches} 场天梯（每天 ${(matches / 60).toFixed(1)} 场）· 战绩 ${g.ladder.wins}-${g.ladder.losses} (${pct(g.ladder.wins, matches)})`)
  console.log(`  开包 ${opens} 次（每天 ${(opens / 60).toFixed(1)} 次）· 抽卡 ${g.pulls} 张`)
  console.log(`  段位 ${DIVISIONS[g.ladder.div]} ${g.ladder.stars}/${starsFor(g.ladder.div)}★`
    + `（最高 ${DIVISIONS[g.ladder.best]}${hitTop ? `，第 ${hitTop} 天登顶` : '，未登顶'}）`)
  console.log(`  收集 ${prog.owned}/${prog.total} (${pct(prog.owned, prog.total)})  余额 ${g.coins} 金币`)
  const need = Math.round(prog.total * Math.log(prog.total))
  console.log(`  集齐 ${prog.total} 张理论上要抽 ~${need} 张（约 ${Math.round(need / Math.max(1, g.pulls / 60) / 30)} 个月）`)

  const grind = newGacha('VM-GRND-GRND-GRND-GRND-GRND', '狂人', '2026-08-27')
  grind.squad = g.squad
  let coins = 0
  for (let m = 0; m < 60; m++) {
    const r = playArenaMatch(grind.squad, () => 0, ladderOpponent(grind), 3, m)
    coins += recordLadder(grind, r.win).coins
  }
  console.log(`  对照：没有体力时一口气打 60 场（一晚上）能拿 ${coins} 金币`
    + ` = ${Math.floor(coins / PACKS.scout.cost)} 个试训包`)
}

for (const [label, tens] of [['新号（3 个十连）', 3], ['大佬（30 个十连）', 30]] as const) {
console.log(`\n=== 杯赛 100 次 · ${label} ===`)
{
  const g = newGacha('VM-CUPS-CUPS-CUPS-CUPS-CUPS', 'cup', '2026-08-27')
  g.coins = 1e6
  for (let i = 0; i < tens; i++) rawOpen(g, 'ten')
  rawOpen(g, 'coach')
  g.squad = autoSquad(g)
  const level = (id: string) => g.cards[id]?.level ?? 0
  const rating = squadRating(g.squad, level)
  let titles = 0
  const outAfter = [0, 0, 0, 0, 0, 0]   // rounds won before going out
  const depths = [0, 0, 0, 0, 0, 0]
  const before = g.coins
  let legs = 0
  let tickets = 0
  for (let i = 0; i < 100; i++) {
    // a ticket costs 体力; the meter is refilled by hand so the run measures
    // the purse, not the clock
    g.daily.stamina = STAMINA_MAX; g.daily.staminaAt = 1
    enterCup(g, rating, 1)
    tickets += STAMINA_COST.cup
    depths[g.cup!.path.length]++
    let round = 0
    while (g.cup && !g.cup.done) {
      const opp = cupOpponent(g)!
      const r = playArenaMatch(g.squad, level, opp, cupBo(g.cup), (i * 31 + round) >>> 0)
      recordCup(g, { opponent: opp, win: r.win, mapsWon: r.mapsWon, mapsLost: r.mapsLost })
      legs++
      if (!r.win) break
      round++
    }
    if (g.cup?.won) titles++
    else outAfter[g.cup?.round ?? 0]++
    g.cup = null
  }
  console.log(`  阵容分 ${rating}  夺冠 ${titles}/100  签表深度 3/4/5 轮：${depths[3]}/${depths[4]}/${depths[5]}`)
  console.log(`  出局时已赢 0/1/2/3/4 轮：${outAfter.slice(0, 5).join('/')}  · 平均每张门票打 ${(legs / 100).toFixed(1)} 场`)
  // the ladder yardstick, computed rather than remembered: it moved when the
  // daily budget landed and a stale number in a check is worse than no number
  const topWin = 110 + (DIVISIONS.length - 1) * 45
  const ladderPer = Math.round(0.57 * topWin + 0.43 * 30)
  const net = g.coins - before
  console.log(`  门票共 ${tickets} 点体力，余额变化 ${net > 0 ? '+' : ''}${net}`
    + `  → 每点体力 ${Math.round(net / tickets)} 金币（天梯大师每点约 ${Math.round(ladderPer / STAMINA_COST.ladder)}）`)
  if (legs < 100 || legs > 500) throw new Error(`一张门票至少打一场，最多打满签表：${legs} 场`)
}
}

console.log('\n=== 彩卡 ===')
{
  const g = newGacha('VM-MYTH-MYTH-MYTH-MYTH-MYTH', 'myth', '2026-08-27')
  g.coins = 1e9
  const pulls = 40000
  let mythic = 0
  const seen = new Set<string>()
  let longestDry = 0
  let dry = 0
  const packs: PackKind[] = ['scout', 'elite', 'ten']
  let i = 0
  while (i < pulls) {
    const kind = packs[i % packs.length]
    for (const p of rawOpen(g, kind)) {
      i++
      if (p.card.rarity === 'mythic') {
        mythic++
        seen.add(p.card.id)
        longestDry = Math.max(longestDry, dry)
        dry = 0
      } else dry++
    }
  }
  console.log(`  ${i} 抽里出了 ${mythic} 张彩卡（${((100 * mythic) / i).toFixed(3)}%，约 ${Math.round(i / Math.max(1, mythic))} 抽一张）`)
  // packs reveal worst-first, so a彩卡 rolled mid-pack is shown last and a run
  // measured off the reveal can read up to one pack longer than it ran
  const bound = MYTHIC_FLOOR + 10
  console.log(`  最长连续不出彩卡 ${longestDry} 抽（保底 ${MYTHIC_FLOOR}，揭示顺序上限 ${bound}）`)
  console.log(`  ${seen.size}/${LEGEND_CARDS.length} 种彩卡出现过`)
  console.log(`  ${longestDry <= bound ? 'ok' : 'FAIL'} 保底没有被突破`)

  // every legend must be a real person already in the game
  const orphan = LEGEND_CARDS.filter((c) => !WORLD_TEAMS && !c.playerId)
  console.log(`  ${orphan.length === 0 ? 'ok' : 'FAIL'} 每张彩卡都对应真实选手`)
  const byPerson = new Map<string, number>()
  for (const c of LEGEND_CARDS) byPerson.set(c.playerId, (byPerson.get(c.playerId) ?? 0) + 1)
  console.log(`  ${LEGEND_CARDS.length} 张彩卡，覆盖 ${byPerson.size} 名选手`)
  console.log(`  评分区间 ${Math.min(...LEGEND_CARDS.map((c) => c.rating))}–${Math.max(...LEGEND_CARDS.map((c) => c.rating))}`
    + `（金卡线 ${GOLD_AT}，最强金卡 ${Math.max(...PLAYER_CARDS.filter((c) => c.rarity === 'gold').map((c) => c.rating))}）`)
  const weaker = LEGEND_CARDS.filter((c) => c.rating < 90)
  console.log(`  其中 ${weaker.length} 张低于 90，纯收藏向：${weaker.map((c) => c.ign).join('、')}`)
}

console.log('\n=== 同一个人不能上两次 ===')
{
  const g = newGacha('VM-DUPE-DUPE-DUPE-DUPE-DUPE', 'dupe', '2026-08-27')
  const derke = PLAYER_CARDS.find((c) => c.ign === 'Derke' && !c.legend)!
  const legend = LEGEND_CARDS.find((c) => c.ign === 'Derke')!
  g.cards[derke.id] = { id: derke.id, level: 0, dupes: 0, seen: 1, got: '2026-08-27' }
  g.cards[legend.id] = { id: legend.id, level: 0, dupes: 0, seen: 1, got: '2026-08-27' }
  setSlot(g, 0, derke.id)
  console.log(`  放入普通 Derke：${g.squad.slots.filter(Boolean).length} 人在场`)
  setSlot(g, 1, legend.id)
  const live = g.squad.slots.filter(Boolean)
  console.log(`  再放入彩卡 Derke：${live.length} 人在场（应为 1，普通卡被顶替）`)
  console.log(`  ${live.length === 1 && g.squad.slots[1] === legend.id ? 'ok' : 'FAIL'} 同一个人只能上场一次`)
}

console.log('\n=== 自动组队 ===')
{
  const g = newGacha('VM-AUTO-AUTO-AUTO-AUTO-AUTO', 'auto', '2026-08-27')
  g.coins = 1e6
  for (let i = 0; i < 6; i++) rawOpen(g, 'ten')
  rawOpen(g, 'coach')
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
