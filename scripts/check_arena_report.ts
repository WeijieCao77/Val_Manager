/**
 * What a card match hands back, on both sides of the net.
 *
 *   npx tsx scripts/check_arena_report.ts [matches]
 *
 * The post-match screen used to show one team's scoreboard and name a club the
 * match may not have been against. Now it lays out both fives, both coaches
 * and both scoreboards — which only works if the result actually carries the
 * other side. The things that have to hold:
 *
 *   - both sides get five stat lines, and they are different people
 *   - the MVP belongs to exactly one side, never both and never neither
 *   - the round log is there, and the ticks add up to the score
 *   - a squad played against itself does not merge into one team, which is the
 *     failure the synthetic A0…B4 ids exist to prevent
 */
import { playArenaMatch, playRivalMatch } from '../src/engine/arena'
import type { RivalSquad } from '../src/engine/arena'
import { PLAYER_CARDS, COACH_CARDS } from '../src/engine/cards'
import { WORLD_TEAMS } from '../src/engine/world'

const store = new Map<string, string>()
;(globalThis as never as { localStorage: unknown }) = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
  key: () => null, clear: () => store.clear(), get length() { return store.size },
}

let bad = 0
const check = (ok: boolean, what: string, detail = '') => {
  if (!ok) { bad++; console.log(`FAIL ${what}${detail ? `  ${detail}` : ''}`) }
}

const golds = PLAYER_CARDS.filter((c) => c.rarity === 'gold')
const pick = (from: number) => ({
  slots: golds.slice(from, from + 5).map((c) => c.id),
  coach: COACH_CARDS[from % COACH_CARDS.length].id,
})

const N = Number(process.argv[2] ?? 200)
const mine = pick(0)
let ecoRounds = 0, mvpMine = 0, mvpTheirs = 0, won = 0, mvpOnWinner = 0

for (let i = 0; i < N; i++) {
  const theirs = pick(5 + (i % 20))
  const rival: RivalSquad = {
    name: '老王', tag: '#ABCD',
    slots: theirs.slots, coach: theirs.coach,
    levels: Object.fromEntries(theirs.slots.map((id, j) => [id, j % 6])),
    div: 5, points: 300,
  }
  const r = playRivalMatch(mine, (id) => (id === mine.slots[0] ? 3 : 0), rival, 3, 1000 + i)

  check(!!r.opp, '真人对局带着对方的数据')
  if (!r.opp) break
  check(r.lines.length === 5, '我方五条数据', String(r.lines.length))
  check(r.opp.lines.length === 5, '对方五条数据', String(r.opp.lines.length))
  const overlap = r.lines.filter((l) => r.opp!.lines.some((o) => o.cardId === l.cardId))
  check(overlap.length === 0, '两边的数据不会串到一起', overlap.map((l) => l.cardId).join(' '))
  check(r.opp.coach === theirs.coach, '对方教练带过来了')
  check(r.opp.slots.length === 5, '对方五个位置都在')

  // exactly one side owns the MVP
  const owners = [r.mvpCard, r.opp.mvpCard].filter(Boolean).length
  check(owners === 1, 'MVP 只属于一边', `${r.mvpCard} / ${r.opp.mvpCard}`)
  if (r.mvpCard) mvpMine++; else mvpTheirs++
  if (r.win) won++
  if ((r.mvpCard !== null) === r.win) mvpOnWinner++

  // the round log has to agree with the score printed above it
  for (const m of r.result.maps) {
    check(!!m.rounds?.length, '每张图都有回合记录', m.map)
    if (!m.rounds?.length) continue
    const a = m.rounds.filter((x) => x.winner === 'A').length
    const b = m.rounds.filter((x) => x.winner === 'B').length
    check(a === m.scoreA && b === m.scoreB, '回合数和比分对得上',
      `${m.map} 记录 ${a}-${b}，比分 ${m.scoreA}-${m.scoreB}`)
    ecoRounds += m.rounds.filter((x) => (x.winner === 'A' ? x.buyA : x.buyB) === 'eco').length
  }
}

// the same five on both sides: the synthetic ids must keep them apart
{
  const rival: RivalSquad = {
    name: '镜子', tag: '#0000',
    slots: mine.slots, coach: mine.coach, levels: {}, div: 5, points: 0,
  }
  const r = playRivalMatch(mine, () => 0, rival, 3, 77)
  check(r.lines.length === 5 && r.opp?.lines.length === 5,
    '同一套卡打自己，两边各有五个人', `${r.lines.length} / ${r.opp?.lines.length}`)
  check(r.mapsWon + r.mapsLost >= 2, '镜像对局也能打出结果')
}

// a club opponent has no cards, and must not pretend to
{
  const r = playArenaMatch(mine, () => 0, WORLD_TEAMS[0].id, 3, 5)
  check(!r.opp, '打俱乐部时没有「对方卡组」这一块')
  check(r.lines.length === 5, '打俱乐部照样有我方数据')
}

// MVP goes to the winning side (the engine gives it +18 ACS), so a lopsided
// MVP count is a lopsided win count and not a side bias — worth printing, or
// the next person reads 29/30 as team A always taking it
console.log(`${N} 场真人对局：赢 ${won}，MVP 在我方 ${mvpMine} 次、对方 ${mvpTheirs} 次`
  + `（其中 ${mvpOnWinner} 次在胜方），经济局赢下 ${ecoRounds} 个回合`)
check(mvpOnWinner >= N * 0.8, 'MVP 基本上都在胜方', `${mvpOnWinner}/${N}`)

// an even match, to prove the other side can take the MVP at all
{
  let theirMvp = 0
  for (let i = 0; i < 40; i++) {
    const rival: RivalSquad = {
      name: '对手', tag: '#EVEN',
      slots: mine.slots, coach: COACH_CARDS[1].id, levels: {}, div: 5, points: 0,
    }
    const r = playRivalMatch(mine, () => 0, rival, 3, 9000 + i)
    if (r.opp?.mvpCard) theirMvp++
  }
  check(theirMvp >= 8, '势均力敌时对方也拿得到 MVP', `40 场里 ${theirMvp} 场`)
  console.log(`  势均力敌 40 场：对方拿到 MVP ${theirMvp} 次`)
}
console.log(bad ? `\n${bad} 项不通过` : '\n全部通过')
process.exit(bad ? 1 : 0)
